# ActivityPods Integration — Phase 0 Contract Audit

## Purpose

This is the implementation-level companion to `ACTIVITYPODS-INTEGRATION-ARCHITECTURE.md`.

It records verified implementation facts across:

- `outlaw-dame/phanpy`
- `outlaw-dame/activity-pods`
- `outlaw-dame/mastopod-federation-architecture`

The audit distinguishes:

- `REUSE_AS_IS`
- `REUSE_BEHIND_ADAPTER`
- `HARDEN_AND_EXPOSE`
- `NEW_WORK`
- `DEFERRED`

Historical architecture documents are not treated as runtime truth when current code disagrees with them. Active unmerged branches are recorded separately from default-branch runtime state.

## Verified findings — Phanpy

### Existing Mastodon coupling is the migration baseline

Phanpy is currently a Mastodon client. Its API, auth, feed, live, notification, relationship, composer, media, search, profile, and model assumptions are Mastodon-shaped by design.

The Phase 0 task is therefore to map those responsibilities to the real ActivityPods + Mastopod contracts without duplicating infrastructure.

The client boundary remains:

```text
Phanpy UI
   |
   v
protocol-neutral repositories
   |
   +-- Session / Identity
   +-- Feed / Search / Hydration
   +-- Mutation / Relationship
   +-- Notification
   +-- Media
   +-- Collection / Custom Feed
   +-- Live
```

Current Mastodon behavior remains the Phase 2 regression oracle while those repositories are introduced.

### Home timeline responsibilities must be separated

The current home implementation combines snapshot pagination, polling, Mastodon streaming update/delete events, and recipient-specific state. The ActivityPods adaptation should split those responsibilities:

```text
FeedRepository
  -> snapshot, pagination, query

LiveRepository
  -> incremental public events + private refresh hints

NotificationRepository / RelationshipRepository
  -> recipient-specific semantics and authoritative reads
```

That separation maps onto contracts already present in the architecture.

## Verified findings — ActivityPods

### Application registration uses Solid Data Interoperability semantics — REUSE_BEHIND_ADAPTER

The current ActivityPods app framework has a concrete registration/grant flow:

1. fetch the user's WebID/actor;
2. discover `interop:hasAuthorizationAgent`;
3. fetch the authorization agent;
4. inspect the `Link` relation `interop:registeredAgent`;
5. if no registration exists, redirect to `interop:hasAuthorizationRedirectEndpoint` with `client_id`;
6. after registration, verify the application's required AccessNeedGroups, AccessGrants, DataGrants, and special rights.

The React package implementing the existing UI is specifically React Admin/MUI (`@activitypods/react`), so Phanpy should not import that presentation layer. It should reproduce the protocol behavior in a Preact-compatible `SessionRepository`/authorization adapter.

Server-side application registration is not merely a UI convention. ActivityPods receives `Create`, `Update`, and `Delete` activities for `interop:ApplicationRegistration`, verifies required grants, stores the mirrored grants, and registers backend listeners where special rights require them.

### Current local auth/bootstrap is authoritative ActivityPods state — REUSE_BEHIND_ADAPTER

The Pod provider uses SemApps `AuthLocalService` and an ActivityPods-owned signup/bootstrap path. Signup creates the account and WebID, provisions the ActivityPub actor, optionally provisions ATProto identity, and waits for required local resources in production, including:

- authorization agent;
- agent/auth/data registries;
- Pod storage/preferences metadata;
- ActivityPub actor completion;
- type indexes.

This reinforces the boundary: Phanpy can drive login/signup and app authorization, but it must not recreate account/bootstrap semantics locally.

The remaining Phase 0 auth task is to select the browser implementation for Solid-OIDC/session restoration and Data Interoperability registration in Preact, not to invent a new identity system.

### Pod resources and permissions already exist — REUSE_BEHIND_ADAPTER

The ActivityPods app framework already provides actor-bound Pod resource operations and WAC permission management with Read/Append/Write/Control modes.

Phanpy should not create a second Pod CRUD or ACL model.

### Collections already exist as reusable Pod-owned resources — REUSE_BEHIND_ADAPTER

`pod-collections` supports:

- `Collection` and `OrderedCollection` resources;
- reading members;
- attaching/detaching collections to resources;
- SPARQL Update add/remove operations;
- pagination/dereference/sort options;
- provisioning missing attached collections.

