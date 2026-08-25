# Phanpy × ActivityPods Integration Architecture

## Status

Phase 0 architecture baseline, corrected against current implementation in:

- `outlaw-dame/phanpy`
- `outlaw-dame/activity-pods`
- `outlaw-dame/mastopod-federation-architecture`

The implementation-level evidence and current classifications live in `ACTIVITYPODS-PHASE0-CONTRACT-AUDIT.md`.

## Core principle

Phanpy must become an ActivityPods application by adapting to the real ActivityPods + Mastopod architecture, not by pretending ActivityPods is a Mastodon REST server and not by rebuilding infrastructure the architecture already has.

The browser should depend on protocol-neutral application contracts. ActivityPods and Mastopod remain responsible for authority, federation, public projections, feed execution, hydration, and event delivery.

## Responsibility planes

### 1. ActivityPods authority plane

ActivityPods owns:

- canonical local account identity and WebID;
- application registration/grants and Pod authorization;
- Pod/private resources;
- relationship and social mutation authority;
- inbox/outbox authority;
- recipient route resolution before federation handoff;
- local user key custody and delegated signing;
- collections and other user-owned semantic resources;
- authoritative principal resolution and topic authorization for authenticated streaming;
- principal-scoped private notification/personal-feed refresh emission.

Phanpy must never receive private signing keys or submit sidecar federation targets directly.

### 2. Mastopod public read plane

The federation architecture already contains a provider feed subsystem above OpenSearch/Qdrant and RedPanda projections.

Relevant current contracts include:

```text
GET  /internal/feed/definitions
POST /internal/feed/query
POST /internal/feed/hydrate
POST /internal/feed/viewed
```

These are service-internal contracts today. Phanpy must access them through a browser-safe authenticated application/session boundary; it must never receive `SIDECAR_TOKEN` or provider service credentials.

### 3. Mastopod public realtime plane

Current `main` already contains:

- `DurableStreamContracts`;
- `DurableStreamSubscriptionService`;
- SSE and WebSocket feed transports;
- `FeedStreamKafkaConsumer` from RedPanda;
- `UnifiedFeedBridge` for normalized cross-protocol public events.

The architecture also defines FEP-3ab2 as the public authenticated browser/server realtime facade. The internal feed SSE/WS routes remain service-to-service surfaces.

Target:

```text
RedPanda durable public log
       |
       v
existing feed stream consumers / unified bridge
       |
       v
sidecar FEP-3ab2 topic router + session control
       |
       +-- ActivityPods principal resolution/topic authorization
       |
       v
Phanpy PublicLiveSource
```

The current public stream substrate is realtime but not yet fully replay-capable. Existing capabilities still declare `replayCapable: false`, so Phase 9 completes replay/seek and recovery rather than inventing a new transport.

### 4. Principal-scoped private realtime plane

Low-latency private UI signaling already has a separate architecture from the public RedPanda streams:

```text
ActivityPods authoritative private state
       |
       +-- realtime-private-emitter
       |
       v
private Redis pub/sub channel
       |
       v
sidecar FEP-3ab2 principal/topic session router
       |
       v
Phanpy PrivateHintSource
```

Initial private topics are `notifications` and `feeds/personal`. These are refresh/append hints, not authoritative copies of private state and not public-stream payloads.

### 5. Pod/resource synchronization plane

Solid Notifications remains the correct synchronization mechanism for Pod/resource changes such as:

- authorized inbox/outbox collection changes;
- Pod resource changes;
- collection membership/definition changes;
- portable preferences;
- custom-feed definition changes.

This is distinct from both ActivityPub notification semantics and principal-scoped FEP private hints.

## Non-negotiable invariants

- ActivityPods remains authoritative for local account state, Pod data, permissions, canonical identity, inbox acceptance, social mutations, recipient routing and key custody.
- Public read/search/feed projections are disposable acceleration layers, not sources of truth.
- Non-public content must never cross public RedPanda, public search, or public public-topic stream boundaries.
- Principal-scoped private stream hints must be authorized against the authenticated ActivityPods principal and must not become authoritative state.
- Browser code must never connect directly to Redis, RedPanda, OpenSearch or Qdrant.
- Browser code must never receive `SIDECAR_TOKEN`, `ACTIVITYPODS_TOKEN`, or other service-to-service credentials.
- Browser-supplied `viewerId` is not authority; viewer identity must be derived/bound server-side from the authenticated application session.
- Feed snapshots and authoritative private reads must remain usable when realtime delivery is unavailable.
- Live replay -> tail handoff must be duplicate-safe and order-safe before being called durable/resumable.
- Existing Mastodon behavior remains a compatibility oracle during abstraction work.
- Framework7 may be used selectively, but Phanpy's distinct component/UI identity remains first-class.

