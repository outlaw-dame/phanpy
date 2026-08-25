import { expect, test } from '@playwright/test';

import { domainKey, isPublicVisibility } from '../src/domain/model.js';
import {
  REPOSITORY_METHODS,
  assertRepositorySet,
  createRepositorySet,
} from '../src/domain/repositories.js';

function makeRepositorySet() {
  return Object.fromEntries(
    Object.entries(REPOSITORY_METHODS).map(([name, methods]) => [
      name,
      Object.fromEntries(methods.map((method) => [method, async () => undefined])),
    ]),
  );
}

test.describe('domain model contracts', () => {
  test('uses stable provider-neutral keys', () => {
    expect(domainKey('https://example.test/objects/1')).toBe(
      'https://example.test/objects/1',
    );
    expect(domainKey({ key: 'canonical:1' })).toBe('canonical:1');
    expect(domainKey({ stableId: 'feed:1' })).toBe('feed:1');
    expect(domainKey({ canonicalUri: 'https://example.test/objects/2' })).toBe(
      'https://example.test/objects/2',
    );
  });

  test('rejects missing stable identity', () => {
    expect(() => domainKey('')).toThrow('Domain key must not be empty');
    expect(() => domainKey({})).toThrow(
      'Domain identity does not contain a stable key',
    );
  });

  test('public projection visibility fails closed', () => {
    expect(isPublicVisibility('public')).toBe(true);
    expect(isPublicVisibility('unlisted')).toBe(true);
    expect(isPublicVisibility('followers')).toBe(false);
    expect(isPublicVisibility('direct')).toBe(false);
    expect(isPublicVisibility('private')).toBe(false);
    expect(isPublicVisibility('unknown')).toBe(false);
  });
});

test.describe('repository contracts', () => {
  test('accepts a complete repository set and freezes composition', () => {
    const repositories = makeRepositorySet();
    expect(assertRepositorySet(repositories)).toBe(repositories);

    const composed = createRepositorySet(repositories);
    expect(Object.isFrozen(composed)).toBe(true);
  });

  test('fails fast when a repository is missing', () => {
    const repositories = makeRepositorySet();
    delete repositories.live;
    expect(() => assertRepositorySet(repositories)).toThrow(
      'Missing live repository',
    );
  });

  test('fails fast when an adapter method is missing', () => {
    const repositories = makeRepositorySet();
    delete repositories.feeds.query;
    expect(() => assertRepositorySet(repositories)).toThrow(
      'feeds repository is missing query()',
    );
  });

  test('supports intentionally partial sets for incremental migration', () => {
    const repositories = makeRepositorySet();
    const partial = { feeds: repositories.feeds };
    expect(assertRepositorySet(partial, { allowPartial: true })).toBe(partial);
  });
});
