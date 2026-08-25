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

### Existing Mastodon coupling is the migration baseline, not a discovery

Phanpy is a Mastodon client. Its current API, auth, feed, live, notification, relationship, composer, media, search, profile, and model assumptions are therefore Mastodon-shaped by design.

The useful Phase 0 task is not to rediscover that fact. It is to determine which ActivityPods and Mastopod contracts replace each Mastodon responsibility without duplicating existing infrastructure.

The planned client boundary remains:

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

### Home timeline separation remains necessary

The current home implementation combines snapshot pagination, polling, Mastodon streaming update/delete events, and recipient-specific state. The ActivityPods adaptation should split these responsibilities instead of translating the page line-for-line:

```text
FeedRepository
  -> snapshot, pagination, query

LiveRepository
  -> incremental public events

NotificationRepository / RelationshipRepository
  -> recipient-specific state
```

This split maps directly onto existing Tier 3 feed/hydration/live contracts described below.

## Verified findings — ActivityPods

### Application registration already follows Solid interoperability semantics — REUSE_BEHIND_ADAPTER

The existing application-registration flow discovers `interop:hasAuthorizationAgent`, checks the registered-agent Link relation, and redirects to `interop:hasAuthorizationRedirectEndpoint` when registration is required.

Phanpy should implement the same protocol behavior in a Preact-compatible session adapter rather than importing the React Admin/MUI presentation layer.

### Pod resources and permissions already exist — REUSE_BEHIND_ADAPTER

The ActivityPods app framework already provides actor-bound Pod resource operations for GET/list/POST/PUT/PATCH/DELETE and WAC permission management with Read/Append/Write/Control modes.

Phanpy should not invent a second Pod CRUD or ACL layer.

### Collections already exist as reusable Pod-owned resources — REUSE_BEHIND_ADAPTER

`pod-collections` supports:

- `Collection` and `OrderedCollection` resources;
- reading members;
- attaching/detaching collections to resources;
- SPARQL Update add/remove operations;
- pagination/dereference/sort options;
- provisioning missing attached collections.

Phase 11 should therefore expose Phanpy collection semantics over this substrate. Phase 12 custom feed definitions can reference ActivityPods collection URIs rather than introducing a separate list database.

### ActivityPub notification objects and Solid Notifications are different concerns

`pod-notification` sends application-generated ActivityPub notification activities. It is not the browser synchronization transport.

`pod-activities-watcher` uses the SemApps `solid-notifications.listener` service and registers inbox/outbox listeners when the app has the corresponding special rights.

Phase 10 must therefore keep these separate:

```text
ActivityPub notification objects
  -> user-visible social notification semantics

Solid Notifications
  -> Pod/private resource change transport
```

The client should consume standardized Solid Notifications endpoint discovery/subscription semantics. It should not reproduce the application-server watcher implementation in the browser; that watcher is backend behavior layered on the SemApps listener.

### Canonical social writes remain ActivityPods-authoritative

The old app-framework `pod-outbox.post` helper preserves key custody by posting through ActivityPods signing/proxy behavior, but it must not be treated as the final modern delivery boundary by itself.

The newer federation work establishes a stronger boundary:

1. ActivityPods is the local actor/account authority.
2. ActivityPods resolves recipient personal/shared inbox routing before durable handoff.
3. The sidecar receives a frozen target snapshot and does not independently rediscover recipient routes.
4. The sidecar performs delivery using ActivityPods-delegated signatures for Pod/user actors.

Therefore Phanpy mutations terminate at the ActivityPods canonical write/outbox boundary. Phanpy must never submit federation delivery targets, write Redis/RedPanda infrastructure directly, or address sidecar delivery workers directly.

### Modern ActivityPub signing authority is already on ActivityPods `master` — REUSE_AS_IS

The previous revision of this audit incorrectly described ActivityPods PR #107 as the location of the current modern signing implementation. That conflated the existing default-branch authority model with a pending credential-hygiene hardening.

Current `master`, in `pod-provider/backend/services/signing.service.js`, already registers:

```text
POST /api/internal/signatures/batch
```

The endpoint is protected by the internal bearer token (`ACTIVITYPODS_TOKEN`, with the present compatibility fallback in configuration), keeps private key material inside ActivityPods, batches requests by actor, and performs authoritative local actor/key resolution before signing.

The executable `master` authority chain is:

