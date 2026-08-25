# Phanpy × ActivityPods — Phase 0 Operation Map

## Purpose

This document maps the concrete Mastodon operation families currently used by Phanpy to the ActivityPods + Mastopod contracts that will replace them behind protocol-neutral repositories.

It is intentionally implementation-oriented. Existing Mastodon behavior is the regression oracle; ActivityPods/Mastopod contracts are the new authority boundaries.

## Verified Phanpy baseline

Phanpy's current global API helper creates `masto` REST and streaming clients keyed by instance/account token. It also initializes instance capabilities, current-account identity, preferences, and the Mastodon streaming URL. This single helper currently mixes session, instance capability, REST transport, and live transport concerns.

Phase 1/2 must split that into repository capabilities rather than introduce a second global protocol switch.

## Operation matrix

| Current Phanpy behavior | Current Mastodon operation | Target repository | ActivityPods / Mastopod owner | Classification | Notes / missing contract |
| --- | --- | --- | --- | --- | --- |
| Login / app registration | `/api/v1/apps`, OAuth authorize/token/revoke, PKCE | `SessionRepository` | ActivityPods + Solid/Data Interoperability | `REUSE_BEHIND_ADAPTER` | Replace Mastodon dynamic app registration with WebID/authorization-agent discovery, app registration, AccessNeedGroup/AccessGrant verification, Solid-OIDC session restoration/revocation. Exact Preact OIDC primitive still to select. |
| Verify current account | `accounts.verifyCredentials()` | `SessionRepository` + `IdentityRepository` | ActivityPods | `REUSE_BEHIND_ADAPTER` | Identity is authoritative WebID/ActivityPub actor; no Mastodon numeric account ID as canonical identity. |
| Preferences | `preferences.fetch()` + local store | `PrivateDataRepository` | ActivityPods Pod | `REUSE_BEHIND_ADAPTER` | Portable user preferences should be Pod resources; local browser cache remains projection/cache. |
| Home snapshot | `timelines.home.list()` with `max_id`/`min_id`/`since_id` | `FeedRepository` | Mastopod feed service + ActivityPods private reads | `HARDEN_AND_EXPOSE` | Public followed material uses browser-safe feed gateway; restricted/private material is merged from authorized ActivityPods reads. |
| Home polling | `timelines.home.list({ since_id })` | `FeedRepository.refresh()` | Same as home snapshot | `REUSE_BEHIND_ADAPTER` | Becomes snapshot refresh/fallback, not the primary live transport. |
| Home live update/delete | Mastodon `streaming.user.subscribe()` events `status.update` / `delete` | `LiveRepository` | FEP-3ab2 + ActivityPods | `HARDEN_AND_EXPOSE` | Public events via FEP public topics; personal/private refresh via principal-scoped hints; resource changes via Solid Notifications. |
| Search posts/accounts/tags | `v2.search.list({q,type,resolve,offset})` | `SearchRepository` | Mastopod public search + ActivityPods actor/WebFinger + authorized Pod search | `HARDEN_AND_EXPOSE` | Do not expose OpenSearch/Qdrant directly. Account resolution must preserve remote actor resolution semantics. |
| Relationship batch read | `accounts.relationships.fetch({id[]})` | `RelationshipRepository` | ActivityPods | `REUSE_BEHIND_ADAPTER` | Server-authorized viewer identity; canonical relation objects should not expose Mastodon numeric-ID assumptions. |
| Follow / unfollow / withdraw request | `accounts.$select(id).follow()` / `.unfollow()` | `RelationshipRepository` | ActivityPods canonical ActivityPub mutation | `REUSE_BEHIND_ADAPTER` | Must resolve target actor and submit canonical Follow/Undo through ActivityPods; federation executor remains invisible. |
| Follow preferences | `.follow({ notify, reblogs })` | `RelationshipRepository` + `PrivateDataRepository` | ActivityPods/Pod | `HARDEN_AND_EXPOSE` | `notify`/repost-display choices are viewer preferences, not necessarily ActivityPub Follow wire fields; store portable preference state separately where needed. |
| Mute / unmute | `accounts...mute({duration})` / `.unmute()` | `ModerationRepository` | ActivityPods/Pod | `HARDEN_AND_EXPOSE` | Local moderation policy, duration/expiry and notification-mute semantics must be defined against existing moderation services/resources. |
| Block / unblock | `accounts...block()` / `.unblock()` | `RelationshipRepository` + `ModerationRepository` | ActivityPods canonical AP + local policy | `REUSE_BEHIND_ADAPTER` | ActivityPub Block is canonical social mutation; local enforcement must also affect read/feed/hydration/live paths. |
| Remove follower | `accounts...removeFromFollowers()` | `RelationshipRepository` | ActivityPods | `HARDEN_AND_EXPOSE` | Must define exact ActivityPub-compatible operation and local relationship update semantics. |
| Endorse/profile feature | account `.pin()` / `.unpin()` | `CollectionRepository` / profile metadata | ActivityPods Pod | `REUSE_BEHIND_ADAPTER` | Model as user-owned semantic/profile state rather than Mastodon-specific endpoint. |
| List read/cache | `v1.lists.list()` / list fetch | `CollectionRepository` | ActivityPods collections | `REUSE_BEHIND_ADAPTER` | ActivityPods Collection/OrderedCollection is the portable substrate. |
| List membership | account list membership + add/remove UI | `CollectionRepository` | ActivityPods collections | `REUSE_BEHIND_ADAPTER` | Use collection URI membership; avoid a second list database. |
| Create post/reply | `v1.statuses.create(params)` with `Idempotency-Key` | `MutationRepository.createPost()` | ActivityPods canonical actor outbox | `REUSE_BEHIND_ADAPTER` | Preserve idempotency semantics. Reply maps to ActivityStreams object/activity with canonical `inReplyTo`, addressing and visibility. Exact client mutation shape still to formalize. |
| Edit post | `statuses.$select(id).update(params)` | `MutationRepository.updatePost()` | ActivityPods | `HARDEN_AND_EXPOSE` | Must map to the ActivityPods-supported Update/canonical object mutation path and preserve edit-history behavior. |
| Delete post | `statuses.$select(id).remove()` | `MutationRepository.deletePost()` | ActivityPods | `REUSE_BEHIND_ADAPTER` | Canonical Delete/tombstone path; client cache marks deleted only after/optimistically around authoritative write. |
| Boost / unboost | `.reblog()` / `.unreblog()` | `MutationRepository.announce()` / `.undo()` | ActivityPods | `REUSE_BEHIND_ADAPTER` | ActivityPub Announce/Undo. Preserve optimistic UI but key by canonical object/activity IDs. |
| Like / unlike | `.favourite()` / `.unfavourite()` | `MutationRepository.like()` / `.undo()` | ActivityPods | `REUSE_BEHIND_ADAPTER` | ActivityPub Like/Undo. |
| Bookmark / unbookmark | `.bookmark()` / `.unbookmark()` | `CollectionRepository` or `PrivateDataRepository` | ActivityPods Pod | `REUSE_BEHIND_ADAPTER` | Bookmark is user-private state, not a federation mutation; best represented as Pod-owned collection/resource. |
| Conversation mute | status `.mute()` / `.unmute()` | `ModerationRepository` | ActivityPods/Pod | `HARDEN_AND_EXPOSE` | Local-only conversation policy; must affect notifications/feed rendering consistently. |
| Pin / unpin own post | status `.pin()` / `.unpin()` | `CollectionRepository` / profile metadata | ActivityPods | `REUSE_BEHIND_ADAPTER` | Model through actor featured/collection semantics where compatible. |
| Native quote / quote revoke | quote status create + quote approval/revoke endpoints | `MutationRepository` + policy | ActivityPods | `HARDEN_AND_EXPOSE` | Requires exact quote/FEP semantics supported by current ActivityPods/SemApps stack; do not emulate as a plain link when native semantics are available. |
| Media upload | `v2.media.create({file,description})` | `MediaRepository` | ActivityPods `semapps:File` + media pipeline | `HARDEN_AND_EXPOSE` | Backend processing exists. Browser-safe create/upload contract still needs exact endpoint/request/response definition. |
| Poll create/update | fields embedded in status compose params | `MutationRepository` | ActivityPods | `HARDEN_AND_EXPOSE` | Must verify current ActivityStreams Question support and voting mutation path. |
| Scheduled post | Mastodon scheduled status capability | `MutationRepository` / scheduling capability | TBD | `DEFERRED` until authority verified | Do not invent a client timer. If retained, scheduling must be server-authoritative and durable. |
| Notifications snapshot | v1/v2 notifications list + grouping | `NotificationRepository` | ActivityPods authoritative state + safe projection | `HARDEN_AND_EXPOSE` | Preserve grouped notification UX independently from Mastodon response shapes. |
| Notification read marker | `markers.create({notifications:{lastReadId}})` | `NotificationRepository.markRead()` | ActivityPods Pod | `NEW_WORK` or existing-resource reuse after audit | Should be portable user state; not tied to Mastodon marker IDs. |
| Follow requests | `followRequests.list()` + accept/reject UI | `RelationshipRepository` | ActivityPods | `REUSE_BEHIND_ADAPTER` | Canonical incoming Follow acceptance/rejection semantics. |
| Notification policy/requests | Mastodon v2 notification policy/requests | `ModerationRepository` + `NotificationRepository` | ActivityPods/Pod | `HARDEN_AND_EXPOSE` | Map into local portable notification policy rather than copying Mastodon DTOs. |
| Notification realtime badge | current streaming/poll-driven state | `PrivateHintSource` | ActivityPods private emitter -> FEP-3ab2 | `REUSE_BEHIND_ADAPTER` | `notifications` topic is a refresh hint; authoritative notification query remains recovery path. |
| Public realtime | Mastodon WS user stream | `PublicLiveSource` | sidecar FEP-3ab2 | `REUSE_BEHIND_ADAPTER` / `HARDEN_AND_EXPOSE` | Public FEP routes are implemented and wired. Bounded Redis replay exists; long-gap recovery policy still to qualify. |
| Pod/resource realtime | none equivalent in Mastodon | `PodLiveSource` | Solid Notifications | `REUSE_BEHIND_ADAPTER` | Used for Pod-owned preference/collection/custom-feed-definition/resource synchronization. |

