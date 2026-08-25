# ActivityPods Integration — Phase 0 Contract Audit

## Purpose

This is the implementation-level companion to `ACTIVITYPODS-INTEGRATION-ARCHITECTURE.md`.

It records what has been verified in the current code of:

- `outlaw-dame/phanpy`
- `outlaw-dame/activity-pods`
- `outlaw-dame/mastopod-federation-architecture`

The goal is to distinguish four categories before runtime integration begins:

1. functionality that already exists and should be reused;
2. functionality that exists internally but needs a stable application-facing contract;
3. functionality that exists only in legacy/boilerplate form and must be adapted carefully;
4. genuine missing work.

This document is deliberately evidence-oriented. Historical architecture documents are not treated as runtime truth when current code disagrees with them.

## Verified findings — Phanpy

### 1. API/session boundary is Mastodon-specific

`src/utils/api.js` owns the current client boundary and directly constructs `masto` REST and streaming clients. It stores clients by instance and access token and exposes Mastodon-specific `masto` and `streaming` objects to the rest of the UI.

Implication: this file cannot merely be taught ActivityPods endpoints. It should be progressively superseded by protocol-neutral repositories while the existing implementation becomes the Mastodon adapter.

Target split:

```text
current src/utils/api.js
        |
        v
legacy Mastodon adapter
        |
        +-- IdentityRepository
        +-- FeedRepository
        +-- MutationRepository
        +-- SearchRepository
        +-- NotificationRepository
        +-- MediaRepository
        +-- LiveRepository
```

### 2. Authentication is directly coupled to Mastodon dynamic application registration

`src/utils/auth.js` currently:

- dynamically registers an app through `/api/v1/apps`;
- requests Mastodon scopes `read write follow push`;
- performs OAuth authorization/token exchange;
- supports PKCE;
- revokes Mastodon access tokens.

Implication: ActivityPods authentication is a replacement implementation of the session/identity repository, not an extension of these Mastodon endpoint helpers.

### 3. Home timeline currently mixes query, polling, streaming, and recipient state in one page

The current home page directly combines:

- Mastodon home-timeline pagination;
- `since_id` polling for newer statuses;
- Mastodon user-stream WebSocket subscription;
- update/delete live-event handling;
- follow-request/notification-marker related work.

Implication: the ActivityPods migration should not translate this page line-for-line. Phase 1/2 must separate:

```text
FeedRepository
  -> snapshot/pagination

LiveRepository
  -> incremental add/update/delete

NotificationRepository / RelationshipRepository
  -> recipient-specific state and markers
```

This is also why Durable Streams belongs after the feed repository exists: it can replace the public live implementation without rewriting the page again.

### 4. Composer is directly Mastodon-coupled

`src/components/compose.jsx` contains direct `masto` calls rather than calling a protocol-neutral mutation/media surface.

Implication: composer migration belongs behind `MutationRepository` and `MediaRepository`; UI draft state and rendering should remain Phanpy-owned.

### 5. Existing Mastodon behavior should remain the Phase 2 regression oracle

The migration should first preserve current Mastodon behavior through repositories. ActivityPods-specific behavior begins only after the repository contracts have been exercised by the existing client.

## Verified findings — ActivityPods

### 1. ActivityPods already has an application framework, but its React package is not an appropriate Phanpy UI foundation

The repository has distinct backend/application and React packages. The React package is tied to React Admin, React 18, and MUI, while Phanpy is Preact with a custom UI.

Decision: reuse low-level contracts/semantics, not the React Admin presentation layer.

### 2. Application registration is based on the user's authorization agent

The existing `useRegisterApp` flow:

1. fetches the user's WebID/actor;
2. reads `interop:hasAuthorizationAgent`;
3. fetches the authorization agent;
4. checks the HTTP `Link` header for `solid/interop#registeredAgent`;
5. if already registered, returns the application-registration URI;
6. otherwise redirects to `interop:hasAuthorizationRedirectEndpoint` with `client_id`.

Implication: the Phanpy ActivityPods auth adapter should reproduce the protocol behavior without importing the React Admin hook. The exact current server-side Solid-OIDC/session library and redirect/callback plumbing still need to be verified before Phase 4 implementation.

