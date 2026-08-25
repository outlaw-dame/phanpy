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
- collections and other user-owned semantic resources.

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

The current stream subsystem is realtime but **not yet replay-capable**. Startup declares `replayCapable: false`, and connection cursor state is in-process in v1.

Therefore the public live work is not a greenfield Durable Streams implementation. It is completion and exposure of the existing subsystem:

```text
RedPanda durable log
       |
       v
existing feed stream consumers / unified bridge
       |
       v
existing SSE + WebSocket stream contract
       |
       +-- missing: durable seek/replay + browser-safe auth
       |
       v
Phanpy LiveRepository
```

### 4. Pod/private realtime plane

Private and Pod-owned state belongs on the ActivityPods/Solid Notifications side:

- private/restricted inbox changes;
- Pod resource changes;
- collection changes;
- portable preferences;
- custom-feed definition changes.

ActivityPub notification objects and Solid Notifications transport are separate concerns and must remain separate in the client model.

## Non-negotiable invariants

- ActivityPods remains authoritative for local account state, Pod data, permissions, canonical identity, inbox acceptance, social mutations, recipient routing and key custody.
- Public read/search/feed projections are disposable acceleration layers, not sources of truth.
- Non-public content must never cross public RedPanda, public search, or public live-stream boundaries.
- Browser code must never connect directly to Redis, RedPanda, OpenSearch or Qdrant.
- Browser code must never receive `SIDECAR_TOKEN`, `ACTIVITYPODS_TOKEN`, or other service-to-service credentials.
- Browser-supplied `viewerId` is not authority; viewer identity must be derived/bound server-side from the authenticated application session.
- Feed snapshots must remain usable when realtime delivery is unavailable.
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
   +-- MediaRepository ------------> established media/blob pipeline
   +-- LiveRepository
   |      +-- PublicLiveSource ----> browser-safe gateway -> existing SSE/WS subsystem
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

## Public realtime contract already available

Current event envelopes contain:

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

Before Phanpy treats this as resumable durable live delivery, Phase 9 must define and prove:

1. exact Kafka partition/offset cursor semantics;
2. bounded seek/replay from a prior cursor;
3. retention-expired cursor behavior;
4. snapshot fallback when replay cannot be satisfied;
5. replay/live cutover without gaps;
6. dedupe for a replayed event also observed live;
7. delete/update/tombstone ordering;
8. authorization binding for viewer-specific subscriptions;
9. equivalent moderation/filter policy on snapshot and live paths.

No new raw RedPanda-facing browser protocol should be introduced.

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

The merge must preserve canonical identifiers and visibility provenance. Public query/live infrastructure must never receive restricted content simply to make the client merge easier.

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
       snapshot          public live
       query             projection
```

Feed results normally remain computed projections; the Pod stores the portable definition, not a permanent duplicate of every result.

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

Finish exact auth/session, mutation, feed registry/provider, moderation, Solid Notifications and media contract reconciliation. Record default-branch vs active-unmerged implementation state where relevant.

### Phase 1 — Protocol-neutral Phanpy domain model

Introduce stable types for session, identity, actor, post, feed skeleton, hydrated object, relationship, notification, media, collection and live envelopes.

Use the verified Tier 3 feed/hydration contracts as one input; do not model the domain as Mastodon DTO aliases.

### Phase 2 — Existing Mastodon behavior behind repositories

Move current `masto` behavior behind the new repository layer without changing user-visible behavior. Add focused regression tests for feed pagination, mutations and live update/delete handling.

### Phase 3 — Framework7 boundary proof

Test the smallest useful shell/navigation integration and document whether Framework7 Router, a wrapper shell, or current routing remains primary.

### Phase 4 — ActivityPods authentication and identity

Implement Solid-OIDC/application registration/grants, WebID/actor/Pod discovery, session restoration, logout/revocation and capability resolution.

### Phase 5 — Read-only ActivityPods social slice

Implement authorized actor/object/relationship/private-inbox reads through the domain layer.

### Phase 6 — Authoritative ActivityPods social mutations

Implement create/reply/follow/unfollow/like/unlike/repost/unrepost/edit/delete through ActivityPods canonical mutation paths. Sidecar delivery/signing remains invisible to Phanpy.

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

### Phase 9 — Complete durable replay and expose public realtime

Build on the **existing** SSE/WS + `FeedStreamKafkaConsumer` + `UnifiedFeedBridge` implementation.

Add:

- RedPanda offset replay/seek;
- expired-cursor/snapshot fallback;
- replay/live gap-free handoff;
- browser-safe authentication;
- viewer-bound authorization/filters;
- Phanpy LiveRepository integration.

### Phase 10 — Solid Notifications for Pod/private changes

Implement private inbox/Pod resource/preference/collection/custom-feed-definition synchronization through Solid Notifications.

### Phase 11 — ActivityPods collections

Expose existing ActivityPods Collection/OrderedCollection capabilities through Phanpy's collection repository and UI.

### Phase 12 — Custom feeds

Store portable definitions in the Pod and connect them to the existing Tier 3 `custom` feed contract/provider architecture. Add collection operands and live projection behavior without duplicating collections.

### Phase 13 — Search and discovery

Expose/harden public search and combine it with actor/WebFinger resolution and authorized Pod search.

### Phase 14 — Notifications

Normalize recipient-centric notification semantics, read state, dedupe and live updates across ActivityPub notification objects, ActivityPods state and safe public projections.

### Phase 15 — Media

Integrate the established ActivityPods/media/blob architecture for upload, processing, variants, attachments, retry and deletion.

### Phase 16 — Moderation, filters and safety

Prove equivalent user/server policy on feed snapshots, hydration, search, notifications, public realtime and recommendations/discovery.

### Phase 17 — Offline/resilience/local cache

Add IndexedDB snapshots, replay cursors, optimistic journals, drafts, read positions, duplicate/out-of-order handling and cache invalidation.

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
- **recovery:** snapshot plus durable replay reconstructs live state;
- **moderation:** snapshot/hydration/live apply equivalent policy;
- **performance:** bounded provider APIs replace client fan-out where available;
- **compatibility:** Mastodon remains functional through abstraction migration;
- **observability:** cross-plane work is correlatable without exposing secrets/private payloads.

## Phase 0 completion gate

Phase 0 ends when the remaining unknowns have concrete answers for:

- ActivityPods Solid-OIDC/session and application-grant runtime;
- exact canonical social mutation entry points;
- Solid Notifications browser discovery/subscription;
- current media/blob client contract;
- active Tier 3 feed definitions/providers and custom-feed status;
- viewer/moderation policy enforcement around feed/hydration/live;
- public search exposure;
- replay implementation requirements for current `replayCapable: false` streams.

At that point Phase 1 can begin from verified contracts rather than assumptions.
