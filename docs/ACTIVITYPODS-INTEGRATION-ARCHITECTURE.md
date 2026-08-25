# Phanpy × ActivityPods Integration Architecture

## Status

Phase 0 architecture baseline. This document defines the responsibility boundaries that must be preserved while adapting Phanpy into a first-class application of the ActivityPods + Mastopod federation architecture.

The three repositories that jointly define the implementation are:

- `outlaw-dame/phanpy`
- `outlaw-dame/activity-pods`
- `outlaw-dame/mastopod-federation-architecture`

This document must be updated when implementation proves any assumption wrong.

## Core principle

Phanpy must not treat ActivityPods as a Mastodon-compatible REST server, and it must not bypass the wider federation/query architecture by reconstructing every feed directly from Pod inbox/outbox collections.

The target system is split into four client-facing concerns:

1. **Authority plane — ActivityPods Core**
   - canonical identity and WebID
   - Solid-OIDC session and application grants
   - Pod-owned/private resources
   - canonical social mutations
   - signing authority and policy-bearing writes

2. **Public read plane — Mastopod Tier 3**
   - public timeline/query services
   - OpenSearch-backed public search and discovery
   - hydration of indexed public objects
   - materialized feed/query execution

3. **Public live plane — Durable Streams projection**
   - resumable browser-facing live delivery
   - offset-based catch-up after disconnect/backgrounding
   - feed-specific or query-specific event projection
   - downstream of RedPanda; never authoritative

4. **Pod/private live plane — Solid Notifications**
   - private inbox/Pod resource changes
   - collection and feed-definition changes
   - preference/portable-state synchronization

RedPanda remains the backend durable event log. Redis Streams remain transient work queues. OpenSearch remains a rebuildable public-query projection. Durable Streams must not become an authority or replace RedPanda.

## Non-negotiable invariants

- ActivityPods remains authoritative for local account state, Pod data, permissions, canonical identity, inbox acceptance, policy-bearing mutations, and key custody.
- Public reads may be served from Tier 3 projections when suitable, but Tier 3 never becomes the source of truth.
- Non-public content must never enter public RedPanda streams, public OpenSearch indices, or public Durable Streams projections.
- Canonical social mutations must use the authoritative ActivityPods/protocol path.
- Phanpy must not connect directly to Redis, RedPanda, or OpenSearch infrastructure protocols from the browser.
- Durable Streams must expose an application-facing live contract, not raw RedPanda topic semantics.
- Initial snapshot/query paths must work correctly before live delivery is added.
- Live events must be replay-safe, duplicate-safe, and recoverable from a snapshot plus durable offset.
- Phanpy UI components should depend on protocol-neutral domain types/repositories rather than `masto` response shapes.
- Existing Mastodon support should first be moved behind those same repository contracts so the abstraction is proven before ActivityPods behavior replaces it.
- Framework7 may be adopted selectively for interaction/navigation primitives, but Phanpy's visual/component identity remains first-class.

## Target client architecture

```text
Phanpy UI
   |
   v
Protocol-neutral domain layer
   |
   +-- IdentityRepository ---------> ActivityPods authority
   +-- MutationRepository ---------> ActivityPods authority
   +-- PrivateDataRepository ------> ActivityPods / Pod
   +-- FeedRepository -------------> Tier 3 query services
   +-- SearchRepository -----------> Tier 3 + authorized Pod search
   +-- LiveRepository
   |      +-- DurableStreamsSource -> public/feed live projection
   |      +-- SolidNotificationSource -> Pod/private changes
   +-- LocalRepository ------------> IndexedDB/memory cache only
```

The domain layer, not page components, decides whether a particular operation uses ActivityPods, a public projection, a private authorized resource, or a live event source.

## Capability ownership matrix

This matrix is the baseline to verify against implementation during Phase 0. `TBD` means the exact existing endpoint/service contract still needs to be verified in code before implementation begins.

