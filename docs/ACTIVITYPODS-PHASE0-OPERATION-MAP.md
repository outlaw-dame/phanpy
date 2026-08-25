# Phanpy × ActivityPods — Phase 0 Operation Map

## Purpose

Maps concrete Mastodon operation families currently used by Phanpy to the ActivityPods + Mastopod contracts that replace them behind protocol-neutral repositories.

Existing Mastodon behavior is the regression oracle; ActivityPods/Mastopod contracts become the new authority boundaries.

## Current Phanpy seam

`src/utils/api.js` currently creates Mastodon REST/stream clients and also initializes account identity, instance capabilities, preferences, and streaming state. Phase 1/2 must decompose this into repository capabilities rather than add ActivityPods conditionals throughout UI code.

## Operation matrix

| Phanpy behavior | Current Mastodon shape | Target repository | Target authority | Classification | Required mapping |
| --- | --- | --- | --- | --- | --- |
| Login/session | OAuth app registration + authorize/token/revoke | `SessionRepository` | ActivityPods + Solid/Data Interoperability | `REUSE_BEHIND_ADAPTER` | Adapt SemApps browser OAuth/OIDC behavior; discover WebID authorization agent; obtain/verify app registration and grants. Do not import React Admin/MUI UI. |
| Current account | `verifyCredentials()` | `SessionRepository`, `IdentityRepository` | ActivityPods | `REUSE_BEHIND_ADAPTER` | Canonical ID is WebID/actor URI, not Mastodon numeric ID. |
| Preferences | Mastodon preferences + local state | `PrivateDataRepository` | ActivityPods Pod | `REUSE_BEHIND_ADAPTER` | Store portable user-owned preference state in Pod resources; browser cache is secondary. |
| Home snapshot | `timelines.home.list()` | `FeedRepository` | sidecar public feed + ActivityPods private reads | `HARDEN_AND_EXPOSE` | Public followed projection plus authorized restricted/private reads; deterministic visibility-safe merge. |
| Home refresh | `since_id` polling | `FeedRepository.refresh()` | same | `REUSE_BEHIND_ADAPTER` | Snapshot refresh/fallback remains available when live is absent. |
| Home live | Mastodon user stream | `LiveRepository` | FEP-3ab2 + ActivityPods | `REUSE_BEHIND_ADAPTER` | Public FEP events, principal-scoped personal hints, Solid Notifications resource sync are distinct sources. |
| Search | Mastodon v2 search with `resolve` | `SearchRepository` | sidecar public search + ActivityPods/WebFinger | `HARDEN_AND_EXPOSE` | Existing index/search implementation needs browser facade; combine actor resolution and hydration without exposing OpenSearch/Qdrant. |
| Relationship read | `relationships.fetch()` | `RelationshipRepository` | ActivityPods | `REUSE_BEHIND_ADAPTER` | Viewer bound from authenticated session; return protocol-neutral state. |
| Follow | `follow()` | `RelationshipRepository` | ActivityPods actor outbox | `REUSE_BEHIND_ADAPTER` | Submit canonical `Follow`. |
| Unfollow/withdraw | `unfollow()` | `RelationshipRepository` | ActivityPods actor outbox | `REUSE_BEHIND_ADAPTER` | Submit canonical `Undo` of Follow. |
| Accept/reject follow request | follow-request endpoints | `RelationshipRepository` | ActivityPods actor outbox | `REUSE_BEHIND_ADAPTER` | Canonical `Accept`/`Reject`. |
| Follow presentation prefs | `notify`, `reblogs` | `PrivateDataRepository` | ActivityPods Pod | `HARDEN_AND_EXPOSE` | User-private presentation policy, not blindly encoded as Follow wire fields. |
| Block/unblock | account block endpoints | `ModerationRepository`, `RelationshipRepository` | ActivityPods | `REUSE_BEHIND_ADAPTER` | ActivityPods has concrete blocked collections and Block handling; Undo reverses canonical relation. Enforce across reads/live. |
| Mute/unmute | account mute endpoints | `ModerationRepository` | ActivityPods | `REUSE_BEHIND_ADAPTER` + policy work | ActivityPods has concrete muted collections; duration/notification-specific Mastodon semantics need portable policy fields. |
| Remove follower | Mastodon remove follower | `RelationshipRepository` | ActivityPods | `HARDEN_AND_EXPOSE` | Define exact canonical relationship mutation/side effect rather than emulate Mastodon endpoint. |
| Lists | Mastodon list CRUD/membership | `CollectionRepository` | ActivityPods collections | `REUSE_BEHIND_ADAPTER` | Use Collection/OrderedCollection URIs and membership operations. |
| Bookmark | status bookmark | `CollectionRepository`/`PrivateDataRepository` | ActivityPods Pod | `REUSE_BEHIND_ADAPTER` | Private user-owned collection/resource; not federation activity. |
| Create post | `statuses.create()` | `MutationRepository.createPost()` | ActivityPods actor outbox | `REUSE_BEHIND_ADAPTER` + idempotency work | POST bare AS object or Create activity to authenticated outbox. Must use durable `clientOperationId`; never retry as a new write. |
| Reply | create status with reply ID | `MutationRepository.reply()` | ActivityPods actor outbox | `REUSE_BEHIND_ADAPTER` | Canonical AS object with `inReplyTo`, addressing and visibility. |
| Edit | status update | `MutationRepository.updatePost()` | ActivityPods actor outbox/LDP | `REUSE_BEHIND_ADAPTER` | SemApps has `Update` object processing; verify Phanpy object-container permissions/edit-history presentation. |
| Delete | status delete | `MutationRepository.deletePost()` | ActivityPods | `REUSE_BEHIND_ADAPTER` | Canonical `Delete`; preserve tombstone/cache ordering. |
| Like/unlike | favourite/unfavourite | `MutationRepository` | ActivityPods | `REUSE_BEHIND_ADAPTER` | `Like` / `Undo`. |
| Repost/unrepost | reblog/unreblog | `MutationRepository` | ActivityPods | `REUSE_BEHIND_ADAPTER` | `Announce` / `Undo`. |
| Pin/profile feature | status/account pin | `CollectionRepository`/profile metadata | ActivityPods | `REUSE_BEHIND_ADAPTER` | Use actor featured/portable collection semantics where compatible. |
| Conversation mute | status mute | `ModerationRepository` | ActivityPods Pod | `HARDEN_AND_EXPOSE` | Local conversation policy; must affect feed/notifications consistently. |
| Quote | Mastodon quote/native quote APIs | `MutationRepository` | ActivityPods/SemApps | `NEW_WORK` / capability-gated | No current ActivityPods-specific native quote contract established. Do not degrade native quote semantics to a plain link silently. |
| Poll create/vote | Mastodon poll fields/endpoints | `MutationRepository` | ActivityPods/SemApps | `NEW_WORK` / capability-gated | Generic AS support is not sufficient proof of deployed Question/vote semantics; verify container, permissions, vote side effects. |
| Media upload | `v2.media.create()` | `MediaRepository` | ActivityPods `semapps:File` | `REUSE_BEHIND_ADAPTER` | POST raw File/Blob to discovered uploads container with MIME Content-Type; require `201` and canonical `Location` URI. Processing stays server-internal. |
| Scheduled post | scheduled status | `MutationRepository` | server authority required | `DEFERRED` | Do not use browser timers for canonical scheduling. |
| Notifications query | Mastodon notification list/grouping | `NotificationRepository` | ActivityPods + safe projection | `HARDEN_AND_EXPOSE` | Normalize social notification state independent of Mastodon DTO shape. |
| Notification badge/live | Mastodon user stream/poll | `PrivateHintSource` | ActivityPods -> FEP | `REUSE_BEHIND_ADAPTER` | `notifications` is a principal-scoped refresh hint; authoritative query is recovery path. |
| Notification read state | Mastodon markers | `NotificationRepository` | ActivityPods Pod | `NEW_WORK` / resource reuse | Portable read marker keyed to canonical notification identity, not Mastodon numeric marker IDs. |
| Public realtime | Mastodon streaming | `PublicLiveSource` | sidecar FEP-3ab2 | `REUSE_BEHIND_ADAPTER` | Implemented control/SSE facade + bounded Redis replay. Long-gap recovery policy remains. |
| Personal feed hint | Mastodon user stream | `PrivateHintSource` | ActivityPods -> FEP | `REUSE_BEHIND_ADAPTER` | `feeds/personal` triggers authoritative/safe refresh; not source of truth. |
| Pod resource realtime | no direct Mastodon equivalent | `PodLiveSource` | Solid Notifications | `REUSE_BEHIND_ADAPTER` | Use SemApps WebSocketChannel2023 browser subscription behavior. |

