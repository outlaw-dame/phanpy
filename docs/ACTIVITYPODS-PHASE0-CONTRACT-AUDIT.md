# ActivityPods Integration — Phase 0 Contract Audit

## Purpose

This is the implementation-level companion to `ACTIVITYPODS-INTEGRATION-ARCHITECTURE.md` and `ACTIVITYPODS-PHASE0-OPERATION-MAP.md`.

It records verified runtime facts across:

- `outlaw-dame/phanpy`
- `outlaw-dame/activity-pods`
- `outlaw-dame/mastopod-federation-architecture`
- the SemApps implementation ActivityPods currently builds upon

Historical design text is not treated as runtime truth where current code differs. Active unmerged ActivityPods work is recorded separately from `master`.

Classifications:

- `REUSE_AS_IS`
- `REUSE_BEHIND_ADAPTER`
- `HARDEN_AND_EXPOSE`
- `NEW_WORK`
- `DEFERRED`

## 1. Phanpy baseline

Phanpy's current implementation is intentionally Mastodon-shaped. The migration target is not a second protocol switch scattered through components; it is a protocol-neutral repository boundary beneath the existing UI.

```text
Phanpy UI
   |
   v
protocol-neutral repositories
   |
   +-- Session / Identity
   +-- Feed / Hydration / Search
   +-- Mutation / Relationship / Moderation
   +-- Notification
   +-- Media
   +-- Collection / Custom Feed
   +-- Live
```

Existing Mastodon behavior remains the regression oracle while Phase 2 moves current `masto` operations behind those repositories.

The detailed operation-by-operation mapping is in `ACTIVITYPODS-PHASE0-OPERATION-MAP.md`.

## 2. ActivityPods identity, auth, and application grants

### Canonical account/bootstrap authority — `REUSE_BEHIND_ADAPTER`

ActivityPods owns account creation, WebID, ActivityPub actor provisioning, authorization registries, storage/preferences metadata, type indexes, and optional ATProto identity provisioning. Phanpy may drive the user-facing flow but must not reproduce this state locally.

### Application registration — `REUSE_BEHIND_ADAPTER`

The existing ActivityPods app framework already implements Solid Data Interoperability registration semantics:

1. fetch the user's WebID/actor;
2. discover `interop:hasAuthorizationAgent`;
3. inspect the authorization agent and its `interop:registeredAgent` Link relation;
4. redirect to `interop:hasAuthorizationRedirectEndpoint` with the app `client_id` when registration is missing;
5. verify required AccessNeedGroups, AccessGrants, DataGrants, and ActivityPods special rights after registration.

Server-side ActivityPods registration handling processes `Create`, `Update`, and `Delete` for `interop:ApplicationRegistration`, verifies grants, mirrors grant state, and starts special-right listeners where required.

### Browser auth implementation — resolved architectural choice

`@activitypods/react` is React Admin/MUI and should not be imported into Phanpy's Preact UI. Its current frontend dependencies are SemApps `1.1.2` packages, while the Pod-provider backend is pinned to SemApps `1.1.4`.

SemApps also contains the browser OAuth/OIDC auth-provider implementation used by its frontend stack. The correct Phanpy approach is to adapt the underlying SemApps/OIDC session behavior behind `SessionRepository`, not adopt React Admin components.

Phase 4 therefore needs a Preact-facing adapter and compatibility tests against the ActivityPods provider; it does **not** need a new identity protocol.

## 3. Canonical ActivityPub social writes

### Browser write boundary — `REUSE_BEHIND_ADAPTER`

The canonical client write boundary is the authenticated ActivityPub actor outbox.

SemApps' frontend `useOutbox` behavior POSTs an ActivityStreams payload to the actor outbox through the authenticated data provider. The backend outbox accepts either:

- a complete Activity; or
- a bare ActivityStreams object, which it wraps in `Create`.

