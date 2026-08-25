# Phanpy × ActivityPods Integration Architecture

## Status

Phase 0 architecture baseline verified against current implementation in:

- `outlaw-dame/phanpy`
- `outlaw-dame/activity-pods`
- `outlaw-dame/mastopod-federation-architecture`
- the SemApps implementation ActivityPods uses

Detailed evidence/classification is in `ACTIVITYPODS-PHASE0-CONTRACT-AUDIT.md`. Current Phanpy Mastodon-operation mapping is in `ACTIVITYPODS-PHASE0-OPERATION-MAP.md`.

## Core principle

Phanpy should become an ActivityPods application by adapting to the actual ActivityPods + Mastopod authority planes. It should not emulate Mastodon REST on top of ActivityPods and should not rebuild infrastructure already present in ActivityPods, SemApps, RedPanda/OpenSearch/Qdrant projections, FEP-3ab2 realtime, or the media pipeline.

The browser depends on protocol-neutral application contracts. Authority remains where it belongs.

## Responsibility planes

### 1. ActivityPods authority plane

ActivityPods owns:

- local account/WebID/ActivityPub actor identity;
- Solid/Data Interoperability app registration and grants;
- Pod resources and permissions;
- canonical ActivityPub outbox/inbox state;
- social mutation authority;
- blocked/muted and user-owned moderation state;
- recipient routing before external federation handoff;
- Pod actor key custody/signing;
- collections and other portable user-owned resources;
- authoritative streaming principal resolution/topic authorization;
- canonical `semapps:File` resources.

### 2. Federation/public read plane

Mastopod sidecar owns disposable acceleration/projection responsibilities:

- public indexing;
- public feed candidates;
- hydration;
- discovery/topic/graph feed providers;
- public FEP event routing;
- bounded FEP replay;
- external federation delivery only when ActivityPods explicitly selects that authority mode.

None of those become canonical user state.

### 3. Browser application plane

Phanpy owns:

- UI/UX;
- protocol-neutral domain objects;
- repository adapters;
- optimistic presentation state;
- local cache/offline state;
- composition of public, private, and Pod-owned read planes;
- recovery UX.

The browser never receives service credentials and never directly contacts Redis, RedPanda, OpenSearch, Qdrant, delivery workers, or the internal ActivityPods signer/media pipeline.

## Target client architecture

```text
Phanpy UI
   |
   v
Protocol-neutral domain/repository layer
   |
   +-- SessionRepository
   |      -> SemApps/OIDC session adapter
   |      -> ActivityPods Data Interoperability app registration/grants
   |
   +-- IdentityRepository
   |      -> ActivityPods WebID/actor authority
   |
   +-- RelationshipRepository
   |      -> canonical Follow/Accept/Reject/Block/Undo state
   |
   +-- ModerationRepository
   |      -> ActivityPods blocked/muted/private policy resources
   |
   +-- MutationRepository
   |      -> authenticated ActivityPods actor outbox
   |      -> stable clientOperationId/dedupe contract
   |
   +-- CollectionRepository
   |      -> ActivityPods Collection/OrderedCollection
   |
   +-- MediaRepository
   |      -> raw upload -> ActivityPods semapps:File URI
   |
   +-- FeedRepository / HydrationRepository
   |      -> browser-safe sidecar application facade
   |
   +-- SearchRepository
   |      -> browser-safe public search + actor resolution + authorized private search
   |
   +-- NotificationRepository
   |      -> authoritative ActivityPods notification state
   |
   +-- LiveRepository
   |      +-- PublicLiveSource  -> FEP-3ab2 public topics
   |      +-- PrivateHintSource -> FEP-3ab2 notifications / feeds/personal
   |      +-- PodLiveSource     -> Solid Notifications WebSocketChannel2023
   |
   +-- LocalRepository
          -> IndexedDB/memory cache only
```

## Authentication and application authorization

The ActivityPods React package is React Admin/MUI and is not the UI dependency for Phanpy. Phanpy should adapt the underlying SemApps browser OAuth/OIDC behavior into Preact-facing code and separately implement the already-defined ActivityPods Data Interoperability registration flow.

```text
Phanpy SessionRepository
   -> restore/login/logout OAuth/OIDC session
   -> resolve authenticated WebID
   -> discover interop:hasAuthorizationAgent
   -> verify/obtain application registration
   -> verify required AccessNeedGroups/DataGrants/special rights
   -> expose resolved capabilities to repositories
```

Account/bootstrap remains ActivityPods-owned.

## Canonical social mutation path

Core ActivityPub mutations already have a real browser-to-authority path:

```text
Phanpy MutationRepository
   -> authenticated POST to actor outbox
   -> SemApps outbox processing
   -> ActivityPods canonical object/relationship state
   -> ActivityPods-selected federation authority
```

SemApps already provides authoritative handling for Create/Update/Delete, Follow/Accept/Reject/Undo, Like/Undo, and Announce/Undo. ActivityPods adds blocked/muted collection semantics.

### Idempotency requirement

Every mutating Phanpy operation must carry a stable client operation identity. A network retry must never become a duplicate post/like/follow/etc.