## Important current-code behaviors to preserve

### Home timeline

Both Phanpy home variants:

- paginate the Mastodon home timeline;
- perform explicit `since_id` refresh checks;
- save normalized statuses into shared state;
- sort newest-first;
- consume `status.update` and `delete` from the authenticated user stream;
- mark deleted cached statuses rather than blindly removing all local references.

The ActivityPods repository abstraction must preserve those observable behaviors even though snapshot and live transports change.

### Optimistic social actions

Phanpy optimistically updates like, boost, and bookmark state and rolls back on failure. This is valuable UI behavior and should remain above the repository boundary.

The repository must return enough authoritative identity/state to reconcile optimistic changes without assuming Mastodon status IDs.

### Composer idempotency

New Mastodon posts are attempted with an `Idempotency-Key`, then Phanpy currently falls back to a request without that key if the first request fails.

For ActivityPods, the fallback must **not** weaken idempotency. The ActivityPods mutation contract should accept a stable client operation ID and deduplicate retries at the authoritative mutation boundary. A generic retry must never create a second post.

### Search mixes resolution and index search

Phanpy's Mastodon search currently uses `resolve: authenticated`, allowing account resolution and indexed search to appear as one UI operation.

The new `SearchRepository` should preserve one UX while internally composing:

- public indexed search;
- actor/WebFinger resolution;
- authorized Pod/private search where appropriate;
- relationship hydration for returned actors.