This means Phanpy does not need a Mastodon-shaped REST facade merely to create ActivityPub activities.

### Core activity semantics already implemented

SemApps' current ActivityPub services implement the authoritative side effects for:

- `Create`
- `Update`
- `Delete`
- `Follow`
- `Accept`
- `Reject`
- `Undo`
- `Like`
- `Announce`

ActivityPods also adds concrete local moderation-related activity handling, including actor blocked/muted collections. In particular, current `master` has dedicated `activitypub.blocked` and `activitypub.muted` services and persistent actor collections for those states.

Therefore the core Phanpy operations create/reply/edit/delete/follow/unfollow/accept/reject/like/unlike/repost/unrepost/block and applicable undo flows are adapter work over canonical ActivityPub/ActivityPods authority, not new federation protocols.

### Native vs external federation execution is invisible to Phanpy

ActivityPods explicitly owns the remote-delivery authority choice:

```text
Phanpy mutation
   -> ActivityPods canonical actor outbox/state
      -> native SemApps remote delivery
         OR
      -> explicit external-authority durable handoff
         -> sidecar executor
```

When external authority is selected, ActivityPods freezes the remote recipient routing snapshot before handoff. Phanpy never submits recipient inboxes, chooses a delivery worker, writes Redis/RedPanda, or calls the signer.

### Idempotency is a real missing contract — `NEW_WORK`

Phanpy currently attempts Mastodon post creation with `Idempotency-Key` and can retry without it. That behavior must **not** be carried into the ActivityPods path.

The audited canonical outbox flow does not currently establish a Phanpy-grade client-operation dedupe contract. Phase 6 therefore requires an authoritative idempotency mechanism, for example:

```text
clientOperationId
  -> authenticated actor + operation scope
  -> durable dedupe record / canonical result
  -> safe replay of the same result
```

Required properties:

- stable operation ID generated before the first network attempt;
- actor-scoped and operation-scoped dedupe;
- durable across process restarts and retries;
- identical retry cannot create a second object/activity;
- mismatched payload under the same operation ID fails closed;
- bounded retention with explicit semantics;
- works whether ActivityPods uses native or external federation delivery.

This is the largest remaining correctness gap in the core mutation boundary.

### Quote and poll semantics are not assumed

Generic ActivityStreams support is not proof that Phanpy's full quote-post and poll UX has an equivalent deployed ActivityPods contract.

No current ActivityPods-specific native quote implementation was established by this audit, and poll creation/voting needs explicit `Question`/vote/container/permission verification. These remain focused Phase 0/6 capability gaps rather than being faked with Mastodon DTOs or plain links.

## 4. ActivityPods signing authority

### Current `master` signer — `REUSE_AS_IS`, internal only

ActivityPods `master` already registers:

```text
POST /api/internal/signatures/batch
```

The executable local signer authority chain is:

```text
auth.account.findByWebId(actorUri)
  -> exact local account/WebID match
  -> activitypub.actor.get(actorUri)
  -> exact actor ID match
  -> keys.getOrCreateWebIdKeys(RSA) in account dataset
  -> intersect with actor.publicKey linkage
  -> require exactly one owner/controller-matching attached RSA key
  -> derive signer-controlled keyId
  -> return signed HTTP headers
```

Private key material remains inside ActivityPods.

### PR #107 is hardening, not signer introduction

ActivityPods PR #107 is security forward-port/hardening around the already-existing modern signer: credential separation, token/date handling, adjacent discovery surfaces, ATProto signing authority, password-verification separation, and repository/config hygiene.

Phanpy does not depend on PR #107 to obtain a signing boundary and must never call the internal signing route directly. Final deployment qualification should still track that PR because its trust-boundary hardening matters to the full system.

## 5. Collections and user-owned private state

### ActivityPods collections — `REUSE_BEHIND_ADAPTER`

The app framework already supports Collection/OrderedCollection resources, membership operations, attached collections, SPARQL update operations, pagination/dereference/sort behavior, and provisioning.