| Phanpy capability | Authority/source of truth | Efficient read path | Write path | Live path | Notes |
| --- | --- | --- | --- | --- | --- |
| Authentication/session | ActivityPods | ActivityPods | ActivityPods OIDC/application grants | session events as needed | Replace Mastodon dynamic app registration for ActivityPods accounts |
| Current identity | ActivityPods WebID/actor | ActivityPods | ActivityPods | Pod notification if identity metadata changes | Canonical account identity must not be inferred from a search projection |
| Public actor profile | Actor authority | Tier 3/hydration when indexed, direct resolution fallback | ActivityPods for local self edits | Durable Streams/public projection where useful | Canonical URI is primary cross-system identifier |
| Private profile/account state | ActivityPods | ActivityPods | ActivityPods | Solid Notifications | Never OpenSearch |
| Individual public post | Object authority | Tier 3/hydration; direct canonical resolution fallback | ActivityPods for local mutation | Durable Streams | Preserve canonical URI and revision/provenance |
| Individual non-public post | ActivityPods/authorized remote delivery | ActivityPods/authorized path | ActivityPods if local | Solid Notifications/private event path | Never public projections |
| Local public feed | canonical activities | Tier 3 derived from Stream1 | n/a | Durable Streams derived from public feed projection | Do not expose RedPanda to browser |
| Federated public feed | canonical activities | Tier 3 derived from Firehose/Stream1+2 | n/a | Durable Streams | MRF/public trust boundary already applied upstream |
| Remote-public discovery | canonical remote public activities | Tier 3 derived from Stream2/Firehose | n/a | Durable Streams where useful | Public only |
| Home feed — public portion | underlying canonical objects + authoritative following state | Tier 3 feed/query service | n/a | Durable Streams | Feed service must incorporate current authorized relationship criteria safely |
| Home feed — private/restricted portion | ActivityPods inbox/authorized state | ActivityPods | n/a | Solid Notifications/private event path | Merge/dedupe with public portion by canonical IDs |
| Following/followers | ActivityPods canonical relationship state | ActivityPods; public projection only as convenience | ActivityPods Follow/Undo | Solid/public events as appropriate | Authority wins on conflict |
| Like/favorite | ActivityPods canonical mutation | projected interaction state may accelerate reads | ActivityPods Like/Undo | Durable Streams for public; private path otherwise | Optimistic UI requires reconciliation |
| Boost/repost | ActivityPods canonical mutation | projected state may accelerate reads | ActivityPods Announce/Undo | Durable Streams for public | Same authority rule |
| Reply/create post | ActivityPods canonical mutation | after publish, Tier 3 may serve public object | ActivityPods outbox/native write path | Durable Streams for public; private path otherwise | Composer must remain protocol-blind at UI boundary |
| Edit/delete | ActivityPods canonical mutation | Tier 3 projection after propagation | ActivityPods Update/Delete | Durable Streams/tombstone projection | Tombstones/revisions must invalidate caches |
| Notifications | ActivityPods inbox is authoritative for recipient-specific state | hybrid derived read model where safe | recipient actions through ActivityPods | Solid Notifications + public projection events | Must dedupe retries and repeated federation deliveries |
| Search — public posts/actors/topics | canonical public sources | Tier 3/OpenSearch | n/a | optional Durable Streams for live-result surfaces | OpenSearch remains disposable/rebuildable |
| Search — private/Pod content | ActivityPods/Pod | authorized Pod/SPARQL/local index | ActivityPods/Pod | Solid Notifications | Must never cross public search plane |
| Media ownership/upload | ActivityPods + established media/blob architecture | media/query/CDN projection per architecture | authoritative media pipeline | processing state via appropriate service | Exact current contract TBD in Phase 0 audit |
| Collections | ActivityPods/Pod | ActivityPods/Pod | ActivityPods/Pod | Solid Notifications | Reusable user-owned semantic primitive |
| Custom feed definition | ActivityPods/Pod | ActivityPods/Pod | ActivityPods/Pod | Solid Notifications | Definition is user-owned; results are not materialized into the Pod by default |
| Custom feed execution | underlying canonical public data | Tier 3 feed compiler/query service | n/a | Durable Streams per feed/query | Definitions may reference ActivityPods collections |
| Moderation/preferences | ActivityPods/Pod + applicable platform policy | local cached projection allowed | ActivityPods/Pod | Solid Notifications | Same evaluator must apply to snapshots and live events |
| Offline cache/read position | local device unless explicitly made portable | IndexedDB/memory | local device | local | Never authoritative |
| Portable Phanpy preferences | ActivityPods/Pod | ActivityPods/Pod with local cache | ActivityPods/Pod | Solid Notifications | Keep only worthwhile cross-device state here |
| Push/system notifications | recipient/application authority | application notification service | authoritative registration path | platform push | Exact contract to be audited separately |
| App-mediated signup | ActivityPods | ActivityPods | provider provisioning capability | n/a | Later phase, not required for first ActivityPods login |

