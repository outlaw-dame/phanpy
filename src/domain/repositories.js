// Repository contracts are deliberately transport- and protocol-neutral.
// Adapters may use Mastodon REST/streaming, ActivityPods/Solid, the Mastopod
// browser gateway, or future protocol backends without leaking those DTOs into UI.

/** @typedef {import('./model.js').DomainActor} DomainActor */
/** @typedef {import('./model.js').DomainPost} DomainPost */
/** @typedef {import('./model.js').DomainSession} DomainSession */
/** @typedef {import('./model.js').DomainRelationship} DomainRelationship */
/** @typedef {import('./model.js').DomainNotification} DomainNotification */
/** @typedef {import('./model.js').DomainCollection} DomainCollection */
/** @typedef {import('./model.js').CustomFeedDefinition} CustomFeedDefinition */
/** @typedef {import('./model.js').FeedPage} FeedPage */
/** @typedef {import('./model.js').FeedQuery} FeedQuery */
/** @typedef {import('./model.js').HydrationResult} HydrationResult */
/** @typedef {import('./model.js').LiveEnvelope} LiveEnvelope */
/** @typedef {import('./model.js').LiveSubscription} LiveSubscription */

/**
 * @typedef {Object} SessionRepository
 * @property {() => Promise<DomainSession|null>} restore
 * @property {(input: object) => Promise<DomainSession>} login
 * @property {() => Promise<void>} logout
 * @property {() => Promise<DomainSession|null>} current
 */

/**
 * @typedef {Object} IdentityRepository
 * @property {() => Promise<DomainActor>} currentActor
 * @property {(key: string) => Promise<DomainActor|null>} getActor
 * @property {(query: string, options?: object) => Promise<DomainActor[]>} searchActors
 */

/**
 * @typedef {Object} RelationshipRepository
 * @property {(actorKey: string) => Promise<DomainRelationship>} get
 * @property {(actorKey: string) => Promise<DomainRelationship>} follow
 * @property {(actorKey: string) => Promise<DomainRelationship>} unfollow
 * @property {(actorKey: string) => Promise<DomainRelationship>} block
 * @property {(actorKey: string) => Promise<DomainRelationship>} unblock
 * @property {(actorKey: string) => Promise<DomainRelationship>} mute
 * @property {(actorKey: string) => Promise<DomainRelationship>} unmute
 */

/**
 * @typedef {Object} FeedRepository
 * @property {(query: FeedQuery) => Promise<FeedPage>} query
 * @property {() => Promise<object[]>} definitions
 * @property {(input: {feedId: string, stableIds: string[]}) => Promise<void>=} recordViewed
 */

/**
 * @typedef {Object} HydrationRepository
 * @property {(stableIds: string[], options?: object) => Promise<HydrationResult>} hydrate
 * @property {(key: string, options?: object) => Promise<DomainPost|null>} getPost
 */

/**
 * @typedef {Object} MutationRepository
 * @property {(input: object) => Promise<DomainPost>} createPost
 * @property {(postKey: string, input: object) => Promise<DomainPost>} editPost
 * @property {(postKey: string) => Promise<void>} deletePost
 * @property {(postKey: string) => Promise<DomainPost>} like
 * @property {(postKey: string) => Promise<DomainPost>} unlike
 * @property {(postKey: string) => Promise<DomainPost>} repost
 * @property {(postKey: string) => Promise<DomainPost>} unrepost
 * @property {(postKey: string) => Promise<DomainPost>} bookmark
 * @property {(postKey: string) => Promise<DomainPost>} unbookmark
 */

/**
 * @typedef {Object} NotificationRepository
 * @property {(options?: object) => Promise<{items: DomainNotification[], cursor?: string}>} list
 * @property {(notificationId: string) => Promise<void>} markRead
 * @property {() => Promise<void>} markAllRead
 */

