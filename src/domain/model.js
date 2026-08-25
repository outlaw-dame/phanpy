// Protocol-neutral social domain contracts for Phanpy.
//
// These JSDoc types intentionally model product semantics rather than Mastodon,
// ActivityPub, ActivityPods, ATProto, or any single provider's wire DTOs. Adapters
// are responsible for normalization at the repository boundary.

/** @typedef {'mastodon'|'activitypub'|'activitypods'|'atproto'|'canonical'|'unknown'} ProtocolKind */
/** @typedef {'public'|'unlisted'|'followers'|'direct'|'private'|'unknown'} Visibility */
/** @typedef {'local'|'remote'|'projected'|'pod'|'unknown'} SourceKind */
/** @typedef {'chronological'|'ranked'|'blended'} FeedRanking */
/** @typedef {'graph'|'discovery'|'topic'|'locality'|'notifications'|'custom'|'personal'} FeedKind */
/** @typedef {'stream1'|'stream2'|'canonical'|'firehose'|'unified'|'pod'|'mastodon'|'unknown'} FeedSource */
/** @typedef {'deleted'|'blocked'|'viewer_not_allowed'|'not_found'|'invalid'|'unavailable'} HydrationOmissionReason */
/** @typedef {'public'|'private_hint'|'pod'} LiveSourceKind */

/**
 * Stable identity that survives projection/provider changes.
 * `canonicalUri` is preferred whenever the source protocol exposes a canonical
 * HTTP(S) URI. `providerId` may be used only inside the owning adapter.
 * @typedef {Object} DomainIdentity
 * @property {string} key Stable Phanpy identity key.
 * @property {string=} canonicalUri
 * @property {string=} webId
 * @property {string=} did
 * @property {string=} providerId
 * @property {ProtocolKind} protocol
 */

/**
 * A stable mutation context is created before the first network attempt and is
 * reused for every retry. Adapters must never silently drop this identity.
 * @typedef {Object} MutationContext
 * @property {string} clientOperationId
 * @property {string=} expectedRevision Optimistic-concurrency token when supported.
 */

/**
 * @typedef {Object} DomainActor
 * @property {DomainIdentity} identity
 * @property {string} displayName
 * @property {string=} handle
 * @property {string=} username
 * @property {string=} avatarUrl
 * @property {string=} headerUrl
 * @property {string=} summaryHtml
 * @property {string=} url
 * @property {boolean=} bot
 * @property {boolean=} locked
 * @property {boolean=} discoverable
 * @property {string=} movedToKey
 * @property {Record<string, string>=} fields
 * @property {Object=} provenance
 * @property {SourceKind=} provenance.sourceKind
 * @property {string=} provenance.authorityUri
 * @property {string=} provenance.observedAt
 */

/**
 * @typedef {Object} DomainMedia
 * @property {string} id Stable media key; canonical resource URI when available.
 * @property {'image'|'video'|'audio'|'gifv'|'file'|'unknown'} kind
 * @property {string} url
 * @property {string=} previewUrl
 * @property {string=} remoteUrl
 * @property {string=} description
 * @property {string=} blurhash
 * @property {string=} mimeType
 * @property {number=} width
 * @property {number=} height
 * @property {number=} durationSeconds
 * @property {string=} processingState
 */

/**
 * @typedef {Object} DomainEngagement
 * @property {number=} replies
 * @property {number=} likes
 * @property {number=} reposts
 * @property {boolean=} viewerLiked
 * @property {boolean=} viewerReposted
 * @property {boolean=} viewerBookmarked
 */

/**
 * @typedef {Object} DomainPost
 * @property {DomainIdentity} identity
 * @property {DomainActor} author
 * @property {string} createdAt
 * @property {string=} editedAt
 * @property {string} contentHtml
 * @property {string=} contentText
 * @property {string=} spoilerText
 * @property {Visibility} visibility
 * @property {string=} language
 * @property {string=} url
 * @property {string=} replyToKey
 * @property {string=} threadRootKey
 * @property {string=} quoteKey
 * @property {string=} repostOfKey
 * @property {DomainMedia[]=} media
 * @property {DomainEngagement=} engagement
 * @property {string[]=} tags
 * @property {boolean=} sensitive
 * @property {boolean=} deleted
 * @property {Object=} provenance
 * @property {SourceKind=} provenance.sourceKind
 * @property {FeedSource=} provenance.feedSource
 * @property {string=} provenance.authorityUri
 * @property {string=} provenance.revision
 */

/**
 * A lightweight feed row. It may be hydrated already or contain only the stable
 * identity required by HydrationRepository.
 * @typedef {Object} FeedSkeleton
 * @property {string} stableId
 * @property {string=} canonicalUri
 * @property {ProtocolKind=} protocol
 * @property {FeedSource=} source
 * @property {number=} score
 * @property {string=} reason
 */

/**
 * @typedef {Object} FeedPage
 * @property {FeedSkeleton[]} items
 * @property {string=} cursor Opaque adapter/provider cursor. UI must never parse it.
 * @property {boolean=} hasMore
 * @property {Object=} capabilities
 * @property {boolean=} capabilities.hydrationRequired
 * @property {boolean=} capabilities.realtime
 */

