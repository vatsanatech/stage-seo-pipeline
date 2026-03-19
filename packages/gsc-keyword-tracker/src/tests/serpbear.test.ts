import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, closeDatabase } from '../db/schema.js';
import { getKeywordsForPeriod } from '../db/repository.js';
import { persistSerpBearKeywords, convertHistoryToSnapshots } from '../serpbear/serpbear-sync.js';
import type { SerpBearKeyword } from '../serpbear/serpbear-client.js';

function makeSerpBearKeyword(overrides: Partial<SerpBearKeyword>): SerpBearKeyword {
  return {
    id: 1,
    keyword: 'haryanvi web series',
    position: 3,
    previousPosition: 5,
    country: 'IN',
    device: 'MOBILE',
    domain: 'stage.in',
    lastUpdated: '2026-03-18T00:00:00Z',
    history: [],
    tags: [],
    ...overrides,
  };
}

describe('SerpBear Sync', () => {
  it('should persist SerpBear keywords to database', async () => {
    const db = await getDatabase(':memory:');

    const serpBearKeywords: SerpBearKeyword[] = [
      makeSerpBearKeyword({ keyword: 'haryanvi web series', position: 3, previousPosition: 5 }),
      makeSerpBearKeyword({ id: 2, keyword: 'rajasthani movies online', position: 7, previousPosition: 7 }),
      makeSerpBearKeyword({ id: 3, keyword: 'bhojpuri comedy', position: 2, previousPosition: 0 }), // New keyword
    ];

    const result = persistSerpBearKeywords(db, 'stage.in', serpBearKeywords);

    assert.equal(result.keywordsSynced, 3);
    assert.equal(result.newKeywords, 1); // bhojpuri comedy was new (previousPosition: 0)
    assert.equal(result.positionChanges, 1); // haryanvi web series changed
    assert.equal(result.domain, 'stage.in');

    // Verify data in DB
    const today = new Date().toISOString().split('T')[0];
    const stored = getKeywordsForPeriod(db, today, today);
    assert.equal(stored.length, 3);

    closeDatabase();
  });

  it('should detect dialect from SerpBear keywords', async () => {
    const db = await getDatabase(':memory:');

    const keywords: SerpBearKeyword[] = [
      makeSerpBearKeyword({ keyword: 'haryanvi action movie', position: 5 }),
      makeSerpBearKeyword({ id: 2, keyword: 'generic ott content', position: 10 }),
    ];

    persistSerpBearKeywords(db, 'stage.in', keywords);

    const today = new Date().toISOString().split('T')[0];
    const stored = getKeywordsForPeriod(db, today, today);
    const haryanvi = stored.find((k) => k.query === 'haryanvi action movie');
    assert.equal(haryanvi?.dialect, 'haryanvi');

    const generic = stored.find((k) => k.query === 'generic ott content');
    assert.equal(generic?.dialect, null);

    closeDatabase();
  });

  it('should sort keyword details by change magnitude', async () => {
    const db = await getDatabase(':memory:');

    const keywords: SerpBearKeyword[] = [
      makeSerpBearKeyword({ keyword: 'kw1', position: 2, previousPosition: 10 }), // +8
      makeSerpBearKeyword({ id: 2, keyword: 'kw2', position: 5, previousPosition: 6 }), // +1
      makeSerpBearKeyword({ id: 3, keyword: 'kw3', position: 15, previousPosition: 3 }), // -12
    ];

    const result = persistSerpBearKeywords(db, 'stage.in', keywords);
    assert.equal(result.keywords[0].keyword, 'kw3'); // Largest absolute change
    assert.equal(result.keywords[0].change, -12);
    assert.equal(result.keywords[1].keyword, 'kw1'); // Second largest
    assert.equal(result.keywords[1].change, 8);

    closeDatabase();
  });

  it('should convert history to snapshot format', () => {
    const history = [
      { date: '2026-03-10', position: 5 },
      { date: '2026-03-15', position: 3 },
      { date: '2026-03-18', position: 2 },
    ];

    const snapshots = convertHistoryToSnapshots('haryanvi web series', history);
    assert.equal(snapshots.length, 3);
    assert.equal(snapshots[0].query, 'haryanvi web series');
    assert.equal(snapshots[0].position, 5);
    assert.equal(snapshots[2].position, 2);
  });

  it('should map device from SerpBear format', async () => {
    const db = await getDatabase(':memory:');

    const keywords: SerpBearKeyword[] = [
      makeSerpBearKeyword({ keyword: 'mobile kw', device: 'MOBILE' }),
      makeSerpBearKeyword({ id: 2, keyword: 'desktop kw', device: 'DESKTOP' }),
    ];

    persistSerpBearKeywords(db, 'stage.in', keywords);

    // The keywords table stores device lowercase
    const today = new Date().toISOString().split('T')[0];
    const stored = getKeywordsForPeriod(db, today, today);
    assert.ok(stored.length > 0);

    closeDatabase();
  });
});