## Home-feed composition

The home feed is intentionally hybrid.

```text
ActivityPods authoritative following state
                 |
                 +--------------------------+
                 |                          |
                 v                          v
     Tier 3 public feed query        ActivityPods private inbox
                 |                          |
                 v                          v
        public followed posts        restricted/direct posts
                 |                          |
                 +-------------+------------+
                               |
                               v
                    deterministic merge/dedupe
                               |
                               v
                            Phanpy
```

The merge layer must use canonical object/activity identifiers, preserve visibility, and fail closed if visibility provenance is uncertain.

## Durable Streams role

Durable Streams belongs in the public application-delivery layer after snapshot/query contracts exist.

```text
RedPanda durable event logs
       |
       v
feed/query projection service
       |
       v
Durable Streams HTTP surface
       |
       v
Phanpy LiveRepository
```

The client should persist a last confirmed durable offset per logical stream where useful. Reconnect behavior is:

1. restore/refresh the current snapshot or verify the local cached snapshot,
2. resume from the last confirmed offset,
3. replay missed events,
4. deduplicate by canonical event/object identity and revision,
5. continue live tailing.

A Durable Streams outage must degrade to query/snapshot mode; it must not make the feed unknowable.

Potential logical streams include local public feed, federated/public feed, actor feed, notification-safe public events, and custom-feed projections. User-specific stream authorization must be designed before exposing home/custom projections that encode private relationship state.

## Collections and custom feeds

Collections are first-class Pod-owned resources. Custom feeds are user-owned query/composition definitions that may reference those collections.

```text
ActivityPods Pod
  |
  +-- Collection: favourite photographers
  +-- Collection: local journalists
  +-- Collection: excluded sources
  |
  +-- CustomFeed
        +-- inputCollections[]
        +-- actors[]
        +-- topics/tags[]
        +-- language[]
        +-- includeReplies
        +-- includeReposts
        +-- mediaMode
        +-- exclusions[]
        +-- sort strategy
        +-- visibility
                 |
                 v
           feed compiler
                 |
                 v
         Tier 3/OpenSearch
                 |
                 +-- initial snapshot/query
                 +-- Durable Streams live projection
```

A feed definition should be portable and user-owned. Feed results should normally be computed rather than permanently copied into the Pod.

## Framework7 boundary

Framework7 is an architectural decision to test early, not a mandate to rewrite Phanpy.

Candidates for selective adoption:

- app/navigation shell
- mobile page-stack behavior and swipe-back
- sheets/popovers/panels
- safe-area aware toolbars/navbars
- pull-to-refresh
- selected native-feeling transitions and interaction primitives

Components that should remain Phanpy-owned unless a proof demonstrates a clear gain:

- post/status rendering
- thread layout
- media presentation
- profile content
- composer internals
- distinctive Phanpy visual styling

The Phase 3 proof must determine whether React Router remains primary, Framework7 provides a shell around it, or Framework7 Router replaces navigation. No broad UI migration should precede that proof.

## Implementation order

### Phase 0 — Contract reconciliation

Audit all three repositories and verify the ownership matrix against current code. Record exact services/endpoints, existing feed/query/live/media contracts, and genuine gaps. No duplicated infrastructure may be introduced.

### Phase 1 — Protocol-neutral Phanpy domain model

Introduce stable domain types for actors, posts, feeds, notifications, media, relationships, collections, sessions, and search results.

### Phase 2 — Existing Mastodon behavior behind repositories

Move current `masto`-backed operations behind repository/domain interfaces while preserving behavior. This proves the abstraction before ActivityPods is introduced.

### Phase 3 — Framework7 boundary proof

Test the smallest useful navigation/shell integration and document the chosen boundary. Avoid broad component rewrites.

### Phase 4 — ActivityPods authentication and identity

Implement Solid-OIDC/application grants, WebID/actor/Pod discovery, session restoration, logout/revocation, and capability resolution.

### Phase 5 — Read-only ActivityPods social slice

Implement current profile, actor profile, individual public/non-public objects as authorized, threads, outbox/profile posts, relationships, and basic private inbox reads through the new domain model.

