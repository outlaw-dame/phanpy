# ActivityPods Phase 0 — Authentication, Application Authorization, and Mutation Contracts

## Scope

This companion audit records current executable contracts on `outlaw-dame/activity-pods` `master` that Phanpy can target without importing the ActivityPods React Admin presentation layer or bypassing ActivityPods authority.

It resolves three questions that must remain distinct:

1. how a browser/user authenticates to the current Pod provider;
2. how an application receives Pod/data rights after authentication;
3. how social mutations enter ActivityPods and progress to federation delivery.

## 1. Browser authentication: current managed OAuth stack

The current Pod provider has a first-party OAuth authorization-server implementation under:

```text
pod-provider/backend/services/oauth/
```

The backend package pins `oidc-provider` and SemApps auth/solid packages and includes live proof scripts for OAuth metadata, PAR, managed login, backend-sidecar bridge, and the OAuth smoke path.

### Public discovery and protocol endpoints

`oauth-api.service.js` registers browser/public routes:

```text
GET  /.well-known/oauth-authorization-server
GET  /.well-known/oauth-protected-resource

POST /oauth/par
GET  /oauth/authorize
POST /oauth/authorize
POST /oauth/session/login
POST /oauth/session/logout
POST /oauth/token
POST /oauth/revoke
GET  /oauth/client-metadata/:id
GET  /oauth/dpop-nonce
```

It separately registers trusted internal routes under `/api/internal/oauth`; those are not Phanpy contracts.

`oauth-authorization-server-metadata.service.js` currently advertises:

```text
response_types_supported: code
grant_types_supported: authorization_code, refresh_token
code_challenge_methods_supported: S256
token_endpoint_auth_methods_supported: none, private_key_jwt
dpop_signing_alg_values_supported: ES256
client_id_metadata_document_supported: true
```

The managed path also includes:

- pushed authorization requests (PAR);
- DPoP proof/nonces;
- consent challenges;
- authorization-code exchange;
- refresh sessions/families;
- client metadata;
- protected-resource metadata;
- session login/logout;
- CSRF-bound authorization decisions.

### Phanpy consequence

Phase 1 must not treat `@activitypods/react` or its registration hook as the authentication mechanism.

Target client layering:

```text
Phanpy SessionRepository
  -> OAuth/OIDC discovery
  -> authorization code + PKCE
  -> DPoP-bound browser token/session handling as required by provider metadata
  -> authenticated WebID/account identity
```

Framework-specific React Admin/MUI code is not required for this protocol layer.

Security rule:

- never expose `/api/internal/oauth` credentials/routes to the browser;
- never substitute `ACTIVITYPODS_TOKEN` or sidecar credentials for a user OAuth session;
- bind the browser identity to the provider-issued authenticated principal, not a caller-supplied WebID string.

## 2. Application authorization: Solid interoperability grants are a separate layer

The active `@activitypods/react` package still contains `useRegisterApp.ts`, which performs Solid Data Interoperability discovery after a user identity/WebID is known.

Its current flow is:

```text
fetch user WebID/actor
  -> read interop:hasAuthorizationAgent
  -> fetch authorization agent
  -> inspect Link rel=interop:registeredAgent
     -> if present, return the application-registration URI
     -> if absent, redirect to interop:hasAuthorizationRedirectEndpoint?client_id=...
```

This is not merely historical prose; the current backend app framework also implements the receiving registration model.

`app.registration` handles ActivityPub Create/Update/Delete activities whose object is `interop:ApplicationRegistration`.

For Create it:

1. rejects duplicate registration for the same user;
2. calls `app-registrations.verify`;
3. requires all declared access needs to be satisfied;
4. stores the application registration, access grants, and data grants;
5. attaches them to local application state;
6. registers Pod activity listeners from the approved special rights.

For Update it re-verifies the grants, refreshes the cached state, removes orphaned grants, and emits `app.upgraded`.

For Delete it removes the registration and its associated grants.

### Phanpy consequence

The session/application boundary is therefore two-stage:

```text
OAuth authentication
  -> establishes authenticated user/WebID

Solid Data Interoperability application registration
  -> establishes what Phanpy is allowed to read/write/watch in that user's Pod
```

Phanpy should reproduce the protocol semantics in Preact-compatible repositories/hooks, not import React Admin/MUI merely to reuse `useRegisterApp`.

The initial ActivityPods application manifest/access-needs design must be explicit and least-privilege. Rights should be requested by feature phase rather than granting broad Pod authority merely because the client is social-network-like.

## 3. Solid Notifications listener ownership

`app-framework/app/services/pod-handling/pod-activities-watcher.js` has an explicit dependency on:

```text
solid-notifications.listener
```

The watcher registers an inbox listener only when an approved access grant contains `apods:ReadInbox`, and an outbox listener only for `apods:ReadOutbox`.

On application restart it reconstructs those listeners from stored `interop:AccessGrant` data.

The listener registration itself is delegated to SemApps:

```text
solid-notifications.listener.register({
  resourceUri: actor[collectionPredicate],
  actionName: 'pod-activities-watcher.processWebhook'
})
```

### Phanpy consequence

There are two legitimate clients of Solid Notifications with different responsibilities:

- ActivityPods application backends may use the SemApps listener to run server-side application handlers;
- Phanpy may use a browser-side Solid Notifications adapter for user-authorized private/Pod resource invalidation where the relevant endpoint/auth contract permits it.

Phanpy must not copy the backend watcher/queue implementation into the browser.

ActivityPub notification activities and Solid Notifications remain different concepts: the first is social semantics, the second is resource-change transport.

## 4. Generic social mutation primitive: user actor outbox

The active app framework exposes `pod-outbox.post`.

Its behavior is authority-preserving:

1. add the default JSON-LD context when absent;
2. resolve the current application actor;
3. resolve the target user's ActivityPub actor/outbox while acting as that authorized application;
4. POST the activity to the user's outbox through `signature.proxy.query`;
5. return the created Activity location when successful.

The application does not sign as the user and does not call the federation sidecar.

This is a suitable generic primitive for ActivityPub mutations such as Create/Update/Delete, reply-shaped Create activities, Like/Undo Like, Announce/Undo Announce, and other operations whose authoritative semantics are the actor outbox.

The exact activity construction rules still need per-operation adapter tests; the existence of a common outbox ingress does not justify sending malformed or Mastodon-shaped payloads.

## 5. Delivery after the outbox: ActivityPods/SemApps remain authoritative

`pod-provider/backend/services/outbox-emitter.service.js` consumes committed SemApps outbox events.

In native remote-delivery mode it observes `activitypub.outbox.posted`.

In external sidecar delivery mode it consumes:

```text
activitypub.outbox.remote-delivery.handoff-queued
```

and fails closed unless the supplied delivery plan validates as `ap.delivery-plan.v1` and its `activityId` exactly matches the committed Activity.

The committed event contains the delivery-plan recipient snapshot supplied by the ActivityPods/SemApps authority layer. Phanpy neither resolves nor submits those targets.

The browser-facing architecture remains:

```text
Phanpy operation
  -> ActivityPods authenticated application API / actor outbox
  -> ActivityPods + SemApps canonical mutation and recipient planning
  -> durable external handoff when configured
  -> sidecar delivery/retry
  -> ActivityPods internal signer for Pod-actor HTTP signatures
```

## 6. Prefer purpose-built authenticated APIs when they encode stronger semantics

The presence of the generic outbox primitive does not mean every Phanpy operation should manually construct an Activity.

Example: current `followable-api.service.js` registers:

```text
POST /api/followable/resolve
POST /api/followable/follow
```

with both authentication and authorization enabled.

`follow` binds `followerActorUri` to `ctx.meta.webId`, rejects anonymous callers, resolves the target through the `followable` service, and returns `202` for the accepted follow operation.

That is safer and more semantically useful for Phanpy than accepting a browser-supplied follower identity or reconstructing target-resolution behavior in the client.

### MutationRepository selection rule

For each operation:

```text
if ActivityPods exposes a browser-safe authenticated domain API
  -> prefer that API
else if the operation is a canonical ActivityPub outbox mutation
  -> use the authorized actor-outbox primitive
else
  -> mark the capability as missing; do not tunnel into internal services
```

This lets Phanpy remain protocol-neutral while preserving server-side policy, target resolution, moderation, and identity binding.

## 7. What Phase 1 can now rely on

### REUSE_AS_IS

- ActivityPods account/WebID authority;
- current OAuth authorization-server metadata and public OAuth routes;
- PKCE/PAR/DPoP/token/refresh infrastructure exposed by the provider;
- Solid interoperability application-registration backend semantics;
- SemApps Solid Notifications listener for application-backend watching;
- user actor outbox as canonical ActivityPub ingress;
- external delivery-plan validation/handoff boundary;
- internal HTTP signing/key custody;
- authenticated follow target resolution/execution API.

### REUSE_BEHIND_ADAPTER

- OAuth browser flow in `SessionRepository`;
- Solid interoperability registration/access grants in `ApplicationGrantRepository` or the SessionRepository's authorization layer;
- Pod resource/WAC operations;
- generic outbox mutation posting;
- purpose-built follow API;
- browser-side Solid Notifications where the current discovery/auth contract is verified.

### Still to verify before closing Phase 0

- exact public protected-resource bearer/DPoP validation path for ordinary Pod/API requests from Phanpy;
- whether the desired Phanpy client should use provider-hosted session login UI, a first-party login surface, or only redirect-based OAuth in production;
- refresh-token/browser storage policy and PWA security constraints;
- application `client_id` metadata document shape and deployment URL for the Phanpy fork;
- exact least-privilege access-needs group for feeds, inbox/outbox watching, collections, profile, media, and moderation;
- exact Create/reply/Like/Announce/Undo/Delete payload contracts and regression tests;
- purpose-built APIs for mute/block/report/profile/media and which should supersede raw outbox/resource writes;
- browser Solid Notifications endpoint discovery and authenticated subscription mechanics;
- media upload/blob contract and relationship to the existing media-pipeline integration.

## Phase 1 implementation implication

The first code phase should introduce the protocol-neutral SessionRepository and MutationRepository against these verified contracts without changing Phanpy's Mastodon provider yet.

That creates a parallel ActivityPods path while retaining Mastodon as a behavioral oracle, and it prevents the client from acquiring backend authority that already belongs to ActivityPods/SemApps or the federation sidecar.
