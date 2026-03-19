import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, closeDatabase } from '../db/schema.js';
import { upsertKeyword, getKeywordsForPeriod, upsertKeywordTrend, getTrends, getTrendCounts } from '../db/repository.js';
import { analyzeTrends, summarizeTrends } from '../analyzers/trend-analyzer.js';
import { detectDialect, getDialectDistribution } from '../analyzers/dialect-detector.js';
import type { KeywordRecord } from '../models/types.js';

function makeKeyword(overrides: Partial<KeywordRecord> & { query: string }): KeywordRecord {
  return {
    dialect: null,
    clicks: 100,
    impressions: 1000,
    ctr: 0.1,
    position: 5,
    date: '2026-03-15',
    device: 'all',
    country: 'ind',
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Dialect Detector', () => {
  it('should detect haryanvi from keyword', () => {
    assert.equal(detectDialect('haryanvi web series'), 'haryanvi');
    assert.equal(detectDialect('sapna choudhary new show'), 'haryanvi');
    assert.equal(detectDialect('jaat ki comedy'), 'haryanvi');
  });

  it('should detect rajasthani from keyword', () => {
    assert.equal(detectDialect('rajasthani movies online'), 'rajasthani');
    assert.equal(detectDialect('marwari comedy'), 'rajasthani');
  });

  it('should detect bhojpuri from keyword', () => {
    assert.equal(detectDialect('bhojpuri comedy shows'), 'bhojpuri');
    assert.equal(detectDialect('pawan singh new movie'), 'bhojpuri');
  });

  it('should detect gujarati from keyword', () => {
    assert.equal(detectDialect('gujarati drama series'), 'gujarati');
    assert.equal(detectDialect('garba song new'), 'gujarati');
  });

  it('should return null for non-dialect keywords', () => {
    assert.equal(detectDialect('best ott app india'), null);
    assert.equal(detectDialect('web series download'), null);
  });

  it('should get dialect distribution', () => {
    const dist = getDialectDistribution([
      'haryanvi web series',
      'rajasthani movies',
      'bhojpuri comedy',
      'gujarati shows',
      'best ott app',
    ]);
    assert.equal(dist.haryanvi, 1);
    assert.equal(dist.rajasthani, 1);
    assert.equal(dist.bhojpuri, 1);
    assert.equal(dist.gujarati, 1);
    assert.equal(dist.unclassified, 1);
  });
});

describe('Trend Analyzer', () => {
  it('should identify rising keywords', () => {
    const current = [makeKeyword({ query: 'haryanvi web series', clicks: 500 })];
    const previous = [makeKeyword({ query: 'haryanvi web series', clicks: 200, date: '2026-03-01' })];

    const trends = analyzeTrends(current, previous);
    assert.equal(trends.length, 1);
    assert.equal(trends[0].direction, 'rising');
    assert.equal(trends[0].clicksDelta, 300);
    assert.equal(trends[0].dialect, 'haryanvi');
  });

  it('should identify declining keywords', () => {
    const current = [makeKeyword({ query: 'rajasthani movies', clicks: 50 })];
    const previous = [makeKeyword({ query: 'rajasthani movies', clicks: 200, date: '2026-03-01' })];

    const trends = analyzeTrends(current, previous);
    assert.equal(trends[0].direction, 'declining');
    assert.equal(trends[0].clicksDelta, -150);
  });

  it('should identify new keywords', () => {
    const current = [makeKeyword({ query: 'bhojpuri horror series', clicks: 100 })];
    const previous: KeywordRecord[] = [];

    const trends = analyzeTrends(current, previous);
    assert.equal(trends[0].direction, 'new');
  });

  it('should identify lost keywords', () => {
    const current: KeywordRecord[] = [];
    const previous = [makeKeyword({ query: 'gujarati old movies', clicks: 80, date: '2026-03-01' })];

    const trends = analyzeTrends(current, previous);
    assert.equal(trends[0].direction, 'lost');
    assert.equal(trends[0].clicksDelta, -80);
  });

  it('should identify stable keywords', () => {
    const current = [makeKeyword({ query: 'stage app', clicks: 100 })];
    const previous = [makeKeyword({ query: 'stage app', clicks: 105, date: '2026-03-01' })];

    const trends = analyzeTrends(current, previous);
    assert.equal(trends[0].direction, 'stable');
  });

  it('should summarize trends correctly', () => {
    const current = [
      makeKeyword({ query: 'rising keyword', clicks: 500 }),
      makeKeyword({ query: 'declining keyword', clicks: 50 }),
      makeKeyword({ query: 'new keyword', clicks: 100 }),
      makeKeyword({ query: 'stable keyword', clicks: 100 }),
    ];
    const previous = [
      makeKeyword({ query: 'rising keyword', clicks: 200, date: '2026-03-01' }),
      makeKeyword({ query: 'declining keyword', clicks: 200, date: '2026-03-01' }),
      makeKeyword({ query: 'stable keyword', clicks: 105, date: '2026-03-01' }),
      makeKeyword({ query: 'lost keyword', clicks: 80, date: '2026-03-01' }),
    ];

    const trends = analyzeTrends(current, previous);
    const summary = summarizeTrends(trends);

    assert.equal(summary.total, 5);
    assert.equal(summary.rising, 1);
    assert.equal(summary.declining, 1);
    assert.equal(summary.new_, 1);
    assert.equal(summary.lost, 1);
    assert.equal(summary.stable, 1);
  });
});

describe('Database Operations', () => {
  it('should persist and retrieve keywords', async () => {
    const db = await getDatabase(':memory:');

    upsertKeyword(db, makeKeyword({ query: 'haryanvi web series', clicks: 450, date: '2026-03-15' }));
    upsertKeyword(db, makeKeyword({ query: 'rajasthani movies', clicks: 280, date: '2026-03-15' }));

    const keywords = getKeywordsForPeriod(db, '2026-03-10', '2026-03-20');
    assert.equal(keywords.length, 2);
    assert.equal(keywords[0].clicks, 450); // Sorted by clicks DESC

    closeDatabase();
  });

  it('should persist and retrieve trends', async () => {
    const db = await getDatabase(':memory:');

    upsertKeywordTrend(db, {
      query: 'haryanvi web series',
      dialect: 'haryanvi',
      direction: 'rising',
      currentClicks: 450,
      previousClicks: 320,
      clicksDelta: 130,
      clicksDeltaPct: 40.63,
      currentImpressions: 12000,
      previousImpressions: 10000,
      impressionsDelta: 2000,
      currentPosition: 3.2,
      previousPosition: 4.1,
      positionDelta: 0.9,
      currentCtr: 0.0375,
      previousCtr: 0.032,
    });

    const trends = getTrends(db, { direction: 'rising' });
    assert.equal(trends.length, 1);
    assert.equal(trends[0].dialect, 'haryanvi');
    assert.equal(trends[0].clicksDelta, 130);

    const counts = getTrendCounts(db);
    assert.equal(counts.rising, 1);

    closeDatabase();
  });
});