### Relationship flags are not all protocol state

Mastodon relationship objects combine:

- federated relationship state (`following`, `followedBy`, `blocking`, requests);
- local presentation/policy state (`showingReblogs`, `notifying`, mute durations, private notes, endorsement state).

The ActivityPods domain model should not force all of these into one ActivityPub object. Federated state belongs to canonical ActivityPub relations; user-private preferences belong in Pod-owned policy/resources.

## Current FEP-3ab2 implementation status

The browser realtime facade is no longer merely architectural design.

Current sidecar `main` contains:

- concrete FEP-3ab2 Fastify control/subscription/SSE routes;
- `Fep3ab2Runtime` startup wiring;
- ActivityPods principal resolution/topic authorization integration;
- Redis-backed stream tickets and subscription state;
- principal-scoped private fan-out for `notifications` / `feeds/personal`;
- a bounded Redis replay store for replayable **public** topics.

Default replay settings in current startup are approximately:

```text
TTL: 900 seconds
max replay events per topic/session window: 500
max replay index size: 10,000
```

The internal `DurableStreamSubscriptionService` may still advertise `replayCapable: false`; that does not mean browser FEP replay is absent. The correct Phase 9 question is now:

> Is bounded FEP Redis replay plus snapshot fallback sufficient for the product recovery contract, or must an expired/long-gap cursor be reconstructed from RedPanda offsets/log retention?