## Canonical outbox mapping

The existing SemApps ActivityPub stack already supplies the key social write behavior:

```text
Authenticated browser
  -> actor outbox POST
     -> bare AS object becomes Create when appropriate
     -> Create / Update / Delete object side effects
     -> Follow / Accept / Reject / Undo side effects
     -> Like / Undo side effects
     -> Announce / Undo side effects
     -> ActivityPods local collections/policy side effects
     -> native or external federation authority selected by ActivityPods
```

Phanpy does not need a Mastodon-compatible REST server for these operations.

## Mutation idempotency contract

This must be added before ActivityPods mutations are production-safe for Phanpy.

Every mutation repository method should take a stable operation identity, for example:

```js
await mutationRepository.createPost({
  clientOperationId,
  post
});
```

Server requirements:

- bind operation ID to authenticated actor and operation type;
- persist payload digest and canonical result;
- identical retry returns same canonical result;
- conflicting reuse of an operation ID fails closed;
- survive server restart/retry;
- never issue a second federation handoff for the same canonical operation;
- retain dedupe state for a documented bounded period.

This replaces Phanpy's unsafe current pattern where a failed Mastodon create attempt can be retried without its idempotency header.

## Home-feed behavior to preserve

Current Phanpy home behavior includes:

- paginated snapshot loading;
- explicit refresh checks;
- shared normalized status cache;
- newest-first ordering;
- live update/delete processing;
- marking cached deleted objects instead of blindly losing every reference.