### 3. The ActivityPods app service already composes the application-side Pod capability set

`app-framework/app/service.js` creates services for:

- application actors and registration;
- access needs/groups, app registrations, data grants, access grants;
- Pod activity watching;
- notifications;
- collections;
- containers;
- outbox posting;
- permissions;
- resources;
- WAC groups;
- SHACL/Shape Trees and migration utilities.

Implication: Phanpy should not invent parallel server-side Pod helpers until the existing services have been checked for current compatibility.

### 4. Existing app-side outbox helper posts through an authority-preserving path

`pod-outbox.post`:

- resolves the target user's actor/outbox;
- adds JSON-LD context if missing;
- uses the ActivityPods app actor;
- posts through `signature.proxy.query` rather than taking signing keys into the app;
- returns the created resource location on success.

Implication: the architectural rule that keys remain in ActivityPods is already reflected in the app framework. Before using this exact helper, Phase 0 still needs to compare it with the newer fork-specific federation/outbox path so we do not reintroduce an obsolete route around the Fedify work.

### 5. ActivityPods collections are already concrete reusable resources

`pod-collections` already supports:

- reading collection items;
- creating an ordered or unordered ActivityStreams collection and attaching it to another resource;
- deleting/detaching the collection;
- adding/removing members with SPARQL Update;
- finding the attached collection URI;
- provisioning missing attached collections across registered Pods.

The implementation stores collections as ActivityStreams `Collection`/`OrderedCollection` resources under Pod data and can apply SemApps pagination/dereference/sort options.

Implication: Phase 11 should build Phanpy collection semantics on this existing substrate rather than creating a separate list store. Phase 12 custom feeds can reference these collection URIs as query operands.

## Verified findings — Mastopod federation/query architecture

### 1. The authoritative three-tier split is implemented, not merely documented

The current sidecar entry point initializes:

- Redis Streams queue infrastructure;
- RedPanda event-log producers/consumers;
- the public search indexer;
- OpenSearch/Qdrant bootstrap services;
- federation workers and MRF;
- ActivityPods integration;
- protocol bridge and ATProto runtime.

Decision: Phanpy must consume application-facing contracts above this infrastructure. It must never embed Redis/RedPanda/OpenSearch clients in the browser.

### 2. Public search indexing already consumes the durable public event plane

`SearchIndexerService` is explicitly the canonical RedPanda-to-public-search ingestion path. It:

- consumes the AP firehose and tombstone topics;
- projects public AP events;
- applies public-search consent checks;
- writes public content and author projections;
- handles batching, retries/deduplication, tombstones, and DLQ behavior;
- can target OpenSearch, Qdrant, or dual mode.

Implication: Phase 7 does not need to build public ingestion/indexing from scratch.

### 3. A feed candidate service already exists, but it is an internal candidate layer rather than a finished Phanpy feed API

`FeedCandidateService` currently defines:

- `feedType: 'home' | 'custom' | 'topic'`;
- graph, trending, and interest candidate buckets;
- OpenSearch `search_after` cursors for those buckets;
- stable document IDs and candidate scores;
- deduplication/merge across buckets.

However, the source explicitly describes passed-in/mock user interests/follow graph for that phase and notes semantic/local-affinity buckets as future/real-system work.

Implication: do not duplicate it, but do not expose it directly to Phanpy yet. It needs a production viewer-context contract, authorization/policy integration, ranking/hydration contract, and application-facing pagination envelope.

### 4. PublicSearchService already implements lexical/semantic/hybrid query internals

The service accepts query, language/tag filters, mode, limit, and cursor, and targets `public-content-v1` with an optional hybrid search pipeline.

Current limitations relevant to Phanpy:

- its cursor is explicitly simplified phase-era `from/size` rather than a hardened stable `search_after` contract;
- it returns stable document IDs + scores, not a complete Phanpy-facing hydrated result envelope;
- no stable browser-facing HTTP route has yet been verified around this service.

Implication: Phase 13 is primarily contract hardening/exposure + hydration/identity mapping, not creation of the search engine.