### Phase 6 — Authoritative ActivityPods social mutations

Implement create/reply/follow/unfollow/like/unlike/repost/unrepost/edit/delete through ActivityPods-authoritative paths with idempotent optimistic reconciliation.

### Phase 7 — Tier 3 public read plane

Wire local, federated/public, actor, topic/tag, media, and other public feed/query surfaces to existing Tier 3 contracts backed by Stream1/Stream2/Firehose/OpenSearch.

### Phase 8 — Hybrid home-feed composition

Combine Tier 3 public followed-content queries with private/restricted ActivityPods inbox data. Prove no private-content leakage and deterministic dedupe/order behavior.

### Phase 9 — Durable Streams public live plane

Add resumable, offset-based public/feed live delivery downstream of the existing event architecture. Snapshot/query behavior must remain the recovery baseline.

### Phase 10 — Solid Notifications for Pod/private changes

Add private inbox, Pod resource, preference, collection, and feed-definition live synchronization.

### Phase 11 — ActivityPods collections

Make collections reusable user-owned primitives independent of custom feeds.

### Phase 12 — Custom feeds

Store portable definitions in the Pod, compile them into Tier 3 queries, and expose live results through Durable Streams.

### Phase 13 — Search and discovery

Unify Tier 3 public search, WebFinger/actor resolution, and authorized Pod search while preserving trust boundaries.

### Phase 14 — Notifications

Build recipient-centric notification normalization, ordering, dedupe, read state, and live delivery across authoritative/private and safe public projections.

### Phase 15 — Media

Integrate the established ActivityPods/media/blob architecture for upload, metadata, processing, variants, federation attachments, retry, and deletion.

### Phase 16 — Moderation, filters, and safety

Apply user/server policy consistently to query snapshots, hydration, search, notifications, recommendations/discovery, and Durable Streams events.

### Phase 17 — Offline/resilience/local cache

Add IndexedDB snapshots, offsets, optimistic journals, drafts, read positions, network recovery, duplicate/out-of-order handling, and cache invalidation.

### Phase 18 — Framework7 expansion

Only after functional architecture is stable, selectively expand proven Framework7 primitives without sacrificing Phanpy's visual identity.

### Phase 19 — Native account provisioning/onboarding

Expose approved ActivityPods app-mediated provisioning to reduce infrastructure knowledge required for new users.

### Phase 20 — Dual-protocol surfaces

Use the already protocol-neutral domain layer to expose ATProto-backed identities, feeds, search, and interactions without another client rewrite.

## Cross-phase gates

Every phase that changes runtime behavior must preserve these gates:

- **authority:** writes reach the authoritative owner and cannot be silently accepted by projections;
- **privacy:** no private/restricted resource crosses a public stream/index/live boundary;
- **identity:** canonical URIs/IDs remain stable across normalization and projection;
- **idempotency:** retries and replay do not duplicate user-visible state or mutations;
- **ordering:** revisions/tombstones cannot resurrect stale state;
- **recovery:** live state can always be reconstructed from a snapshot/query plus durable offsets/events;
- **moderation:** snapshot and live paths apply equivalent policy;
- **performance:** UI does not directly fan out across arbitrary remote resources when a bounded service exists;
- **compatibility:** existing Mastodon behavior remains available until an intentional removal decision is made;
- **observability:** each cross-plane request/event can be correlated without exposing secrets or private payloads.

## Phase 0 deliverables still to complete

This document establishes the target boundary, but Phase 0 is not complete until repository inspection records:

- every direct `masto` dependency/call family in Phanpy and its target repository interface;
- the exact current ActivityPods frontend authentication/application-registration contract in this fork;
- the exact existing ActivityPods collection, outbox, notification, and Pod-resource APIs we should reuse;
- the current Tier 3 feed/query/OpenSearch endpoints and hydration contracts, if already implemented;
- the current Stream1/Stream2/Firehose schemas and canonical identifiers relevant to client reads;
- whether a Durable Streams server/projection already exists anywhere in the architecture or must be added;
- current media pipeline/blob contracts and which layer owns client upload orchestration;
- existing moderation/filter projection contracts that must be applied before exposing broad feeds;
- exact gaps requiring new backend work before Phanpy can consume the architecture.

Only after those are verified should Phase 1 runtime work begin.