Phase 11 should expose Phanpy collection semantics over this substrate. Phase 12 custom-feed definitions can reference ActivityPods collection URIs rather than introducing a separate list database.

### ActivityPub notification semantics, private realtime hints, and Solid Notifications are three different concerns

These must not be collapsed into one mechanism.

`pod-notification` represents application-generated ActivityPub notification semantics.

`pod-activities-watcher` uses SemApps `solid-notifications.listener` to observe authorized inbox/outbox collection changes. It registers listeners only when the app has the corresponding `ReadInbox`/`ReadOutbox` special rights.

The newer architecture also contains a principal-scoped private realtime path:

```text
ActivityPods realtime-private-emitter
  -> Redis private pub/sub channel
  -> sidecar FEP-3ab2 session/topic router
  -> matching authenticated principal only
```

Its current private topics are:

- `notifications`
- `feeds/personal`

Those events are refresh/invalidation hints, not a new source of truth and not public RedPanda events.

The correct client split is therefore:

```text
ActivityPub notification objects
  -> social notification semantics / authoritative data

FEP-3ab2 private principal-scoped hints
  -> low-latency notification/personal-feed refresh signaling

Solid Notifications
  -> Pod/resource synchronization and authorized collection/resource change transport
```

Phanpy should consume the public browser-facing FEP stream surface for notification/feed hints when available, while using Solid Notifications for Pod-owned resource synchronization. It should not reproduce `pod-activities-watcher` in the browser.

### Canonical social writes remain ActivityPods-authoritative — REUSE_BEHIND_ADAPTER

The legacy app-framework `pod-outbox.post` helper already posts through the actor's canonical outbox while preserving ActivityPods/SemApps signing authority.

The modern Pod-provider core goes further. `services/core/activitypub.js` resolves one explicit remote-delivery authority mode and constructs ActivityPub with that strategy. In native mode SemApps remains remote-delivery authority and the sidecar is observation-only. Under explicit external-authority cutover, the same canonical ActivityPub outbox path creates the durable handoff used by the external delivery executor.

`outbox-emitter.service.js` confirms the distinction:

- native `activitypub.outbox.posted` events become committed observation/indexing events;
- external `activitypub.outbox.remote-delivery.handoff-queued` events require a valid `ap.delivery-plan.v1` and consume its already-frozen remote recipient routing snapshot;
- both paths emit the normalized `ap.outbox.committed.v1` observation event;
- public-search consent/indexability remains attached to the committed event rather than inventing a second write route.

Therefore Phanpy mutations terminate at the ActivityPods canonical social write/outbox boundary. Phanpy must never:

- submit federation delivery targets;
- choose native vs sidecar delivery authority;
- write Redis or RedPanda directly;
- call delivery workers;
- call the internal signing API.

### Modern ActivityPub signing authority already exists on ActivityPods `master` — REUSE_AS_IS

Current `master` registers:

```text
POST /api/internal/signatures/batch
```

and keeps private RSA key material inside ActivityPods.

The executable local authority chain on `master` is:

```text
auth.account.findByWebId(actorUri)
  -> require exact local account.webId === actorUri
  -> activitypub.actor.get(actorUri)
  -> require exact actor id === actorUri
  -> keys.getOrCreateWebIdKeys(RSA) in the account dataset
  -> intersect with actor.publicKey linkage
  -> require exactly one owner/controller-matching key
  -> derive keyId from signer-controlled rdfs:seeAlso
  -> sign and return HTTP headers
```

This is already materially stronger than same-host inference and the obsolete `actors.resolveWebIdForActor` / `actors.getPublicKeyId` chain found in older integration copies.

The current default-branch endpoint also validates signing profile, host/path/method, digest/body size, and key ambiguity. It is strictly service-internal from Phanpy's perspective.

### ActivityPods PR #107 is security hardening, not the prerequisite for the signer

PR #107 (`security/signing-credential-hygiene-forward-port`) must not be described as introducing the modern signing boundary. That boundary and the `auth.account.findByWebId -> activitypub.actor.get -> keys.getOrCreateWebIdKeys` authority chain are already on `master`.

PR #107 hardens the surrounding trust boundary, including dedicated `ACTIVITYPODS_TOKEN` use, removal of reverse-direction credential fallbacks, stricter credential/date handling, adjacent ActivityPub discovery surfaces, ATProto signing authority, password-verification separation, and repository/config hygiene.

For Phanpy:

- the internal signer is not a client API;
- the integration architecture does not block on PR #107;
- deployment/security qualification should track #107 because its hardening matters to the final ActivityPods + sidecar trust model.