The existing Mastodon fallback of retrying post creation without an idempotency key is forbidden on the ActivityPods path.

Required server contract:

```text
(actor, operationType, clientOperationId)
      + payload digest
      -> first canonical result
      -> durable dedupe
      -> identical retry returns same result
      -> different payload under same id fails closed
```

This sits at the authoritative ActivityPods mutation boundary so it remains valid under both native and sidecar federation delivery.

## Federation delivery and signing

Phanpy never chooses federation routing.

```text
ActivityPods canonical outbox
   |
   +-- native SemApps remote delivery
   |
   +-- explicit external-authority cutover
          -> frozen delivery plan / recipient routing
          -> sidecar delivery executor
          -> ActivityPods internal signer for Pod actors
```

ActivityPods `master` already has the modern account/actor/key signing authority. PR #107 is security hardening, not a prerequisite for the client architecture.

## Feed architecture

The sidecar already has a protocol-neutral feed subsystem and three concrete current definitions:

- public discovery;
- authenticated graph-personalized;
- topic.

Its internal feed routes remain service-to-service and cannot be called from Phanpy because they use provider/service credentials and accept internal `viewerId` values.

The browser facade must instead:

1. authenticate the browser session;
2. resolve/bind the ActivityPods principal server-side;
3. select only feeds authorized for that principal;
4. apply viewer policy/moderation;
5. call existing feed/hydration providers;
6. return protocol-neutral skeleton/hydration results.

No second feed engine is introduced.

## Hybrid home feed

Public and restricted/private content keep separate trust boundaries:

```text
             ActivityPods viewer/follow authority
                         |
             +-----------+-----------+
             |                       |
             v                       v
browser-safe public feed       ActivityPods authorized
query/hydration                private/restricted reads
             |                       |
             +-----------+-----------+
                         |
                         v
             deterministic merge/dedupe
                         |
                         v
                       Phanpy
```

Canonical identifiers and visibility provenance survive the merge. Private content is never copied into public RedPanda/search/live infrastructure merely to simplify the client.

## Realtime architecture

### Public/principal-scoped FEP plane

The browser FEP-3ab2 control plane is implemented and wired into current sidecar startup:

```text
POST   /streaming/control
DELETE /streaming/control
GET    /streaming/control/subscriptions
POST   /streaming/control/subscriptions
DELETE /streaming/control/subscriptions
GET    /streaming/stream
```

ActivityPods resolves the forwarded authenticated principal and authorizes topics. The sidecar owns ephemeral stream session/routing state.

Public topics are backed by existing stream consumers/unified projections. `notifications` and `feeds/personal` are principal-scoped private refresh hints delivered through private Redis fan-out, not public RedPanda.

### Browser replay is already bounded-durable

FEP has Redis-backed replay for public topics with a bounded window (current defaults roughly 900 seconds / 500 events, with a bounded replay index).

Therefore Phase 9 is **not** “implement replay from zero.” It must decide and prove long-gap behavior:

```text
cursor still inside Redis replay window
   -> replay -> live tail

cursor expired/outside replay window
   -> snapshot recovery
      OR, if product requirements justify it,
   -> RedPanda-backed longer replay
```

Whatever policy is chosen must be gap-safe, duplicate-safe, and tombstone/update order-safe.

### Pod/resource synchronization

Solid Notifications is a different plane. SemApps already has browser WebSocketChannel2023 subscription behavior. `PodLiveSource` uses it for collections, preferences, custom-feed definitions, and other Pod resource synchronization.

FEP private hints do not replace Solid Notifications, and Solid Notifications do not replace ActivityPub notification semantics.

## Search architecture

The public index and `DefaultPublicSearchService` exist, but current `main` does not wire that service into a browser/public route.

Phase 13 must expose a safe application search facade rather than allowing Phanpy to contact OpenSearch/Qdrant.

```text
Phanpy SearchRepository
   -> browser-safe application search facade
      +-- public lexical/semantic/hybrid index search
      +-- actor/WebFinger resolution
      +-- authorized Pod/private search where applicable
      +-- relationship/moderation hydration
   -> protocol-neutral results
```

The current phase-era numeric cursor in `DefaultPublicSearchService` should not become the long-term browser contract; use stable opaque pagination.

## Moderation architecture

ActivityPods already persists important moderation authority, including actor blocked/muted collections. The read/projection planes do not yet prove one equivalent viewer policy across every surface.

The production design therefore requires a server-side viewer policy decision/projection used by:

- feed candidate query;
- hydration;
- search;
- public FEP events;
- notification/personal-feed refresh paths;
- recommendations/discovery.

Browser filtering can be defense-in-depth and presentation logic, not the only enforcement boundary.

## Media architecture

SemApps already defines the browser upload contract:

```text
POST <discovered uploads container>
Content-Type: <media MIME>
Body: raw File/Blob

201 Created
Location: <canonical semapps:File URI>
```

That URI is the media identity Phanpy stores in its domain model. ActivityPods' existing internal media pipeline then performs processing and writes derived state back to the authoritative file resource.

There is no reason to expose the internal media pipeline API to the browser.

## Collections and custom feeds