```text
auth.account.findByWebId
  -> require exact account.webId === actorUri and a local account username/dataset
  -> activitypub.actor.get
  -> require exact returned actor id === actorUri
  -> keys.getOrCreateWebIdKeys(RSA)
  -> intersect with actor.publicKey linkage
  -> require exactly one key whose owner/controller === actorUri
  -> derive keyId from rdfs:seeAlso
  -> return signed HTTP headers to the sidecar
```

This is materially different from same-host URL inference and from the obsolete `actors.resolveWebIdForActor` / `actors.getPublicKeyId` dependency chain found in older integration copies.

Current `master` also fails closed for unknown signing profiles, malformed host/path/method inputs, digest mismatches, body-size limits, and unavailable/ambiguous actor signing material. The browser has no role in this endpoint and must never receive its bearer credential or signing key material.

### ActivityPods PR #107 is pending credential-hygiene hardening, not the architectural baseline

PR #107 (`security/signing-credential-hygiene-forward-port`) retains the same account/actor authority premise but tightens the key-resolution implementation. In particular, it removes signing-path dependence on `keys.getOrCreateWebIdKeys` and instead follows actor-attached public-key IDs through existing key storage, requiring an unambiguous actor-controlled RSA private key rather than allowing the signing path to create/recover a key opportunistically.

The architectural consequence for Phanpy is deliberately small:

- Phanpy targets the ActivityPods canonical mutation boundary, not either signing implementation detail;
- PR #107 should be tracked as defense-in-depth for ActivityPods/federation deployment and integration tests;
- Phanpy implementation must not block on PR #107 unless a concrete runtime contract it needs is changed by that PR.

### Stale signing APIs and integration copies must not become Phanpy dependencies

The federation repository contains an older ActivityPods integration copy of `signing.service.js` using obsolete signer-locality/key-resolution dependencies. ActivityPods `master` is already newer than that copy.

The sidecar also contains legacy-looking ActivityPods client key/signature helper methods that are not the live browser-facing mutation contract. These are implementation-history/compatibility artifacts unless a current caller proves otherwise.

Rule for the Phanpy integration:

```text
browser -> ActivityPods application/social mutation contract
        -> ActivityPods authority/outbox
        -> durable federation handoff
        -> sidecar delivery
        -> ActivityPods internal signing service when a Pod actor signature is required
```

Never invert this chain by making Phanpy call signing, queue, delivery, or recipient-routing internals.

## Verified findings — Mastopod federation/query architecture

### Public indexing already exists — REUSE_AS_IS

`SearchIndexerService` is the RedPanda -> public-search projection path. It already handles public-search consent, AP projection, batching, deduplication, tombstones, DLQ behavior, OpenSearch/Qdrant targets, and public author/content projections.

Phanpy must not build another public ingestion/indexing pipeline.

### Legacy/phase-era query classes are not the primary frontend contract

`search/queries/FeedCandidateService.ts` and `PublicSearchService.ts` remain useful lower-level/phase-era query code, but the newer `src/feed/` subsystem is the more relevant application-provider contract.

The earlier audit incorrectly inferred that no feed/hydration route existed because it searched usages of those older classes. That conclusion is superseded by the findings below.

### A concrete provider feed contract already exists — HARDEN_AND_EXPOSE

`fedify-sidecar/src/feed/contracts.ts` defines validated contracts for:

- feed definitions;
- feed kinds: graph, discovery, topic, locality, notifications, custom;
- sources: Stream1, Stream2, canonical, firehose, unified;
- public/authenticated/internal visibility;
- chronological/ranked/blended ranking;
- stable feed skeletons;
- opaque cursors;
- filters for tags, languages and authors;
- hydration shapes;
- hydrated actor/content/media/engagement/provenance results;
- explicit hydration omissions such as deleted, blocked and viewer-not-allowed.

This is much closer to the protocol-neutral Phanpy `FeedRepository` contract than the older candidate service.

### Feed query and hydration HTTP routes are already registered — HARDEN_AND_EXPOSE

`registerFeedFastifyRoutes` exposes provider-internal endpoints including:

```text
GET  /internal/feed/definitions
POST /internal/feed/query
POST /internal/feed/hydrate
POST /internal/feed/viewed
GET  /internal/feed/stream      # SSE
```

and the same subsystem supports WebSocket attachment.

`DefaultPodFeedService` validates feed visibility/provider selection, retries retryable provider errors, validates provider output, deduplicates stable IDs, and returns feed capabilities.