Phanpy lists, bookmarks, portable grouping state, and custom-feed operands should reuse this substrate where their semantics fit rather than create a second list database.

### Relationship DTOs must be decomposed

Mastodon relationship responses combine federated relationship state with local presentation/preferences. In ActivityPods:

- federated Follow/Block/etc. state belongs to canonical ActivityPub/ActivityPods state;
- user-private choices such as notification preference, repost visibility preference, notes, mute expiry, and similar UI policy belong to Pod-owned resources/settings.

Phanpy's domain model must not pretend these are one wire object.

## 6. Solid Notifications and private synchronization

### Browser Solid Notifications — `REUSE_BEHIND_ADAPTER`

The SemApps frontend implementation already provides the relevant browser flow through `subscribeToUpdates` and `notify:WebSocketChannel2023` semantics:

1. discover the storage description/subscription service for the resource/container;
2. create a notification channel subscription;
3. open the returned WebSocket channel;
4. consume change notifications and reconnect using the SemApps helper behavior.

This is separate from the backend `solid-notifications.listener`, which is appropriate for application-server watchers and should not be copied into the browser.

Phanpy's `PodLiveSource` should therefore adapt the browser WebSocketChannel2023 behavior and test it against the ActivityPods-pinned SemApps/provider combination.

### Three live/private concepts remain separate

```text
ActivityPub notification state
  -> user-visible social semantics / authoritative data

FEP-3ab2 notifications + feeds/personal
  -> principal-scoped low-latency refresh hints

Solid Notifications
  -> Pod/resource/collection/preference synchronization
```

A reconnect can recover private notification/personal-feed UI by authoritative requery; private hints do not need to become a second durable private event log.

## 7. Media

### Browser upload contract — `REUSE_BEHIND_ADAPTER`

ActivityPods has a controlled `semapps:File` container for image/video resources. SemApps' frontend data-provider file handling already defines the browser upload pattern:

```text
POST <uploads-container>
Content-Type: <file MIME type>
Body: raw File/Blob bytes

201 Created
Location: <canonical semapps:File URI>
```

The uploads container is discovered by SemApps data-provider metadata/config logic rather than hard-coded in the UI.

Phanpy `MediaRepository` can therefore adapt this raw-upload contract and retain the canonical `Location` URI as media identity.

### Processing pipeline — `REUSE_AS_IS`, service-internal

The existing ActivityPods media-pipeline bridge verifies trusted local file resources, constrains filesystem access, validates MIME/size, and writes processed asset/safety/moderation metadata back to the authoritative file resource.

Phanpy never calls `/api/internal/media-pipeline/*` directly.

## 8. Public feed/query/hydration plane

### Existing provider feed subsystem — `HARDEN_AND_EXPOSE`

Current sidecar contracts already model:

- graph/discovery/topic/locality/notifications/custom feed kinds;
- Stream1/Stream2/canonical/firehose/unified sources;
- public/authenticated/internal visibility;
- chronological/ranked/blended ranking;
- stable skeleton IDs and cursors;
- tag/language/author filters;
- hydration/provenance;
- omission reasons including deleted/blocked/viewer-not-allowed.

Internal routes exist for definitions/query/hydration/viewership and realtime. They use sidecar service credentials and provider permission headers. They are not browser APIs.

Current feed query code also accepts `viewerId` in its internal request. The browser-safe facade must bind that viewer server-side from the authenticated ActivityPods session rather than trust arbitrary browser input.

### Concrete feed registry on current `main`

Three feed definitions are currently registered:

1. `urn:activitypods:feed:public-discovery:v1`
2. `urn:activitypods:feed:graph-personalized:v1`
3. `urn:activitypods:feed:topic:v1`

They use the existing search candidate provider with OpenSearch/Qdrant-backed execution.