## Target client architecture

```text
Phanpy UI
   |
   v
Protocol-neutral domain/repository layer
   |
   +-- SessionRepository ----------> ActivityPods / Solid auth + app grants
   +-- IdentityRepository ---------> ActivityPods authority
   +-- RelationshipRepository -----> ActivityPods authority
   +-- MutationRepository ---------> ActivityPods canonical social writes
   +-- PrivateDataRepository ------> ActivityPods / Pod
   +-- CollectionRepository -------> ActivityPods collections
   +-- FeedRepository -------------> browser-safe gateway -> Tier 3 feed service
   +-- HydrationRepository --------> browser-safe gateway -> Tier 3 hydration
   +-- SearchRepository -----------> Tier 3 public search + authorized Pod search
   +-- NotificationRepository -----> ActivityPods notification semantics
   +-- MediaRepository ------------> ActivityPods semapps:File -> existing media pipeline
   +-- LiveRepository
   |      +-- PublicLiveSource ----> public FEP-3ab2 -> public stream router
   |      +-- PrivateHintSource ---> public FEP-3ab2 -> principal-scoped private hints
   |      +-- PodLiveSource -------> Solid Notifications
   +-- LocalRepository ------------> IndexedDB/memory only
```

## Public feed contract already available

The current Tier 3 contract already models:

- feed kinds: graph, discovery, topic, locality, notifications, custom;
- sources: Stream1, Stream2, canonical, firehose, unified;
- public/authenticated/internal visibility;
- ranking: chronological, ranked, blended;
- stable feed skeleton IDs;
- canonical/AP object identifiers;
- filters for tags/languages/authors;
- pagination cursor;
- hydration-required capability;
- hydrated actors, content, media, engagement and provenance;
- explicit hydration omissions such as deleted, blocked and viewer-not-allowed.

Phanpy's domain types should derive from these protocol-neutral concepts instead of from Mastodon response DTOs.

## Browser realtime contract

The FEP-3ab2 design defines a public control/session surface owned by the sidecar:

```text
POST   /streaming/control
DELETE /streaming/control
GET    /streaming/control/subscriptions
POST   /streaming/control/subscriptions
DELETE /streaming/control/subscriptions
GET    /streaming/stream
```

The sidecar does not become the identity authority. It forwards browser auth context to ActivityPods internal principal resolution and asks ActivityPods to authorize requested topics.

Stable public topics include:

- `feeds/public/local`
- `feeds/public/remote`
- `feeds/public/unified`
- `feeds/public/canonical`
- `feeds/local`
- `feeds/global`
- `notifications`
- `feeds/personal`

`notifications` and `feeds/personal` are principal-scoped private topics. They use the same browser FEP connection but not the same backing public event source.

### Existing public event envelope

Current internal public stream envelopes contain:

```text
stream
 eventId
 cursor
 occurredAt
 schema
 payload
```

The feed Kafka consumer maps actual Kafka partition/offset information into the cursor. The unified bridge emits canonical normalized public events without performing protocol writes.

### Required replay completion

Before Phanpy treats public stream delivery as resumable durable live delivery, Phase 9 must define and prove:

1. exact Kafka partition/offset cursor semantics;
2. bounded seek/replay from a prior cursor;
3. retention-expired cursor behavior;
4. snapshot fallback when replay cannot be satisfied;
5. replay/live cutover without gaps;
6. dedupe for a replayed event also observed live;
7. delete/update/tombstone ordering;
8. authorization binding for viewer-specific subscriptions;
9. equivalent moderation/filter policy on snapshot and live paths.

Private notification/personal-feed hints do not need to become a second durable private log: reconnect can requery authoritative ActivityPods/feed state.

## Canonical mutation and delivery boundary

Phanpy always writes through ActivityPods canonical social mutation/outbox authority.

ActivityPods already supports an explicit native-vs-external remote-delivery authority strategy:

```text
Phanpy mutation
      |
      v
ActivityPods canonical state/outbox
      |
      +-- native authority -> SemApps federation delivery
      |
      +-- explicit external cutover -> frozen Delivery Plan -> sidecar delivery
                                            |
                                            v
                              ActivityPods internal signer for Pod actors
```