Phase 9 must answer and test that question rather than rebuild FEP streaming.

## Active feed registry status

Current federation-sidecar startup registers three concrete definitions, all backed by `search.candidates.v1` through either OpenSearch or Qdrant:

1. `urn:activitypods:feed:public-discovery:v1`
   - discovery
   - public
   - Stream2 + canonical + unified
   - ranked
2. `urn:activitypods:feed:graph-personalized:v1`
   - graph
   - authenticated
   - Stream1 + Stream2 + canonical + unified
   - blended
3. `urn:activitypods:feed:topic:v1`
   - topic
   - public
   - Stream2 + canonical + unified
   - blended

The contract type supports `custom`, but no concrete custom-feed compiler/provider is currently registered on `main`. Phase 12 therefore has real new provider/compiler work; it should reuse the existing feed contract/registry and ActivityPods collections rather than create another feed engine.

## Phase 1 repository seam implied by this audit

Because Phanpy is JavaScript/JSX, Phase 1 should introduce plain JS modules with strong JSDoc contracts rather than silently converting the app to TypeScript.

Proposed seam:

```text
src/domain/
  ids.js
  actor.js
  post.js
  relationship.js
  notification.js
  media.js
  feed.js
  live.js

src/repositories/
  session.js
  identity.js
  feed.js
  hydration.js
  search.js
  relationship.js
  mutation.js
  moderation.js
  notification.js
  media.js
  collection.js
  live.js
```

Phase 2 then implements `mastodon/*` adapters over the existing `masto` calls with no visible behavior change. ActivityPods adapters can subsequently land capability-by-capability without protocol conditionals spreading through UI components.

## Remaining Phase 0 operation gaps

Before calling Phase 0 complete, verify:

1. exact ActivityPods browser OIDC/session primitive and token-restoration lifecycle;
2. exact ActivityPods client-facing mutation shapes for Create/Reply/Update/Delete/Follow/Undo/Like/Announce/Block and incoming Follow decisions;
3. exact Solid Notifications browser discovery/subscription/reconnect semantics in the pinned SemApps version;
4. exact browser `semapps:File` upload endpoint/shape;
5. quote, poll and edit support in the current ActivityPods/SemApps ActivityPub stack;
6. moderation enforcement equivalence across feed query, hydration, search, public FEP delivery, private hints and authoritative reads;
7. public search façade exposure;
8. FEP expired-cursor recovery policy beyond the bounded Redis replay window.