The contract supports `custom`, but this audit found no concrete custom-feed compiler/provider registered on current `main`. Phase 12 therefore contains real compiler/provider work while reusing the existing registry/contracts and ActivityPods collections.

## 9. Public search

### Indexing exists, browser search exposure does not — `HARDEN_AND_EXPOSE` + facade work

`SearchIndexerService` and the public OpenSearch projection exist.

`DefaultPublicSearchService` also exists and supports lexical/semantic/hybrid query construction over `public-content-v1`, but current code search found it only in its implementation/documentation and not instantiated/wired into a Fastify/browser route.

Therefore Phanpy must **not** call OpenSearch/Qdrant directly and must not assume a public search API already exists. Phase 13 needs a browser-safe search facade that:

- instantiates/reuses the existing public search service or the newer provider substrate where appropriate;
- returns canonical stable IDs plus hydration rather than leaking index documents;
- binds authenticated viewer context server-side where viewer policy is relevant;
- composes actor/WebFinger resolution with indexed search;
- applies the same moderation/privacy policy as feed/hydration/live;
- uses opaque stable pagination rather than the current phase-era numeric `from` cursor.

## 10. FEP-3ab2 browser realtime

### Browser control plane is implemented, not merely designed — `REUSE_BEHIND_ADAPTER` / `HARDEN_AND_EXPOSE`

Current sidecar `main` contains concrete FEP-3ab2 Fastify routes and runtime startup wiring for:

```text
POST   /streaming/control
DELETE /streaming/control
GET    /streaming/control/subscriptions
POST   /streaming/control/subscriptions
DELETE /streaming/control/subscriptions
GET    /streaming/stream
```

ActivityPods provides internal principal resolution and topic authorization to the sidecar. The browser never receives those internal service credentials.

Private `notifications` and `feeds/personal` use principal-scoped private Redis fan-out. Public topics consume the existing public stream infrastructure.

### Bounded browser replay already exists

The FEP runtime has Redis-backed ticket/subscription state and a bounded public replay store. Current startup defaults are approximately:

- 900-second replay TTL;
- 500 replay events;
- 10,000 replay-index entries.

Therefore the internal `DurableStreamSubscriptionService` capability `replayCapable: false` must not be misread as “the browser FEP facade has no replay.”

The remaining Phase 9 decision is narrower:

> Is bounded Redis replay plus snapshot fallback sufficient, or must expired/long-gap public cursors be reconstructed from RedPanda retention/offsets?

That must be defined and tested, including replay/live gap safety and tombstone ordering, but FEP streaming itself is not greenfield.

## 11. Moderation and policy equivalence

### ActivityPods already owns important moderation state

Current `master` contains concrete actor blocked and muted collection services and authenticated moderation-report/action APIs.

### Feed/hydration/live equivalence is not yet proven — `NEW_WORK` at the application boundary

The audited feed service enforces feed visibility and provider/source validity, and hydration contracts can represent `blocked` / `viewer_not_allowed` omissions. However, the generic `DefaultPodFeedService` / `DefaultPodHydrationService` code inspected here does not itself retrieve ActivityPods blocked/muted state or apply a unified viewer moderation policy.

Likewise, FEP topic authorization proves access to a topic; it is not proof that every event payload has undergone the same per-viewer moderation filtering as snapshots/hydration/search.

This is a real cross-plane requirement, not documentation polish. Before ActivityPods-backed Phanpy is production-ready, one authoritative viewer-policy projection/decision path must cover:

- feed candidate results;
- hydration;
- public search;
- public live events;
- notification/personal-feed refresh behavior;
- relationship/account discovery;
- any recommendation/discovery surfaces.

The browser should not be the sole enforcement point.

## 12. Corrected classification matrix