`DefaultPodHydrationService` groups by source, uses bounded concurrency/retries, deduplicates hydration inputs, and returns explicit omission reasons instead of silently fabricating unavailable content.

These are real runtime contracts on current `main`.

### These routes are not browser-ready as-is

The current `/internal/feed/*` surface authenticates with the sidecar service bearer token and provider permission headers. Those credentials belong to trusted service-to-service communication and must never be embedded in Phanpy.

Therefore the missing client-facing work is a browser-safe application/session boundary, not a new feed engine.

Target:

```text
Phanpy
  -> browser-safe authenticated application gateway
  -> existing provider feed/query/hydration services
  -> OpenSearch/Qdrant / public projections
```

The gateway must bind the authenticated viewer identity server-side rather than trusting an arbitrary browser-supplied `viewerId`.

### Realtime feed delivery already exists — HARDEN_AND_EXPOSE

The earlier audit statement that no Durable Streams implementation existed was incorrect and is superseded.

Current `main` includes:

- `DurableStreamContracts.ts`;
- `DurableStreamSubscriptionService.ts`;
- SSE and WebSocket feed routes;
- `FeedStreamKafkaConsumer.ts`;
- `UnifiedFeedBridge.ts`;
- tests for the stream service/routes.

`FeedStreamKafkaConsumer` maps RedPanda topics into stream envelopes:

```text
ap.stream1.local-public.v1  -> stream1
ap.stream2.remote-public.v1 -> stream2
canonical.v1                -> canonical
```

It embeds Kafka partition/offset information in each stream cursor and fans validated envelopes into the SSE/WebSocket subscription service.

`UnifiedFeedBridge` produces an observe-only normalized `unified` public stream from canonical events plus remote public Stream2 events without writing protocol state.

### Realtime is not yet durably replayable

The name `DurableStreamSubscriptionService` must not be interpreted as proof of complete durable replay semantics.

The current implementation explicitly states:

- fan-out is in-process;
- cursor state is in-memory in v1;
- there is no Redis/external cursor persistence;
- supplied resume cursors are decoded but the subscription service itself does not seek/replay RedPanda history.

The sidecar startup configuration currently declares stream capabilities with:

```text
replayCapable: false
```

Therefore Phase 9 is **HARDEN_AND_EXPOSE**, not `NEW_WORK` and not `REUSE_AS_IS`.

Required Phase 9 work:

1. preserve the existing stream envelope/SSE/WS contracts where compatible;
2. define exact replay semantics from the Kafka partition/offset cursor;
3. implement bounded RedPanda seek/replay or a durable replay projection without exposing Kafka directly to clients;
4. define retention/expired-cursor behavior and snapshot fallback;
5. guarantee duplicate/out-of-order safety across replay -> live handoff;
6. expose a browser-safe authenticated subscription contract;
7. bind viewer-specific streams/filters to server-authorized viewer context;
8. keep private/Pod changes on the Solid Notifications plane unless a separately reviewed private stream contract is introduced.

### Unified public stream already exists

The existing `unified` stream is especially useful for the Phanpy architecture: it provides a normalized public event surface across canonical local/protocol-bridged activity and remote ActivityPub without allowing the client to depend on raw RedPanda topic payload diversity.

It should be evaluated as the default public live substrate for Phanpy before inventing feed-specific streams.

## Authority/transport ownership matrix

| Concern | Browser / Phanpy | ActivityPods / SemApps | Federation sidecar |
| --- | --- | --- | --- |
| Session/app grant | request/use authorized session | authority + Pod/application grant | none |
| Local actor identity | consume normalized identity | canonical authority | projection only where needed |
| Pod CRUD/ACL | adapter calls | canonical resource/permission authority | none |
| Social mutation intent | submit user operation | validate/apply canonical write + outbox | never accepts browser mutation intent |
| Recipient routing | none | resolve/freeze personal/shared inbox targets | consume frozen target snapshot |
| AP signing keys | none | sole custody + internal signing | receive signed headers only |
| Federation delivery | none | durable handoff authority | execute outbound delivery/retries |
| Public index/feed | consume browser-safe façade | supply authoritative local/public events | projection/query/hydration acceleration |
| Public live | consume browser-safe SSE/WS | produce authoritative events | project/fan-out; replay to be completed |
| Private/Pod live | Solid Notifications client adapter | Solid Notifications + authorized Pod state | no public-stream leakage |
| User-visible AP notifications | render normalized semantics | ActivityPub/Pod notification authority | public projection only if policy permits |