ActivityPods Collection/OrderedCollection is the portable membership substrate.

Custom feeds should be Pod-owned definitions referencing those collections:

```text
CustomFeed definition
  +-- inputCollections[]
  +-- actors[]
  +-- tags/topics[]
  +-- languages[]
  +-- reply/repost/media rules
  +-- exclusions[]
  +-- ranking strategy
  +-- visibility
          |
          v
existing sidecar FeedRegistry/provider abstraction
```

The feed contract already has kind `custom`, but no concrete custom compiler/provider is currently registered on `main`. Phase 12 therefore adds that provider/compiler inside the existing feed architecture.

## Framework7 boundary

Framework7 remains a selective proof, not a rewrite mandate.

Best candidates:

- navigation shell/page stack;
- mobile transitions/swipe-back;
- sheets/popovers/panels;
- safe-area navbar/toolbars;
- pull-to-refresh.

Phanpy's distinct post/status rendering, threads, media, profiles, composer internals, and visual identity remain Phanpy-owned unless the Phase 3 proof demonstrates a specific improvement.

## Implementation phases

### Phase 0 — Contract reconciliation

Complete the remaining six contract decisions:

1. mutation idempotency;
2. quote/poll specialized semantics;
3. browser-safe feed/hydration/search facade;
4. cross-plane moderation policy;
5. FEP long-gap replay/recovery policy;
6. exact Phanpy AccessNeedGroup/DataGrant/special-right manifest.

### Phase 1 — Protocol-neutral Phanpy domain model

Create stable JS/JSDoc domain types and repository interfaces without changing UI behavior.

### Phase 2 — Wrap current Mastodon implementation

Move current `masto` behavior behind repositories and add regression tests for pagination, optimistic mutations, notifications, cache invalidation, and streaming update/delete behavior.

### Phase 3 — Framework7 boundary proof

Test only the shell/navigation primitives worth adopting.

### Phase 4 — ActivityPods session and identity

Implement OIDC session adapter, Data Interoperability registration/grants, WebID/actor/Pod discovery, restoration and revocation.

### Phase 5 — ActivityPods read-only social slice

Implement actor/object/relationship/private authorized reads.

### Phase 6 — Canonical ActivityPods mutations

Implement create/reply/edit/delete/follow/accept/reject/like/repost/block/undo operations through the authenticated actor outbox plus authoritative client-operation idempotency.

### Phase 7 — Browser-safe public read facade

Expose the existing feed/query/hydration providers with server-bound viewer identity and policy.

### Phase 8 — Hybrid home feed

Merge public projection results with authorized private/restricted ActivityPods reads.

### Phase 9 — FEP realtime recovery qualification

Use the existing FEP facade and bounded Redis replay. Implement/prove the selected expired-cursor recovery policy and gap-free handoff.

### Phase 10 — Private hints + Solid Notifications

Wire principal-scoped notification/personal-feed hints and Pod resource WebSocketChannel2023 synchronization as distinct `LiveRepository` sources.

### Phase 11 — Collections

Expose ActivityPods collections through Phanpy.

### Phase 12 — Custom feed compiler/provider

Store definitions in the Pod; compile into the existing feed-provider system.

### Phase 13 — Search/discovery facade

Expose public search, actor resolution, and authorized private search behind `SearchRepository`.

### Phase 14 — Notifications

Normalize authoritative notification state, grouping/read markers, and realtime refresh hints.

### Phase 15 — Media

Use the existing SemApps raw-upload contract and ActivityPods media pipeline.

### Phase 16 — Moderation/safety equivalence

Prove identical viewer policy across snapshot/hydration/search/live/recommendation paths.

### Phase 17 — Offline/resilience

Add IndexedDB snapshots, drafts, read positions, optimistic journals, public replay cursors, dedupe and invalidation.

### Phase 18 — Framework7 expansion

Expand only primitives that passed Phase 3.

### Phase 19 — Native account provisioning/onboarding

Expose approved ActivityPods app-mediated account provisioning.

### Phase 20 — Dual-protocol surfaces

Use the same domain/repository layer and canonical/unified architecture for ATProto-backed identities, feeds, search and interactions.

## Cross-phase invariants

Every implementation phase must preserve:

- **authority:** canonical writes reach ActivityPods, not projections;
- **privacy:** non-public data never enters public projection paths;
- **credential separation:** service credentials never enter browser code;
- **viewer binding:** browser-supplied IDs never substitute for authenticated authority;
- **idempotency:** retries cannot duplicate canonical writes;
- **ordering:** updates/deletes/tombstones cannot resurrect stale state;
- **recovery:** public live state recovers from replay/snapshot; private hints recover from authoritative reads;
- **moderation:** equivalent viewer policy across every read/live plane;
- **identity:** canonical IDs survive projections and merges;
- **compatibility:** Mastodon remains working while the abstraction migrates;
- **observability:** cross-plane operations remain correlatable without leaking secrets/private payloads.

## Phase 0 exit gate

Phase 0 ends only after the six remaining contract decisions are represented by concrete owner/API/data-flow/test requirements. Everything else should then move into Phase 1/2 implementation rather than continuing architecture discovery indefinitely.