### Stale integration copies must not become client dependencies

The federation repository contains historical ActivityPods integration copies and compatibility helpers. They are not automatically current contracts.

The required dependency direction is:

```text
browser
  -> ActivityPods application/social mutation contract
  -> ActivityPods canonical state/outbox
  -> selected native or durable external federation executor
  -> ActivityPods internal signer when a Pod actor signature is required
```

Phanpy never inverts this chain.

### Media storage and the media pipeline already have concrete ownership — REUSE_BEHIND_ADAPTER / HARDEN_AND_EXPOSE

ActivityPods has a `files` controlled container accepting `semapps:File` resources for `image/*` and `video/*`. This is the local Pod-provider file substrate.

The newer media architecture also exposes a trusted internal media-pipeline API that:

- resolves only allowed local ActivityPods source origins;
- verifies the resource is a SemApps file;
- constrains file access to the configured uploads root;
- validates/sniffs supported image/video MIME types;
- bounds source size;
- writes processed asset, safety-signal, and moderation metadata back to the authoritative file resource.

That internal `/api/internal/media-pipeline/*` surface is service-to-service and must not be called directly by Phanpy.

The remaining client-facing work is therefore narrower: define the authenticated browser upload/create-file contract and map its resulting `semapps:File` URI into `MediaRepository`, while the existing media pipeline performs processing behind ActivityPods.

### ActivityPods already participates in browser-safe realtime authorization — HARDEN_AND_EXPOSE

ActivityPods `master` contains internal services expressly designed to let the sidecar expose a public authenticated streaming facade without learning ActivityPods authentication internals:

```text
POST /api/internal/streaming/resolve-principal
POST /api/internal/streaming/authorize-topics
```

`resolve-principal` resolves forwarded user bearer/cookie session material to the authoritative WebID/principal. `authorize-topics` validates supported topics for an authenticated principal.

These endpoints are sidecar-facing and use service credentials; Phanpy must not call them. Their presence means the correct browser architecture is already defined: Phanpy talks to the public FEP-3ab2 control/stream facade, and the sidecar asks ActivityPods to resolve/authorize the viewer server-side.

## Verified findings — Mastopod federation/query architecture

### Public indexing already exists — REUSE_AS_IS

`SearchIndexerService` is the RedPanda -> public-search projection path. It already handles public-search consent, ActivityPub projection, batching, deduplication, tombstones, DLQ behavior, OpenSearch/Qdrant targets, and public author/content projections.

Phanpy must not build another public ingestion/indexing pipeline.

### The newer `src/feed/` subsystem is the relevant frontend-provider contract

Older query classes remain useful lower-level code, but `fedify-sidecar/src/feed/` now defines the more relevant application-provider layer.

Its contracts cover:

- feed kinds: graph, discovery, topic, locality, notifications, custom;
- sources: Stream1, Stream2, canonical, firehose, unified;
- public/authenticated/internal visibility;
- chronological/ranked/blended ranking;
- stable feed skeletons;
- opaque cursors;
- tag/language/author filters;
- hydration shapes and provenance;
- explicit omission reasons such as deleted, blocked, and viewer-not-allowed.

### Feed query and hydration routes already exist — HARDEN_AND_EXPOSE

Current internal provider routes include:

```text
GET  /internal/feed/definitions
POST /internal/feed/query
POST /internal/feed/hydrate
POST /internal/feed/viewed
GET  /internal/feed/stream
```

with WebSocket support in the same subsystem.

`DefaultPodFeedService` validates provider/visibility, validates outputs, retries bounded retryable provider failures, deduplicates stable IDs, and returns capabilities.

`DefaultPodHydrationService` groups by source, uses bounded concurrency/retries, deduplicates inputs, and exposes omission reasons rather than fabricating unavailable objects.

These internal routes use service credentials and therefore are not browser APIs. The missing work is the browser-safe authenticated façade, not another feed engine.

### Public FEP-3ab2 streaming is the intended browser realtime control plane — HARDEN_AND_EXPOSE

The federation architecture contains an explicit FEP-3ab2 design that keeps `/internal/feed/stream` and `/internal/feed/stream/ws` service-internal while adding a separate public browser/server surface owned by the sidecar:

```text
POST   /streaming/control
DELETE /streaming/control
GET    /streaming/control/subscriptions
POST   /streaming/control/subscriptions
DELETE /streaming/control/subscriptions
GET    /streaming/stream
```

