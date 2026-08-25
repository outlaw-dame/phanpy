# ActivityPods Integration — Phase 0 Exit Decisions

## Status and precedence

This document closes the six implementation-contract decisions that remained open after the Phase 0 architecture, contract audit, authentication/mutation audit, FEP contract audit, and operation map.

For these six decisions, this document supersedes earlier `Still to verify`, `remaining blocker`, or similarly tentative wording in the other Phase 0 documents. Executable repository code remains the ultimate source of truth if it changes after this decision record.

The important distinction is now:

- **Phase 0 architecture/contract uncertainty is closed** for these six areas;
- several decisions intentionally create **implementation work** in ActivityPods, the federation architecture, or Phanpy;
- a capability remains disabled until its implementation acceptance criteria pass.

## Decision 1 — Authoritative browser-mutation idempotency

### Decision

Client-operation deduplication belongs at the **ActivityPods authoritative mutation boundary**, before canonical object/activity creation and before federation delivery.

It must not rely on Redis as the sole authority. Redis remains reconstructable operational state in the architecture; an accepted user mutation and its canonical result are authoritative state.

The logical receipt key is:

```text
(authenticated actor, operation kind, clientOperationId)
```

Each durable receipt records at minimum:

```text
clientOperationId
operationKind
authenticatedActorUri
normalizedPayloadDigest
canonicalObjectUri / canonicalActivityUri
completion state
createdAt
retention metadata
```

Required semantics:

1. Phanpy creates a stable `clientOperationId` **before** the first network attempt.
2. The server binds the operation to the authenticated actor; a browser-supplied actor URI cannot change that authority.
3. The first accepted operation stores its normalized request digest and canonical result durably.
4. An exact retry returns the same canonical result without creating a second object/activity.
5. Reuse of the same operation ID with a different normalized payload fails closed, preferably as `409 Conflict`.
6. Process restart, ActivityPods retry, sidecar retry, and federation retry cannot create a second canonical mutation.
7. Receipt retention is explicit and long enough to cover supported offline/retry behavior.
8. Downstream delivery idempotency remains a separate concern; replaying a delivery must not replay canonical creation.

### Implementation ownership

`ActivityPods` — `NEW_WORK`.

The preferred implementation is a durable ActivityPods-owned receipt/ledger in an authoritative dataset or controlled internal store, transactionally coupled to canonical mutation creation as closely as the current SemApps/LDP transaction model permits. A Redis-only dedupe key is specifically rejected.

### Acceptance gate

The capability is not production-ready until concurrent duplicate submissions, retry-after-timeout, restart recovery, same-key/different-payload rejection, and native-vs-external federation modes all pass.

## Decision 2 — Native quote and poll capability

### Quotes

The federation architecture already has cross-protocol quote semantics. Its canonical post intents carry `quoteOf`, and its interaction-policy model carries quote permission semantics for ActivityPub and ATProto projection.

Therefore quote support is **not new Tier-2 protocol work**.

What remains is an ActivityPods-authoritative browser mutation ingress that proves the user's canonical post can preserve:

```text
quoteOf
interactionPolicy.canQuote
canonical object identity
recipient/audience policy
```

through authoritative ActivityPods storage/outbox processing and the existing projection layer.

Classification:

- canonical quote model/projectors: `REUSE_AS_IS` — federation architecture;
- ActivityPods-authoritative quote ingress and regression proof: `HARDEN_AND_EXPOSE` / focused adapter work;
- Phanpy quote UI: capability-gated until that proof passes.

A plain hyperlink masquerading as a quote is not an acceptable compatibility fallback.

### Polls

The federation architecture already implements canonical poll intents and ActivityPub FEP-9967 `Create(Question)` projection, including `oneOf`/`anyOf`, expiry, counts, and poll-vote intent semantics.

Therefore poll federation/projection is also **not greenfield Tier-2 work**.

The missing authority is Tier 1. The current ActivityPods shapes repository exposes ShapeTrees for File and ActivityStreams Article/Audio/Event/Image/Note/Profile/Video, but no current `Question` ShapeTree. ActivityPods therefore does not yet have a verified provider-provisioned authoritative `Question` resource/container contract for Phanpy to target.

Required Tier-1 work:

1. define/approve a `Question` shape and ShapeTree compatible with the deployed ActivityStreams/FEP-9967 representation;
2. provision/discover an authoritative Question container;
3. define Create/Edit/Delete authorization and ownership rules;
4. define vote authorization and FEP-9967 vote-Note handling;
5. ensure vote-count/update behavior is race-safe and authority-preserving;
6. prove native and external federation modes yield the same canonical outcome;
7. expose capability metadata so Phanpy never renders a creation/vote path against a provider that lacks the contract.

Classification:

- canonical poll model/projectors: `REUSE_AS_IS` — federation architecture;
- ActivityPods Question/vote authority: `NEW_WORK` — ActivityPods + shapes/provider provisioning;
- Phanpy polls: disabled until that Tier-1 acceptance gate passes.