This matrix is the guardrail against accidental duplication. A Phanpy adapter may normalize or combine outputs, but it must not silently acquire authority owned by a backend plane.

## Corrected contract classification

| Area | Classification | Owning repo / action |
| --- | --- | --- |
| ActivityPods account/actor authority | `REUSE_AS_IS` | ActivityPods |
| ActivityPods app registration semantics | `REUSE_BEHIND_ADAPTER` | Phanpy session adapter over ActivityPods/Solid |
| Pod resources/permissions | `REUSE_BEHIND_ADAPTER` | ActivityPods |
| ActivityPods collections | `REUSE_BEHIND_ADAPTER` | ActivityPods + Phanpy collection repository |
| ActivityPods canonical social mutations | `REUSE_BEHIND_ADAPTER` | Phanpy mutation repository -> ActivityPods |
| ActivityPods current AP signing authority | `REUSE_AS_IS` | ActivityPods `master`; internal only, never browser-facing |
| ActivityPods PR #107 signing hardening | `HARDEN_AND_EXPOSE` only to trusted sidecar semantics | Pending defense-in-depth; not a Phanpy client prerequisite |
| Sidecar delivery routing/queues | `REUSE_AS_IS` | Internal only |
| Public search indexing | `REUSE_AS_IS` | Federation architecture |
| Provider feed contracts/service | `HARDEN_AND_EXPOSE` | Federation architecture + browser-safe gateway |
| Provider hydration service | `HARDEN_AND_EXPOSE` | Federation architecture + browser-safe gateway |
| Viewership history integration | `HARDEN_AND_EXPOSE` | Bind viewer server-side; never trust browser identity input |
| SSE/WebSocket realtime transport | `HARDEN_AND_EXPOSE` | Existing implementation |
| RedPanda -> realtime consumer | `REUSE_AS_IS` with replay integration | Existing implementation |
| Unified public live stream | `REUSE_BEHIND_ADAPTER` | Evaluate as Phanpy default public live source |
| Durable replay/resume | `NEW_WORK` inside existing realtime subsystem | Phase 9 |
| Solid Notifications transport | `REUSE_BEHIND_ADAPTER` | ActivityPods/SemApps + Phanpy private live adapter |
| ActivityPub notification semantics | `REUSE_BEHIND_ADAPTER` | ActivityPods + Phanpy notification repository |
| Framework7 | `DEFERRED` pending Phase 3 proof | Phanpy |

## Immediate Phase 0 work still open

### ActivityPods

- verify current Solid-OIDC/session frontend/runtime stack beyond the legacy React hook;
- verify browser-appropriate application-grant/access-needs flow for Phanpy;
- verify the exact canonical post/reply/like/announce/follow mutation entry points against the modern delivery path;
- verify Solid Notifications endpoint discovery/subscription behavior and authorization in the current fork;
- verify media/blob ownership and client upload contract;
- track PR #107 as signing credential-hygiene hardening, without treating it as a Phanpy client prerequisite.

### Federation/query architecture

- audit concrete feed registry definitions/providers currently enabled on `main`;
- verify viewer authorization/moderation policy placement in feed query, hydration and realtime paths;
- verify stable cursor semantics for snapshot feeds independently of live replay;
- define browser-safe gateway/session authorization around `/internal/feed/*`;
- define and implement replay semantics for current `replayCapable: false` streams;
- verify whether custom feed definitions already have provider/compiler support beyond the generic contract;
- verify search HTTP exposure separately from feed/hydration exposure;
- reconcile/remove or clearly quarantine stale ActivityPods signing integration copies so they cannot be mistaken for current authority.

### Phanpy

- map current Mastodon operation families to these verified replacement contracts;
- add behavior-preservation tests around feed pagination, mutations, hydration/cache invalidation, and live update/delete behavior before Phase 2 refactoring;
- define protocol-neutral domain types from the verified `src/feed/contracts.ts` shapes rather than from Mastodon response objects.

## Phase 0 exit gate

Phase 0 is complete only when every client capability has:

- a classification;
- an owning repository;
- a concrete current contract or explicitly identified missing contract;
- an authority/privacy boundary;
- a testable implementation path.

The point of Phase 0 is not to delay implementation. It is to ensure Phase 1 starts from the contracts that actually exist, especially where newer architecture already solved work that older files or narrow code searches can hide.