The new repositories preserve those behaviors while changing transport/authority.

## Optimistic actions to preserve

Phanpy optimistically updates likes, boosts and bookmarks and rolls back on error. Keep that UI behavior above repository adapters.

Reconciliation keys must use canonical object/activity URIs rather than Mastodon numeric IDs.

## Search behavior to preserve

Current Mastodon search combines indexed search and remote account resolution in one UX. `SearchRepository` should preserve that experience while composing:

- public indexed lexical/semantic/hybrid search;
- actor/WebFinger resolution;
- authorized Pod/private search when appropriate;
- relationship/moderation hydration.

Current federation `DefaultPublicSearchService` exists but is not currently wired into a browser/public route. Its phase-era numeric `from` cursor should not become the final public contract.

## FEP-3ab2 implementation status

Current sidecar `main` includes:

- concrete FEP control/subscription/SSE routes;
- runtime startup wiring;
- ActivityPods principal/topic authorization integration;
- Redis-backed tickets/subscriptions;
- principal-scoped private fan-out;
- bounded Redis replay for public topics.

The internal feed stream's `replayCapable: false` is not proof that FEP browser replay is absent.

The remaining Phase 9 contract is expired/long-gap recovery beyond the bounded Redis replay window: snapshot fallback only, or RedPanda-backed longer replay if justified.

## Active feed registry

Current sidecar startup registers:

1. `urn:activitypods:feed:public-discovery:v1`
2. `urn:activitypods:feed:graph-personalized:v1`
3. `urn:activitypods:feed:topic:v1`

The feed contract supports `custom`, but no concrete custom compiler/provider is currently registered on `main`. Phase 12 adds that inside the existing feed architecture.

## Moderation boundary

ActivityPods already has actor blocked/muted collections, but current generic feed/hydration services do not themselves prove retrieval/application of that viewer-specific state. Hydration contracts having `blocked`/`viewer_not_allowed` omission reasons is not equivalent to an implemented unified policy.

Phase 7/16 must establish one server-side policy path across feed, hydration, search, public live and discovery. Browser filtering is defense-in-depth only.

## Phase 1 repository seam

Keep Phanpy JavaScript/JSX. Introduce JS modules with strong JSDoc contracts rather than converting the app to TypeScript as part of this migration.

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

Phase 2 implements `mastodon/*` adapters first, preserving current behavior. ActivityPods adapters then land capability-by-capability without protocol branches spreading through components.

## Remaining Phase 0 operation decisions

1. authoritative client-operation idempotency implementation;
2. native quote contract/capability policy;
3. poll Question/voting contract/capability policy;
4. exact browser-safe feed/hydration/search facade shape and authenticated viewer binding;
5. unified viewer moderation policy across projection/live surfaces;
6. FEP long-gap recovery policy;
7. final ActivityPods AccessNeedGroup/DataGrant/special-right manifest requested by Phanpy.