This deployment choice is invisible to Phanpy. The client does not submit recipient targets or select a delivery executor.

## Hybrid home-feed composition

Public followed content and private/restricted content have different trust boundaries.

```text
ActivityPods authoritative viewer/follow state
                  |
          +-------+--------+
          |                |
          v                v
browser-safe Tier 3     ActivityPods authorized
public feed query       private/restricted reads
          |                |
          +-------+--------+
                  |
                  v
         deterministic merge/dedupe
                  |
                  v
               Phanpy
```

Public live events can append/invalidate the public side. `feeds/personal` private hints can trigger authoritative requery of the private/personal side. The merge must preserve canonical identifiers and visibility provenance. Public query/live infrastructure must never receive restricted content simply to make the client merge easier.

## Collections and custom feeds

ActivityPods collections already provide the Pod-owned membership substrate. Custom feed definitions should be portable user-owned resources that can reference those collections.

```text
ActivityPods Pod
  |
  +-- Collection: favourite photographers
  +-- Collection: local journalists
  +-- Collection: excluded sources
  |
  +-- CustomFeed definition
        +-- inputCollections[]
        +-- actors[]
        +-- topics/tags[]
        +-- languages[]
        +-- reply/repost/media rules
        +-- exclusions[]
        +-- ranking/sort strategy
        +-- visibility
                  |
                  v
       Tier 3 custom-feed provider/compiler
                  |
          +-------+--------+
          |                |
          v                v
       snapshot          public live/refresh hints
       query
```

Feed results normally remain computed projections; the Pod stores the portable definition, not a permanent duplicate of every result.

## Media boundary

ActivityPods already owns a SemApps `files` container accepting image/video `semapps:File` resources, and the existing internal media pipeline can resolve trusted local file resources, process media, and write processed/safety/moderation metadata back to the authoritative file resource.

Therefore Phase 15 is not a new media backend. Phanpy needs a browser-safe authenticated upload adapter that produces/returns the canonical `semapps:File` URI and observes pipeline-derived state through ActivityPods.

## Framework7 boundary

Framework7 remains an early proof, not a rewrite mandate.

Good candidates:

- application/navigation shell;
- mobile page stack/swipe-back;
- sheets/popovers/panels;
- safe-area toolbars/navbars;
- pull-to-refresh;
- selected native-feeling transitions.

Keep Phanpy-owned unless a proof shows a concrete gain:

- status/post rendering;
- thread layout;
- media presentation;
- profiles;
- composer internals;
- distinctive visual styling.

## Implementation order

### Phase 0 — Contract reconciliation

Finish exact browser auth/session, canonical mutation shapes, feed registry/provider, moderation, Solid Notifications discovery, FEP route implementation status, public search, and browser media-upload contract reconciliation. Record default-branch vs active-unmerged implementation state where relevant.

### Phase 1 — Protocol-neutral Phanpy domain model

Introduce stable types for session, identity, actor, post, feed skeleton, hydrated object, relationship, notification, media, collection and live envelopes.

Model live delivery as three sources: public stream events, principal-scoped private hints, and Pod/resource notifications.

Use the verified Tier 3 feed/hydration/FEP contracts as inputs; do not model the domain as Mastodon DTO aliases.

### Phase 2 — Existing Mastodon behavior behind repositories

Move current `masto` behavior behind the new repository layer without changing user-visible behavior. Add focused regression tests for feed pagination, mutations, notifications and live update/delete handling.

### Phase 3 — Framework7 boundary proof

Test the smallest useful shell/navigation integration and document whether Framework7 Router, a wrapper shell, or current routing remains primary.

### Phase 4 — ActivityPods authentication and identity

Implement Solid-OIDC/application registration/grants, WebID/actor/Pod discovery, session restoration, logout/revocation and capability resolution.

### Phase 5 — Read-only ActivityPods social slice

Implement authorized actor/object/relationship/private-inbox reads through the domain layer.

### Phase 6 — Authoritative ActivityPods social mutations

Implement create/reply/follow/unfollow/like/unlike/repost/unrepost/edit/delete through ActivityPods canonical mutation paths. Native-vs-sidecar delivery and signing remain invisible to Phanpy.

### Phase 7 — Tier 3 public read plane

Adapt the **existing** `src/feed/` definitions/query/hydration subsystem to a browser-safe authenticated application boundary. Do not rebuild the feed engine.

Key work:

- server-bound viewer identity;
- safe public/authenticated feed exposure;
- snapshot cursor validation;
- hydration integration;
- moderation/policy equivalence;
- Phanpy Feed/Hydration repositories.

### Phase 8 — Hybrid home-feed composition

Combine the public following feed with authorized private/restricted ActivityPods reads and prove visibility-safe deterministic merge/dedupe behavior.

### Phase 9 — Complete durable public replay and FEP browser realtime

Build on the **existing** RedPanda consumers, stream subscription service, unified bridge, and FEP-3ab2 public control-plane design.

Complete/qualify:

- FEP control/subscription/stream routes;
- ActivityPods principal resolution/topic authorization integration;
- RedPanda offset replay/seek;
- expired-cursor/snapshot fallback;
- replay/live gap-free handoff;
- viewer-bound authorization/filters;
- Phanpy `PublicLiveSource`.

### Phase 10 — Private hints and Solid Notifications

Implement both private synchronization responsibilities without conflating them:

- `PrivateHintSource`: FEP `notifications` / `feeds/personal` principal-scoped refresh hints;
- `PodLiveSource`: Solid Notifications for authorized Pod/resource/preference/collection/custom-feed-definition changes.

### Phase 11 — ActivityPods collections

Expose existing ActivityPods Collection/OrderedCollection capabilities through Phanpy's collection repository and UI.

### Phase 12 — Custom feeds

Store portable definitions in the Pod and connect them to the existing Tier 3 `custom` feed contract/provider architecture. Add collection operands and live refresh behavior without duplicating collections.

### Phase 13 — Search and discovery

Expose/harden public search and combine it with actor/WebFinger resolution and authorized Pod search.

### Phase 14 — Notifications

Normalize recipient-centric notification semantics, read state, dedupe and live refresh across authoritative ActivityPub/ActivityPods notification state plus principal-scoped realtime hints.

### Phase 15 — Media

Implement the browser upload adapter over ActivityPods `semapps:File` resources and integrate the already-established media processing pipeline for variants, safety/moderation metadata, retry and deletion.

### Phase 16 — Moderation, filters and safety

Prove equivalent user/server policy on feed snapshots, hydration, search, notifications, public realtime and recommendations/discovery.

### Phase 17 — Offline/resilience/local cache

Add IndexedDB snapshots, public replay cursors, optimistic journals, drafts, read positions, duplicate/out-of-order handling and cache invalidation. Private hints recover by authoritative requery rather than requiring a second private durable log.

### Phase 18 — Framework7 expansion

Expand only the Framework7 primitives that passed Phase 3 and fit stable application behavior.

### Phase 19 — Native account provisioning/onboarding

Expose approved ActivityPods app-mediated provisioning to reduce infrastructure knowledge required for new users.

### Phase 20 — Dual-protocol surfaces

Use the protocol-neutral domain layer and existing canonical/unified architecture to expose ATProto-backed identities, feeds, search and interactions without another client rewrite.

## Cross-phase gates

Every runtime phase must preserve:

- **authority:** writes reach their true owner;
- **privacy:** private/restricted resources never enter public projection/live paths;
- **credential separation:** service credentials never enter browser code;
- **viewer binding:** client-provided IDs never substitute for authenticated authority;
- **identity:** canonical IDs survive normalization/projection;
- **idempotency:** retry/replay cannot duplicate visible state or writes;
- **ordering:** update/delete/tombstone ordering cannot resurrect stale state;
- **recovery:** snapshot plus durable public replay reconstructs public live state; private hints recover from authoritative reads;
- **moderation:** snapshot/hydration/live apply equivalent policy;
- **performance:** bounded provider APIs replace client fan-out where available;
- **compatibility:** Mastodon remains functional through abstraction migration;
- **observability:** cross-plane work is correlatable without exposing secrets/private payloads.

## Phase 0 completion gate

Phase 0 ends when the remaining unknowns have concrete answers for:

- exact browser Solid-OIDC/session implementation while preserving Data Interoperability app grants;
- exact canonical social mutation entry points/shapes;
- Solid Notifications browser discovery/subscription;
- exact browser `semapps:File` upload contract;
- implementation status of the FEP-3ab2 public control/stream routes;
- active Tier 3 feed definitions/providers and custom-feed status;
- viewer/moderation policy enforcement around feed/hydration/FEP live;
- public search exposure;
- replay implementation requirements for current `replayCapable: false` public streams.

At that point Phase 1 can begin from verified contracts rather than assumptions.
