# ActivityPods Phase 0 — Authentication and FEP Streaming Contract

## Purpose

This document records the verified browser/session/realtime contracts discovered after the broader Phase 0 architecture documents were written. It supersedes any earlier statement that Phanpy needs a greenfield Durable Streams service or that Solid Notifications must carry every private social event.

## ActivityPods session model

ActivityPods distinguishes the application agent from the user whose Pod it is operating on.

The current Solid-OIDC provider verifies bearer credentials and sets:

```text
ctx.meta.webId            = token.azp   # application agent URI/WebID
ctx.meta.impersonatedUser = token.webid # actual Pod owner/user
```

Phanpy therefore acts as a registered application agent. It must not model its authenticated application identity as if it were the user's WebID.

### OIDC capabilities and compatibility state

The current provider configuration:

- requires Authorization Code + PKCE S256;
- supports `openid profile offline_access webid`;
- enables dynamic registration, revocation and introspection;
- enables DPoP and advertises supported DPoP signing algorithms;
- still documents that the current application generation uses ID tokens instead of DPoP-bound access tokens for resource access compatibility.

Phase 4 must therefore preserve current ActivityPods interoperability while isolating token handling behind `SessionRepository`. A migration to DPoP access tokens should be treated as an ActivityPods compatibility/hardening change, not silently assumed by the client.

## SAI application registration is a separate authorization layer

A successful Solid-OIDC session does not itself grant arbitrary Pod access.

ActivityPods' authorization agent fetches the application's `interop:Application` resource, reads its required `interop:hasAccessNeedGroup` declarations and special rights, and generates the associated:

- ApplicationRegistration;
- AccessAuthorizations;
- DataAuthorizations;
- AccessGrants;
- DataGrants.

The application registration records the Pod owner as `registeredBy` and the application URI as `registeredAgent`.

Implication: Phanpy needs a stable hosted application URI/resource describing the access it actually requires. Permissions must be declarative and reviewable rather than inferred from UI features at runtime.

## Phanpy application shape

The default design should remain as small as possible:

```text
Phanpy PWA
  |
  +-- stable hosted Application URI / access-needs manifest
  +-- Solid-OIDC + SAI registration client
  +-- protocol-neutral repository adapters
  |
  +--> ActivityPods-authoritative writes/Pod resources
  +--> Mastopod browser-safe feed/realtime surfaces
```

`@activitypods/app` is explicitly a backend-application package. It should only be introduced if a verified required operation cannot safely be performed through the browser/session plus existing Mastopod/ActivityPods application boundaries. The existence of the backend framework alone is not a reason to add another Phanpy server.

## FEP-3ab2 is the browser-safe streaming gateway

Current Mastopod `main` already implements the browser/session boundary for ActivityPub event streaming.

The runtime includes:

- `Fep3ab2ActivityPodsClient`;
- Redis-backed `Fep3ab2SessionStore`;
- `Fep3ab2EventHub`;
- Redis-backed `Fep3ab2ReplayStore`;
- `Fep3ab2Dispatcher`;
- `Fep3ab2TopicRouter`;
- session mutation subscriber;
- ActivityPods private realtime subscriber;
- observer integration with the existing feed stream subsystem.

### Browser routes

```text
POST   /streaming/control
DELETE /streaming/control
GET    /streaming/control/subscriptions
POST   /streaming/control/subscriptions
DELETE /streaming/control/subscriptions?topic=...
GET    /streaming/stream
```

Control-session creation:

1. forwards the browser auth context to ActivityPods for principal resolution;
2. creates a server-side streaming session;
3. issues an HttpOnly streaming ticket cookie;
4. returns subscription and stream URLs plus expiry/capabilities.

Topic mutations are authorized by ActivityPods. The sidecar does not accept a browser-supplied principal as authority.

The SSE route:

- enforces origin/CORS policy;
- requires `Accept: text/event-stream`;
- requires the HttpOnly stream ticket;
- re-resolves the principal through ActivityPods;
- binds the ticket to principal/session context;
- applies bounded output-buffer handling and no-store behavior.