The design delegates principal resolution and topic authorization back to ActivityPods, stores short-lived stream session/subscription state in Redis, and exposes stable public topics rather than raw implementation names.

Planned/defined topics include:

- `feeds/public/local`
- `feeds/public/remote`
- `feeds/public/unified`
- `feeds/public/canonical`
- `notifications`
- `feeds/personal`
- `feeds/local`
- `feeds/global`

Private `notifications` and `feeds/personal` events are principal-scoped and enter through the private Redis fan-out channel, not public RedPanda.

This is a better Phanpy `LiveRepository` boundary than exposing the internal feed stream routes.

### Existing public stream ingestion remains reusable

Current stream infrastructure already includes:

- `DurableStreamContracts.ts`;
- `DurableStreamSubscriptionService.ts`;
- SSE/WebSocket internal transports;
- `FeedStreamKafkaConsumer.ts`;
- `UnifiedFeedBridge.ts`.

`FeedStreamKafkaConsumer` maps:

```text
ap.stream1.local-public.v1  -> stream1
ap.stream2.remote-public.v1 -> stream2
canonical.v1                -> canonical
```

and carries Kafka partition/offset information in cursors.

`UnifiedFeedBridge` creates an observe-only normalized public stream across canonical and remote-public events without becoming protocol authority.

### Public replay is still incomplete

Existing realtime fan-out is not sufficient proof of durable browser replay. The internal v1 subscription service has in-process cursor/session state and current capabilities declare `replayCapable: false`.

Phase 9 therefore remains `HARDEN_AND_EXPOSE` plus focused new replay work:

1. define exact partition/offset cursor semantics;
2. add bounded RedPanda seek/replay or an equivalent durable replay projection;
3. define retention-expired cursor behavior;
4. provide snapshot fallback;
5. make replay -> live cutover gap-free and duplicate-safe;
6. preserve delete/update/tombstone ordering;
7. bind browser subscriptions to ActivityPods-resolved principals;
8. apply equivalent moderation/filter policy to snapshot and live paths.

### Private realtime does not replace authoritative reads

The FEP design intentionally treats `notifications` and `feeds/personal` as refresh/append hints. Query/hydration and ActivityPods authoritative state remain the recovery path.

That is desirable for Phanpy: reconnect correctness should not require lossless durable storage of every private UI hint.

## Authority / transport ownership matrix

| Concern | Browser / Phanpy | ActivityPods / SemApps | Federation sidecar |
| --- | --- | --- | --- |
| Session/app grant | request/use authorized session | canonical auth + app grant authority | forwards browser auth only where required |
| Local actor identity | consume normalized identity | canonical authority | projection only where needed |
| Pod CRUD/ACL | adapter calls | canonical resource/permission authority | none |
| Social mutation intent | submit user operation | validate/apply canonical write + outbox | never accepts browser mutation intent |
| Recipient routing | none | resolve/freeze personal/shared inbox targets | consume frozen target snapshot |
| AP signing keys | none | sole custody + internal signing | receive signed headers only |
| Federation delivery | none | select/own canonical delivery authority mode | execute only when external authority is explicitly selected |
| Public index/feed | consume browser-safe façade | produce authoritative local/public events | projection/query/hydration acceleration |
| Public live | public FEP control/stream client | resolve principal + authorize topics | FEP session/control/fan-out + public stream routing |
| Private notification/feed hints | consume principal-scoped FEP events | emit authorized private hints | principal-scoped Redis merge/fan-out |
| Pod/resource live | Solid Notifications client adapter | Solid Notifications + authorized Pod state | no public-stream leakage |
| User-visible AP notifications | render normalized semantics | ActivityPub/Pod notification authority | refresh hint/projection only as policy permits |
| Media upload | browser-safe MediaRepository | canonical `semapps:File` resource | no direct upload authority |
| Media processing | observe resulting asset state | file authority + media-pipeline bridge | media pipeline may process behind internal boundary |

## Corrected contract classification