/**
 * @typedef {Object} CollectionRepository
 * @property {(uri: string) => Promise<DomainCollection|null>} get
 * @property {(input: object) => Promise<DomainCollection>} create
 * @property {(uri: string) => Promise<void>} remove
 * @property {(uri: string, itemUri: string) => Promise<void>} addItem
 * @property {(uri: string, itemUri: string) => Promise<void>} removeItem
 */

/**
 * @typedef {Object} CustomFeedRepository
 * @property {() => Promise<CustomFeedDefinition[]>} list
 * @property {(id: string) => Promise<CustomFeedDefinition|null>} get
 * @property {(input: CustomFeedDefinition) => Promise<CustomFeedDefinition>} save
 * @property {(id: string) => Promise<void>} remove
 */

/**
 * @typedef {Object} SearchRepository
 * @property {(query: string, options?: object) => Promise<object>} search
 */

/**
 * @typedef {Object} MediaRepository
 * @property {(file: File|Blob, options?: object) => Promise<object>} upload
 * @property {(mediaId: string) => Promise<void>} remove
 */

/**
 * @typedef {Object} LiveRepository
 * @property {(topics: string[], handlers: {onEvent: (event: LiveEnvelope) => void, onError?: (error: Error) => void}, options?: object) => Promise<LiveSubscription>} subscribe
 */

/**
 * @typedef {Object} RepositorySet
 * @property {SessionRepository} session
 * @property {IdentityRepository} identity
 * @property {RelationshipRepository} relationships
 * @property {FeedRepository} feeds
 * @property {HydrationRepository} hydration
 * @property {MutationRepository} mutations
 * @property {NotificationRepository} notifications
 * @property {CollectionRepository} collections
 * @property {CustomFeedRepository} customFeeds
 * @property {SearchRepository} search
 * @property {MediaRepository} media
 * @property {LiveRepository} live
 */

export const REPOSITORY_METHODS = Object.freeze({
  session: ['restore', 'login', 'logout', 'current'],
  identity: ['currentActor', 'getActor', 'searchActors'],
  relationships: ['get', 'follow', 'unfollow', 'block', 'unblock', 'mute', 'unmute'],
  feeds: ['query', 'definitions'],
  hydration: ['hydrate', 'getPost'],
  mutations: [
    'createPost',
    'editPost',
    'deletePost',
    'like',
    'unlike',
    'repost',
    'unrepost',
    'bookmark',
    'unbookmark',
  ],
  notifications: ['list', 'markRead', 'markAllRead'],
  collections: ['get', 'create', 'remove', 'addItem', 'removeItem'],
  customFeeds: ['list', 'get', 'save', 'remove'],
  search: ['search'],
  media: ['upload', 'remove'],
  live: ['subscribe'],
});

/**
 * Fail fast if an adapter wiring is incomplete. This keeps protocol-specific
 * fallbacks from leaking into components when a repository is forgotten.
 *
 * @param {Partial<RepositorySet>} repositories
 * @param {{allowPartial?: boolean}=} options
 * @returns {RepositorySet|Partial<RepositorySet>}
 */
export function assertRepositorySet(repositories, { allowPartial = false } = {}) {
  if (!repositories || typeof repositories !== 'object') {
    throw new TypeError('Repository set must be an object');
  }

  for (const [name, methods] of Object.entries(REPOSITORY_METHODS)) {
    const repository = repositories[name];
    if (!repository) {
      if (allowPartial) continue;
      throw new TypeError(`Missing ${name} repository`);
    }
    if (typeof repository !== 'object') {
      throw new TypeError(`${name} repository must be an object`);
    }
    for (const method of methods) {
      if (typeof repository[method] !== 'function') {
        throw new TypeError(`${name} repository is missing ${method}()`);
      }
    }
  }

  return repositories;
}

/**
 * Construct a frozen repository set after validation. Freezing the top-level
 * set prevents accidental per-page adapter replacement; session/account
 * switching must happen through an explicit application composition boundary.
 *
 * @param {RepositorySet} repositories
 * @returns {RepositorySet}
 */
export function createRepositorySet(repositories) {
  assertRepositorySet(repositories);
  return Object.freeze({ ...repositories });
}
