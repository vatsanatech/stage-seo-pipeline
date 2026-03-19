import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, closeDatabase } from '../db/schema.js';
import { getTrendSnapshots } from '../db/repository.js';
import { correlateTrendsWithGsc, persistTrendsData, generateRegionalSuggestions } from '../trends/trends-correlator.js';
import type { KeywordTrend } from '../models/types.js';

function makeTrend(overrides: Partial<KeywordTrend> & { query: string }): KeywordTrend {
  return {
    dialect: null,
    direction: 'stable',
    currentClicks: 100,
    previousClicks: 100,
    clicksDelta: 0,
    clicksDeltaPct: 0,
    currentImpressions: 1000,
    previousImpressions: 1000,
    impressionsDelta: 0,
    currentPosition: 5,
    previousPosition: 5,
    positionDelta: 0,
    currentCtr: 0.1,
    previousCtr: 0.1,
    ...overrides,
  };
}

describe('Trends Correlator', () => {
  it('should identify divergent opportunities (high trends, low GSC)', () => {
    const gscTrends = [
      makeTrend({ query: 'haryanvi web series', currentClicks: 10, currentPosition: 15 }),
    ];
    const trendsData = new Map([['haryanvi web series', 75]]);

    const correlations = correlateTrendsWithGsc(getDatabase as any, gscTrends, trendsData);
    assert.equal(correlations.length, 1);
    assert.equal(correlations[0].correlationType, 'divergent_opportunity');
    assert.ok(correlations[0].insight.includes('high interest'));
    assert.equal(correlations[0].trendsInterest, 75);
  });

  it('should identify declining alignment (low trends, declining GSC)', () => {
    const gscTrends = [
      makeTrend({ query: 'old topic', direction: 'declining', currentClicks: 20, currentPosition: 12 }),
    ];
    const trendsData = new Map([['old topic', 15]]);

    const correlations = correlateTrendsWithGsc(getDatabase as any, gscTrends, trendsData);
    assert.equal(correlations[0].correlationType, 'divergent_declining');
    assert.ok(correlations[0].insight.includes('decline'));
  });

  it('should mark aligned data when GSC and Trends agree', () => {
    const gscTrends = [
      makeTrend({ query: 'popular keyword', currentClicks: 500, currentPosition: 2 }),
    ];
    const trendsData = new Map([['popular keyword', 80]]);

    const correlations = correlateTrendsWithGsc(getDatabase as any, gscTrends, trendsData);
    assert.equal(correlations[0].correlationType, 'aligned');
  });

  it('should sort opportunities first', () => {
    const gscTrends = [
      makeTrend({ query: 'aligned kw', currentClicks: 500, currentPosition: 2 }),
      makeTrend({ query: 'opportunity kw', currentClicks: 5, currentPosition: 20 }),
    ];
    const trendsData = new Map([
      ['aligned kw', 80],
      ['opportunity kw', 70],
    ]);

    const correlations = correlateTrendsWithGsc(getDatabase as any, gscTrends, trendsData);
    assert.equal(correlations[0].correlationType, 'divergent_opportunity');
    assert.equal(correlations[0].keyword, 'opportunity kw');
  });

  it('should skip keywords not in trends data', () => {
    const gscTrends = [
      makeTrend({ query: 'missing kw' }),
    ];
    const trendsData = new Map<string, number>();

    const correlations = correlateTrendsWithGsc(getDatabase as any, gscTrends, trendsData);
    assert.equal(correlations.length, 0);
  });
});

describe('Trends Data Persistence', () => {
  it('should persist trends data as Google Trends snapshots', async () => {
    const db = await getDatabase(':memory:');

    const trendsData = new Map([
      ['haryanvi web series', 75],
      ['rajasthani movies', 42],
      ['bhojpuri comedy', 60],
    ]);

    const count = persistTrendsData(db, trendsData, '2026-03-01', '2026-03-18');
    assert.equal(count, 3);

    const snapshots = getTrendSnapshots(db, 'haryanvi web series', 'google_trends');
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].trendIndex, 75);
    assert.equal(snapshots[0].source, 'google_trends');

    closeDatabase();
  });
});

describe('Regional Suggestions', () => {
  it('should generate suggestions for high-interest keywords', () => {
    const trendsData = new Map([
      ['haryanvi action movie', 72],
      ['rajasthani comedy', 55],
      ['low interest kw', 20],
    ]);

    const suggestions = generateRegionalSuggestions(trendsData, 'haryanvi');
    assert.equal(suggestions.length, 2); // Only >= 50 interest
    assert.equal(suggestions[0].keyword, 'haryanvi action movie'); // Sorted by interest desc
    assert.ok(suggestions[0].suggestion.includes('72/100'));
  });

  it('should return empty for low-interest data', () => {
    const trendsData = new Map([
      ['low kw 1', 10],
      ['low kw 2', 30],
    ]);

    const suggestions = generateRegionalSuggestions(trendsData, 'gujarati');
    assert.equal(suggestions.length, 0);
  });
});