No Mastodon DTO shim is introduced to conceal this gap.

## Decision 3 — Browser-safe feed, hydration, and search facade

### Decision

Phanpy receives one application-facing read facade over the existing Tier-3 feed/query/hydration/search services. It does not call internal sidecar routes, OpenSearch, Qdrant, Redis, or RedPanda directly.

The facade must be authenticated with the user's ActivityPods session/principal and derive viewer identity **server-side**. An arbitrary browser-supplied `viewerId` is never an authority input.

Conceptual browser contracts are protocol-neutral:

```text
queryFeed(feedRef, cursor, filters)
hydrate(canonicalIds)
search(query, cursor, filters)
resolveActor(handleOrUri)
```

Exact URLs are intentionally not invented in Phase 0; they belong to the server implementation contract.

Required response properties:

- canonical stable object/actor IDs;
- opaque, stable pagination cursors;
- enough provenance to debug projection source without leaking internal infrastructure;
- explicit omission/unavailable states where hydration cannot return an object;
- server-bound viewer policy;
- public-data-only search/feed execution against Tier 3;
- private/direct/restricted data remains on authorized ActivityPods/Pod paths.

The existing feed registry, candidate providers, hydration service, public index, and public search implementation are reused behind this facade.

Classification: `HARDEN_AND_EXPOSE` — federation architecture/application boundary.

## Decision 4 — One cross-plane viewer moderation policy

### Decision

ActivityPods blocked/muted/user moderation state is authoritative, but the browser is not the sole enforcement layer.

The application-facing server boundary derives a server-side `ViewerPolicyContext` (name illustrative, not a required code identifier) from the authenticated ActivityPods principal and applies equivalent policy to every user-visible public plane:

```text
feed candidate selection
hydration
public search
recommendation/discovery
relationship/account discovery
public realtime delivery or realtime-triggered hydration
notification/personal-feed refresh results
```

A caller cannot weaken or replace that context with request parameters.

### Initial realtime rule

If the current public FEP path cannot cheaply prove per-viewer filtering for full object payloads, public realtime is treated as a **change/invalidation hint**. Phanpy rehydrates the affected canonical IDs through the moderated facade before rendering them.

That preserves low-latency updates without allowing a raw stream payload to bypass block/mute/privacy policy.

### Acceptance gate

A blocked/muted actor/object must remain absent or policy-filtered consistently across snapshot feed results, hydration, search, discovery, reconnect replay, and live updates. Tests must include policy changes while a live session is open.

Classification: `NEW_WORK` / hardening at the application boundary while reusing ActivityPods moderation authority.

## Decision 5 — FEP-3ab2 expired/long-gap recovery

### Verified current behavior

The current FEP replay store is a bounded Redis fast-reconnect window. It persists replayable public events only, with a short TTL and bounded event/index counts. Current route behavior can distinguish a syntactically replayable event ID from a non-replay ID, but an empty replay result does not prove whether:

- there were no newer events; or
- the requested cursor predates retained replay data.

Silently resuming live in the second case can create an undetected client gap.

### Decision

Keep bounded Redis replay as the normal reconnect fast path, but extend the server contract so replay can classify at least:

```text
complete
stale
truncated
```

(or equivalent explicit states).

For `stale` or `truncated` recovery:

1. emit/return an explicit reset/resync condition;
2. Phanpy performs an authoritative moderated Tier-3 snapshot query;
3. the live subscription resumes from the new server head/watermark;
4. canonical-ID dedupe protects the snapshot/live seam;
5. tombstones/deletions remain correctly ordered.

RedPanda remains a **server-side durable event log**. Browser clients do not receive RedPanda offsets and do not become log consumers. Tier 3 may internally reconstruct state from durable logs where appropriate, but the browser recovery contract is snapshot/resync, not arbitrary durable-log replay.

This is also preferable because current FEP replay IDs are FEP/Redis sequence IDs, not RedPanda offsets.

### Acceptance gate

Tests must cover normal replay, exact head, expired cursor, truncated replay, replay/live overlap, deletion/tombstone ordering, duplicate IDs, and policy changes during the disconnected interval.

Classification: bounded replay `REUSE_AS_IS` plus `HARDEN_AND_EXPOSE` stale/truncation signaling and reset semantics.

## Decision 6 — Least-privilege Phanpy AccessNeedGroup/DataGrant/special-right manifest

### Principle

The manifest is **feature/version scoped**, not a permanent blanket grant. A Phanpy deployment requests only the capabilities it actually ships. Enabling a later feature may require an application-registration upgrade and additional user approval.

OAuth authentication and Solid Data Interoperability application grants remain separate layers.

### Baseline special-right policy

The base browser application requests **no ActivityPods special rights merely because it is a social client**.

In particular:

| Right | Baseline | Reason |
| --- | --- | --- |
| `apods:ReadInbox` | **not requested** | It activates server-side application inbox watchers; browser social state uses the authenticated APIs/FEP/private authoritative reads instead. |
| `apods:ReadOutbox` | **not requested** | It activates server-side application outbox watchers; it is not required merely to submit a user mutation. |
| `apods:CreateAclGroup` | optional feature grant | Only needed when Phanpy actually creates WAC groups for a sharing feature. |
| `apods:UpdateWebId` | optional and preferably avoided | Only needed when Phanpy attaches/modifies app data directly on the user's WebID. Initial custom-feed/preferences design should use dedicated Pod resources instead. |

`ReadInbox`/`ReadOutbox` may be added to a **separate application-backend feature manifest** only if a concrete server-side watcher needs them. They are not silently bundled into the PWA baseline.

### ShapeTree-scoped data grants

The provider's normal data authorization is ShapeTree-scoped WAC access. Request the smallest modes each feature needs.

| Feature/data | Grant policy | Status |
| --- | --- | --- |
| uploaded media | File ShapeTree — `acl:Read`, `acl:Write` | request when media upload is enabled |
| authored Note resources | Note ShapeTree — `acl:Read`, `acl:Write` **only if** the selected ActivityPods app-mediated mutation path requires the app DataGrant to manage those resources | integration test must prove whether required for the final browser/app ingress |
| profile resource editing | Profile ShapeTree — `acl:Read`, `acl:Write` | optional; request only if profile editing uses the Profile resource contract |
| custom-feed definitions | dedicated Phanpy/open social feed-definition ShapeTree — `acl:Read`, `acl:Write` | `NEW_WORK`; define vocabulary/ShapeTree before Phase 12, do not invent the public URI here |
| portable private social preferences | dedicated app/open-social preferences ShapeTree — `acl:Read`, `acl:Write` | `NEW_WORK` if not safely unified with another standard user-owned resource |
| sharing/editing ACLs | add `acl:Control` only on the specific shareable ShapeTrees | optional; never Pod-wide |
| polls | future Question ShapeTree with least required modes | blocked until Question ShapeTree/provider contract exists |

The current public ActivityPods shapes repository has a File ShapeTree and ActivityStreams Note/Profile/etc. ShapeTrees, but no current generic `Question` or `Collection` ShapeTree. That absence is treated as a capability constraint, not worked around with broad ACL grants.

### Collections and custom feeds

ActivityPods already has an authoritative collection service and provider collection storage. A dynamic custom feed must not become a giant Pod-materialized post list merely to fit that API.

The intended data model remains:

```text
Pod-owned custom-feed definition
  -> references ActivityPods collections / actors / topics / exclusions / parameters
  -> Tier-3 feed compiler executes the definition over public projections
```

The feed-definition ShapeTree is new semantic work. Its URI and schema must be designed and versioned rather than invented in this audit.

### Permission-control rule

`acl:Control` is requested only when the feature needs to modify permissions on that exact resource class. `apods:CreateAclGroup` is requested only when creating a WAC group is part of the shipped feature. Neither is a baseline social-client entitlement.

### Manifest acceptance gate

Provider integration tests must prove for every requested access need that:

- removing that grant breaks only the intended feature;
- no feature reads/writes unrelated Pod data;
- anonymous/wrong-principal requests fail closed;
- optional rights are absent from the initial registration when their feature is disabled;
- a feature upgrade requests only the delta and succeeds after explicit grant;
- revocation invalidates the affected feature without corrupting unrelated local state.

## Final Phase 0 disposition

| Previously open decision | Phase 0 disposition | Implementation consequence |
| --- | --- | --- |
| mutation idempotency | **closed** | build ActivityPods-authoritative durable receipt/dedupe boundary |
| quote capability | **closed** | reuse Tier-2 canonical support; prove ActivityPods authoritative ingress before enabling |
| poll capability | **closed** | reuse Tier-2 FEP-9967 support; add Tier-1 Question ShapeTree/container/vote authority |
| browser feed/hydration/search facade | **closed** | expose one ActivityPods-authenticated, server-principal-bound facade over existing Tier 3 |
| cross-plane moderation | **closed** | central server viewer policy; realtime cannot bypass moderated hydration |
| FEP long-gap recovery | **closed** | explicit stale/truncated reset + snapshot resync; bounded Redis stays fast path |
| access-needs manifest | **closed** | feature-scoped least privilege; no baseline special rights; app-specific ShapeTrees only where genuinely required |

## Phase 0 exit gate

Phase 0 architecture/contract design is complete when this decision record is present alongside the existing audit documents and Phase 1 contracts do not contradict it.

The next work is implementation, in dependency order:

1. ActivityPods authoritative mutation idempotency;
2. browser-safe Tier-3 read facade plus server-bound viewer policy;
3. FEP stale/truncated replay signaling and snapshot-reset contract;
4. Phanpy/open-social custom-feed and private-preference ShapeTree/vocabulary design;
5. ActivityPods Question ShapeTree/container/vote authority;
6. ActivityPods adapters in Phanpy, capability-gated against the contracts above.

Phase 1 may continue in parallel where it only defines protocol-neutral contracts and preserves these authority boundaries. No client component should bypass a missing backend contract just to make a feature appear complete.
