import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, saveDatabase, closeDatabase } from '../db/schema.js';
import { getContentSuggestions, getSuggestionCount, getSuggestionsByPriority } from '../db/repository.js';
import { analyzeKeywordGap, processGapIntoSuggestions, persistSerpSnapshot } from '../analyzers/gap-detector.js';
import type { SerpResult } from '../models/types.js';

function makeSerpResult(overrides: Partial<SerpResult> & { query: string; domain: string }): SerpResult {
  return {
    position: 1,
    url: `https://${overrides.domain}/content`,
    title: `Result from ${overrides.domain}`,
    snippet: 'Some snippet text',
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Gap Detector', () => {
  it('should detect a gap when competitors rank but Stage does not', async () => {
    const db = await getDatabase(':memory:');

    const results: SerpResult[] = [
      makeSerpResult({ query: 'haryanvi web series', domain: 'mxplayer.in', position: 1 }),
      makeSerpResult({ query: 'haryanvi web series', domain: 'zee5.com', position: 3 }),
      makeSerpResult({ query: 'haryanvi web series', domain: 'youtube.com', position: 2 }),
    ];

    const presence = analyzeKeywordGap('haryanvi web series', results);

    assert.equal(presence.stagePresent, false);
    assert.equal(presence.keyword, 'haryanvi web series');
    assert.equal(presence.dialect, 'haryanvi');
    assert.equal(presence.competitorResults.length, 2); // mxplayer + zee5
    assert.equal(presence.stagePosition, null);

    const created = processGapIntoSuggestions(db, presence);
    assert.equal(created, 1);

    const suggestions = getContentSuggestions(db);
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].keyword, 'haryanvi web series');
    assert.equal(suggestions[0].dialect, 'haryanvi');
    assert.equal(suggestions[0].suggestedContentType, 'show');
    assert.equal(suggestions[0].priority, 'critical'); // 2 competitors in top 3

    closeDatabase();
  });

  it('should NOT create a gap when Stage ranks in top 5', async () => {
    const db = await getDatabase(':memory:');

    const results: SerpResult[] = [
      makeSerpResult({ query: 'rajasthani movies', domain: 'mxplayer.in', position: 1 }),
      makeSerpResult({ query: 'rajasthani movies', domain: 'stage.in', position: 3 }),
    ];

    const presence = analyzeKeywordGap('rajasthani movies', results);
    assert.equal(presence.stagePresent, true);
    assert.equal(presence.stagePosition, 3);

    const created = processGapIntoSuggestions(db, presence);
    assert.equal(created, 0); // No gap — Stage is in top 5

    closeDatabase();
  });

  it('should create suggestion when Stage ranks poorly', async () => {
    const db = await getDatabase(':memory:');

    const results: SerpResult[] = [
      makeSerpResult({ query: 'bhojpuri comedy shows', domain: 'jiocinema.com', position: 2 }),
      makeSerpResult({ query: 'bhojpuri comedy shows', domain: 'sonyliv.com', position: 4 }),
      makeSerpResult({ query: 'bhojpuri comedy shows', domain: 'stage.in', position: 15 }),
    ];

    const presence = analyzeKeywordGap('bhojpuri comedy shows', results);
    assert.equal(presence.stagePresent, true);
    assert.equal(presence.stagePosition, 15);
    assert.equal(presence.competitorResults.length, 2);

    const created = processGapIntoSuggestions(db, presence);
    assert.equal(created, 1);

    const suggestions = getContentSuggestions(db);
    assert.equal(suggestions[0].priority, 'high'); // Stage outranked badly

    closeDatabase();
  });

  it('should persist SERP snapshots', async () => {
    const db = await getDatabase(':memory:');

    const results: SerpResult[] = [
      makeSerpResult({ query: 'gujarati web series', domain: 'hotstar.com', position: 1 }),
      makeSerpResult({ query: 'gujarati web series', domain: 'zee5.com', position: 2 }),
    ];

    persistSerpSnapshot(db, results);

    const stmt = db.prepare('SELECT COUNT(*) as count FROM serp_snapshots');
    stmt.step();
    const row = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();

    assert.equal(row.count, 2);

    closeDatabase();
  });

  it('should aggregate suggestions by priority', async () => {
    const db = await getDatabase(':memory:');

    // Create multiple gaps
    const keywords = ['haryanvi action movies', 'rajasthani drama', 'bhojpuri horror'];
    for (const kw of keywords) {
      const results: SerpResult[] = [
        makeSerpResult({ query: kw, domain: 'mxplayer.in', position: 1 }),
        makeSerpResult({ query: kw, domain: 'zee5.com', position: 2 }),
      ];
      const presence = analyzeKeywordGap(kw, results);
      processGapIntoSuggestions(db, presence);
    }

    const count = getSuggestionCount(db);
    assert.equal(count, 3);

    const byPriority = getSuggestionsByPriority(db);
    assert.ok(Object.keys(byPriority).length > 0);

    closeDatabase();
  });

  it('should infer movie content type from keyword', async () => {
    const db = await getDatabase(':memory:');

    const results: SerpResult[] = [
      makeSerpResult({ query: 'gujarati movies online free', domain: 'jiocinema.com', position: 1 }),
    ];

    const presence = analyzeKeywordGap('gujarati movies online free', results);
    processGapIntoSuggestions(db, presence);

    const suggestions = getContentSuggestions(db);
    assert.equal(suggestions[0].suggestedContentType, 'movie');

    closeDatabase();
  });
});