| Area | Classification | Owner/action |
| --- | --- | --- |
| Account/WebID/actor authority | `REUSE_AS_IS` | ActivityPods |
| Solid/Data Interoperability app registration | `REUSE_BEHIND_ADAPTER` | Phanpy SessionRepository over ActivityPods/SemApps |
| Browser OAuth/OIDC session behavior | `REUSE_BEHIND_ADAPTER` | Adapt SemApps auth logic; Preact UI remains Phanpy-owned |
| Pod resources/ACL | `REUSE_BEHIND_ADAPTER` | ActivityPods |
| Collections | `REUSE_BEHIND_ADAPTER` | ActivityPods + Phanpy CollectionRepository |
| Core AP Create/Update/Delete/Follow/Like/Announce/Undo | `REUSE_BEHIND_ADAPTER` | Authenticated ActivityPods/SemApps outbox |
| Client mutation idempotency | `NEW_WORK` | ActivityPods-authoritative dedupe boundary |
| Quote/poll specialized semantics | `NEW_WORK` / verify before enabling | ActivityPods/SemApps + Phanpy capability gating |
| AP signing | `REUSE_AS_IS` | ActivityPods internal signer |
| PR #107 trust hardening | `HARDEN_AND_EXPOSE` internally | ActivityPods security qualification |
| Blocked/muted collections | `REUSE_BEHIND_ADAPTER` | ActivityPods |
| Solid Notifications browser sync | `REUSE_BEHIND_ADAPTER` | SemApps WebSocketChannel2023 + Phanpy PodLiveSource |
| SemApps file upload | `REUSE_BEHIND_ADAPTER` | Phanpy MediaRepository -> ActivityPods uploads container |
| Internal media processing | `REUSE_AS_IS` | ActivityPods/media pipeline |
| Public indexing | `REUSE_AS_IS` | Federation architecture |
| Feed/query/hydration engine | `HARDEN_AND_EXPOSE` | Existing sidecar subsystem + browser-safe facade |
| Concrete discovery/graph/topic feeds | `REUSE_BEHIND_ADAPTER` | Existing registry/providers |
| Custom feed compiler/provider | `NEW_WORK` within existing feed architecture | Phase 12 |
| Public search service | `HARDEN_AND_EXPOSE` | Existing query implementation, missing browser/runtime facade |
| FEP-3ab2 control/private fan-out | `REUSE_BEHIND_ADAPTER` | Existing sidecar + ActivityPods auth |
| FEP bounded Redis replay | `REUSE_AS_IS` with qualification | Existing implementation |
| Long-gap/expired public replay policy | `NEW_WORK` / product contract decision | Phase 9 |
| Cross-plane viewer moderation policy | `NEW_WORK` / hardening | ActivityPods policy + federation read/live surfaces |
| Framework7 | `DEFERRED` pending proof | Phanpy Phase 3 |

## 13. Remaining Phase 0 blockers

Phase 0 is now much narrower. The unresolved contracts that materially affect implementation are:

1. **authoritative mutation idempotency** for browser retries;
2. **specialized quote/poll behavior**, including current server/container/vote capability;
3. **browser-safe feed/query/hydration/search facade design**, including server-bound viewer identity;
4. **one cross-plane moderation policy contract** using ActivityPods blocked/muted/user policy state;
5. **FEP long-gap recovery policy** beyond bounded Redis replay;
6. exact final AccessNeedGroup/DataGrant/special-right manifest Phanpy will request for its social, media, collection, notification and custom-feed capabilities.

The browser OIDC direction, Solid Notifications transport, media upload pattern, core ActivityPub mutation semantics, feed substrate, FEP control plane, and signing ownership are no longer open architectural questions.

## Phase 0 exit gate

Phase 0 is complete when every Phanpy capability has:

- an owner;
- a concrete protocol/runtime contract;
- an authority/privacy boundary;
- server-side viewer/policy enforcement where required;
- idempotency/recovery semantics;
- a testable adapter path.

The purpose is to prevent duplicate infrastructure and unsafe assumptions before Phase 1/2 refactoring begins.