| Area | Classification | Owning repo / action |
| --- | --- | --- |
| ActivityPods account/actor authority | `REUSE_AS_IS` | ActivityPods |
| ActivityPods app registration semantics | `REUSE_BEHIND_ADAPTER` | Phanpy session adapter over ActivityPods/Solid |
| ActivityPods account/bootstrap | `REUSE_BEHIND_ADAPTER` | ActivityPods auth; Phanpy drives UI only |
| Pod resources/permissions | `REUSE_BEHIND_ADAPTER` | ActivityPods |
| ActivityPods collections | `REUSE_BEHIND_ADAPTER` | ActivityPods + Phanpy collection repository |
| ActivityPods canonical social mutations | `REUSE_BEHIND_ADAPTER` | Phanpy mutation repository -> ActivityPods |
| ActivityPods current AP signing authority | `REUSE_AS_IS` | ActivityPods `master`; internal only |
| ActivityPods PR #107 signer/trust hardening | `HARDEN_AND_EXPOSE` to trusted services only | Security qualification, not Phanpy prerequisite |
| Native/external remote-delivery selection | `REUSE_AS_IS` | ActivityPods deployment authority; invisible to browser |
| Public search indexing | `REUSE_AS_IS` | Federation architecture |
| Provider feed contracts/service | `HARDEN_AND_EXPOSE` | Federation architecture + browser-safe gateway |
| Provider hydration service | `HARDEN_AND_EXPOSE` | Federation architecture + browser-safe gateway |
| Public FEP-3ab2 control/stream facade | `HARDEN_AND_EXPOSE` | Sidecar + ActivityPods principal/topic authorization |
| RedPanda -> public realtime consumer | `REUSE_AS_IS` with replay integration | Federation architecture |
| Unified public live stream | `REUSE_BEHIND_ADAPTER` | Default candidate for Phanpy public live source |
| Durable public replay/resume | `NEW_WORK` inside existing realtime subsystem | Phase 9 |
| Principal-scoped notification/personal-feed hints | `REUSE_BEHIND_ADAPTER` / `HARDEN_AND_EXPOSE` | ActivityPods emitter + sidecar FEP router |
| Solid Notifications transport | `REUSE_BEHIND_ADAPTER` | ActivityPods/SemApps + Phanpy Pod-live adapter |
| ActivityPub notification semantics | `REUSE_BEHIND_ADAPTER` | ActivityPods + Phanpy notification repository |
| SemApps file substrate | `REUSE_BEHIND_ADAPTER` | ActivityPods `files` container |
| Internal media processing bridge | `REUSE_AS_IS` | ActivityPods/media pipeline; never browser-facing |
| Browser media upload adapter | `HARDEN_AND_EXPOSE` | Define exact authenticated client contract |
| Framework7 | `DEFERRED` pending Phase 3 proof | Phanpy |

## Immediate Phase 0 work still open

### ActivityPods

- identify the exact Preact/browser Solid-OIDC client primitive to use for login, restoration, logout, and token refresh while preserving the verified Data Interoperability registration flow;
- enumerate the exact canonical client mutation shapes for create/reply/follow/unfollow/like/unlike/announce/undo/edit/delete rather than relying on the generic outbox boundary alone;
- verify browser Solid Notifications endpoint discovery/subscription and reconnection behavior against the current SemApps version;
- define the browser-facing `semapps:File` upload/create contract that precedes the already-existing media pipeline;
- track PR #107 for credential/trust-boundary hardening and final federation qualification, without treating it as the signer prerequisite.

### Federation/query architecture

- audit active feed registry definitions/providers on current `main`;
- prove viewer authorization and moderation/filter policy at feed query, hydration, FEP topic authorization, and realtime delivery boundaries;
- verify snapshot cursor stability independently of live replay;
- confirm implementation status—not just design status—of every public FEP-3ab2 control/stream route;
- implement/qualify replay semantics for public durable streams;
- verify custom-feed compiler/provider support beyond the generic `custom` contract;
- verify browser-facing public search exposure.

### Phanpy

- map current Mastodon operation families to the verified replacement contracts;
- add behavior-preservation tests for feed pagination, mutations, hydration/cache invalidation, notification refresh, and live update/delete behavior before Phase 2 refactoring;
- define protocol-neutral domain types from the verified feed/hydration/FEP concepts rather than Mastodon DTO aliases;
- keep public live, private hint, and Pod-resource synchronization as separate `LiveRepository` sources even if the UI merges their effects.

## Phase 0 exit gate

Phase 0 is complete only when every client capability has:

- a classification;
- an owning repository;
- a concrete current contract or explicitly identified missing contract;
- an authority/privacy boundary;
- a testable implementation path.

The purpose is not to delay implementation. It is to ensure Phase 1 starts from contracts that actually exist, especially where the current architecture has already solved work that older files or narrow searches can hide.