### 5. No Durable Streams implementation has been found in either architecture repository so far

Repository code search for `DurableStream`, `Durable Streams`, `durable-streams`, and `durable_stream` returned no matches in:

- `outlaw-dame/mastopod-federation-architecture`;
- `outlaw-dame/activity-pods`.

Current classification: **probable genuine missing backend/application-delivery work**.

Before implementation, Phase 0 will still verify package manifests, deployment files, non-code docs, and branch history so absence is not concluded from a single code-search mechanism.

If confirmed absent, the intended boundary remains:

```text
RedPanda
   -> feed/live projection consumer
   -> Durable Streams HTTP service
   -> Phanpy LiveRepository
```

Durable Streams must not read/serve private content merely because a user-specific feed includes private state. Private/Pod changes remain on an authenticated ActivityPods/Solid Notifications path unless a separately proven private Durable Streams contract is deliberately designed.

## Current contract classification

| Area | Classification | Phase impact |
| --- | --- | --- |
| ActivityPods authority | Exists; exact current routes still being reconciled | Reuse/harden in Phases 4–6 |
| ActivityPods app registration | Exists; legacy React hook demonstrates protocol flow | Implement framework-independent client in Phase 4 |
| ActivityPods collections | Exists | Reuse in Phase 11; feed operands in Phase 12 |
| ActivityPods app outbox helper | Exists but must be reconciled against newer federation path | No direct adoption until verified |
| Stream1/Stream2/Firehose | Existing architecture substrate | Reuse in Phase 7+ |
| Public search indexing | Exists and is actively hardened | Reuse |
| Feed candidate generation | Exists internally, incomplete as app-facing product contract | Harden/expose rather than rebuild |
| Public search queries | Exists internally, pagination/hydration/API need hardening | Harden/expose rather than rebuild |
| Browser-facing feed API | Not yet verified | Continue Phase 0 audit |
| Hydration API | Not yet verified | Continue Phase 0 audit |
| Durable Streams projection/service | No implementation found so far | Likely new Phase 9 backend work |
| Solid Notifications | ActivityPods concept/service exists; exact current frontend contract pending | Phase 10 |
| Media/blob path | Architecture clearly contains dedicated implementation/docs; exact client contract pending | Phase 15 |
| Framework7 | Not present as current Phanpy foundation | Phase 3 proof only |

## Phase 0 work still open

### Phanpy

- finish exhaustive direct `masto` call inventory;
- map every call family to a repository contract;
- inventory model-shape leakage where components assume Mastodon response fields even without direct API calls;
- identify tests/e2e paths that can serve as behavior-preservation gates in Phase 2.

### ActivityPods

- verify the current Solid-OIDC/session frontend stack rather than relying only on the old React package;
- reconcile `pod-outbox.post` with the newer ActivityPods/Fedify authoritative outbox/delivery boundary;
- verify current Pod resource/permission/access-grant routes needed by a Preact client;
- verify Solid Notifications subscription/discovery behavior in the fork;
- verify collection access semantics for a client acting as the user vs an app actor;
- verify media/blob ownership contract.

### Federation/query architecture

- locate/verify any browser-facing query/feed routes around `FeedCandidateService` and `PublicSearchService`;
- locate/verify hydration services and their identity/visibility guarantees;
- verify current Stream1/Stream2/Firehose event schemas and stable identifiers consumed by the indexer;
- verify moderation policy placement for query snapshots and future live projections;
- exhaustively confirm Durable Streams absence/presence across manifests, deployments, branches, and docs;
- if absent, define the smallest application-facing Durable Streams projection contract without coupling it to RedPanda topic schemas.

## Phase 0 exit gate

Phase 0 is complete only when every Phanpy capability is marked one of:

- `REUSE_AS_IS`
- `REUSE_BEHIND_ADAPTER`
- `HARDEN_AND_EXPOSE`
- `NEW_WORK`
- `DEFERRED`

with a concrete owning repository and a tested/inspectable contract.

Runtime Phase 1 must not begin by guessing at a backend contract that Phase 0 could have discovered first.