## Public replay already exists

The FEP replay store is Redis-backed and persists replayable non-principal events before live publication.

Current characteristics include:

- sequence-based wire IDs;
- default replay retention of 900 seconds, bounded by configuration;
- bounded replay-event count and index size;
- bounded payload size;
- topic-filtered replay;
- stale-index cleanup;
- metrics for stored/replayed/missing/skipped events.

On reconnect with a valid `Last-Event-ID`, the SSE route:

1. registers the live connection in a paused state;
2. replays matching retained events;
3. resumes the live connection afterward.

This is already a replay-to-live cutover mechanism.

### What it is not

It is not arbitrary long-term RedPanda seek-by-Kafka-offset replay. If the Redis replay window cannot satisfy recovery, the product must refresh from an authoritative snapshot/query and continue from current live state.

RedPanda seek replay should be added only if product requirements prove the bounded replay + snapshot fallback insufficient.

## Public topics

The current FEP topic router maps the existing public feed streams to:

```text
stream1   -> feeds/public/local
stream2   -> feeds/public/remote
canonical -> feeds/public/canonical
unified   -> feeds/public/unified
```

It also emits URI-derived topics and refresh-oriented aliases such as local/global feeds.

The normalized `unified` public stream should be evaluated first for Phanpy public-live surfaces before creating additional client-specific streams.

## Principal-scoped private social realtime

ActivityPods already emits principal-scoped private realtime events through an internal Redis pub/sub bridge.

Current private topics:

```text
notifications
feeds/personal
```

ActivityPods resolves the end-user principal from forwarded browser bearer/cookie context through an internal authority endpoint. It separately authorizes requested streaming topics.

The FEP runtime subscribes to these private ActivityPods events and routes them only to matching principal sessions.

### Private replay behavior

Principal-scoped private events intentionally do **not** enter the FEP public replay store.

Therefore private social realtime uses:

```text
authoritative private snapshot
        +
live principal-scoped events
```

After a disconnect longer than what the live connection can cover, Phanpy must refresh the relevant authoritative notification/personal-feed snapshot rather than assuming private event replay.

This keeps private payloads out of the public replay projection.

## Solid Notifications still has a distinct role

Solid Notifications remains the appropriate general Pod-resource synchronization plane for resources such as:

- collection definitions/membership;
- portable preferences;
- custom-feed definition resources;
- other authorized Pod-owned state.

It is no longer accurate to describe Solid Notifications as the only private/social live transport. Social notifications and personal-feed realtime already have the FEP principal-scoped path above.

## Revised implementation consequences

### Phase 4 — Authentication

Implement:

- ActivityPods issuer discovery / PKCE session flow;
- current token compatibility behind `SessionRepository`;
- application URI discovery/configuration;
- SAI registration and access-needs verification;
- explicit distinction between application agent and Pod owner.

### Phase 7 — Public feed/hydration

The feed engine exists. The remaining question is browser-safe snapshot/query/hydration exposure; do not create another feed engine.

### Phase 9 — Public realtime

Default scope becomes:

- implement Phanpy client integration with existing FEP `/streaming/*` control/SSE contract;
- test reconnect and retained public replay;
- implement snapshot fallback for missing/expired/non-replayable IDs;
- test duplicate/order behavior around replay-to-live cutover;
- only add RedPanda seek replay if bounded FEP replay proves insufficient.

### Phase 10 — Private realtime

Use:

- FEP principal-scoped `notifications` / `feeds/personal` for social live events;
- authoritative snapshot refresh for private recovery;
- Solid Notifications for general Pod-resource synchronization.

## Security invariants

- no ActivityPods internal bearer token is exposed to the browser;
- no Mastopod service bearer token is exposed to the browser;
- browser-supplied principal/viewer identifiers are never authority;
- subscription authorization is delegated back to ActivityPods;
- private principal-scoped events are not persisted into the public replay store;
- expired/missing replay state causes snapshot recovery rather than fabricated continuity;
- application access is derived from SAI grants, not OAuth scope names alone.