/**
 * @typedef {Object} FeedQuery
 * @property {string} feedId
 * @property {FeedKind=} kind
 * @property {number=} limit
 * @property {string=} cursor
 * @property {string[]=} tags
 * @property {string[]=} languages
 * @property {string[]=} actorKeys
 */

/**
 * @typedef {Object} HydrationOmission
 * @property {string} stableId
 * @property {HydrationOmissionReason} reason
 */

/**
 * @typedef {Object} HydrationResult
 * @property {DomainPost[]} posts
 * @property {HydrationOmission[]} omissions
 */

/**
 * Federated relationship state only. Viewer-private presentation policy is kept
 * outside this object so adapters do not force Mastodon DTO semantics onto AP.
 * @typedef {Object} DomainRelationship
 * @property {string} actorKey
 * @property {boolean} following
 * @property {boolean} followedBy
 * @property {boolean=} requested
 * @property {boolean=} blocked
 * @property {boolean=} muted
 * @property {boolean=} domainBlocked
 */

/**
 * @typedef {Object} DomainNotification
 * @property {string} id Stable notification key; canonical activity URI when available.
 * @property {'mention'|'reply'|'follow'|'follow_request'|'like'|'repost'|'poll'|'status'|'update'|'unknown'} kind
 * @property {string} createdAt
 * @property {DomainActor=} actor
 * @property {DomainPost=} post
 * @property {boolean=} read
 * @property {string=} canonicalActivityUri
 */

/**
 * @typedef {Object} DomainCollection
 * @property {string} uri
 * @property {string} name
 * @property {string=} summary
 * @property {boolean=} ordered
 * @property {string[]=} itemUris
 * @property {string=} cursor
 */

/**
 * @typedef {Object} CustomFeedDefinition
 * @property {string} id
 * @property {string} name
 * @property {string[]=} collectionUris
 * @property {string[]=} actorKeys
 * @property {string[]=} tags
 * @property {string[]=} languages
 * @property {string[]=} exclusions
 * @property {boolean=} includeReplies
 * @property {boolean=} includeReposts
 * @property {FeedRanking=} ranking
 * @property {'private'|'public'=} visibility
 */

/**
 * @typedef {Object} DomainSession
 * @property {string} id
 * @property {'mastodon'|'activitypods'} provider
 * @property {string} accountKey
 * @property {string=} webId
 * @property {string=} applicationUri
 * @property {string=} providerBaseUrl
 * @property {string=} expiresAt
 * @property {string[]=} capabilities
 */

/**
 * `source` is semantic, not necessarily a separate socket. FEP may multiplex
 * public and private-hint events over one connection, while Solid Notifications
 * supplies Pod-resource events through a different transport.
 * @typedef {Object} LiveEnvelope
 * @property {string} eventId
 * @property {LiveSourceKind} source
 * @property {string} topic
 * @property {'create'|'update'|'delete'|'activitypub'|'canonical'|'feed'|'notification'|'invalidate'|'unknown'} event
 * @property {string} occurredAt
 * @property {unknown} payload
 * @property {string=} cursor
 * @property {boolean=} replayed
 */

/**
 * @typedef {Object} LiveSubscription
 * @property {() => void} close
 * @property {Promise<void>=} ready
 */

/**
 * Return a normalized canonical key for dedupe/cache indexing. This helper is
 * deliberately provider-agnostic and rejects empty identifiers.
 *
 * @param {DomainIdentity|FeedSkeleton|string} value
 * @returns {string}
 */
export function domainKey(value) {
  if (typeof value === 'string') {
    const key = value.trim();
    if (!key) throw new TypeError('Domain key must not be empty');
    return key;
  }

  if (!value || typeof value !== 'object') {
    throw new TypeError('Domain identity must be a string or object');
  }

  if ('key' in value && typeof value.key === 'string' && value.key.trim()) {
    return value.key.trim();
  }
  if (
    'stableId' in value &&
    typeof value.stableId === 'string' &&
    value.stableId.trim()
  ) {
    return value.stableId.trim();
  }
  if (
    'canonicalUri' in value &&
    typeof value.canonicalUri === 'string' &&
    value.canonicalUri.trim()
  ) {
    return value.canonicalUri.trim();
  }

  throw new TypeError('Domain identity does not contain a stable key');
}

/**
 * Validate the client-operation identity before an adapter can perform a
 * canonical mutation.
 *
 * @param {MutationContext} context
 * @returns {string}
 */
export function mutationOperationId(context) {
  const operationId = context?.clientOperationId?.trim?.();
  if (!operationId) {
    throw new TypeError('Mutation context requires clientOperationId');
  }
  if (operationId.length > 256) {
    throw new TypeError('clientOperationId exceeds 256 characters');
  }
  return operationId;
}

/**
 * Visibility predicate used at public projection boundaries. Unknown visibility
 * intentionally fails closed.
 *
 * @param {Visibility} visibility
 * @returns {boolean}
 */
export function isPublicVisibility(visibility) {
  return visibility === 'public' || visibility === 'unlisted';
}
