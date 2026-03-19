import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, closeDatabase } from '../db/schema.js';
import { getLatestPositions, comparePositions, getBrandMentions, getBrandMentionCounts } from '../db/repository.js';
import { trackPositions } from '../analyzers/serp-tracker.js';
import { detectBrandMentions } from '../analyzers/brand-monitor.js';
import type { SerpResult } from '../models/types.js';

function makeSerpResult(overrides: Partial<SerpResult> & { query: string; domain: string }): SerpResult {
  return {
    position: 1,
    url: `https://${overrides.domain}/content`,
    title: `Result from ${overrides.domain}`,
    snippet: 'Some snippet text',
    fetchedAt: '2026-03-18T00:00:00Z',
    ...overrides,
  };
}

describe('SERP Position Tracker', () => {
  it('should track positions for Stage and competitors', async () => {
    const db = await getDatabase(':memory:');

    const results: SerpResult[] = [
      makeSerpResult({ query: 'haryanvi web series', domain: 'stage.in', position: 2 }),
      makeSerpResult({ query: 'haryanvi web series', domain: 'mxplayer.in', position: 1 }),
      makeSerpResult({ query: 'haryanvi web series', domain: 'zee5.com', position: 3 }),
      makeSerpResult({ query: 'haryanvi web series', domain: 'youtube.com', position: 4 }), // Not tracked
    ];

    const tracked = trackPositions(db, 'haryanvi web series', results, '2026-03-18');
    assert.equal(tracked, 3); // Stage + 2 competitors, YouTube skipped

    const positions = getLatestPositions(db, 'haryanvi web series');
    assert.equal(positions.length, 3);
    assert.equal(positions[0].domain, 'mxplayer.in'); // Position 1
    assert.equal(positions[0].isCompetitor, true);
    assert.equal(positions[1].domain, 'stage.in'); // Position 2
    assert.equal(positions[1].isStage, true);

    closeDatabase();
  });

  it('should compare positions between two dates', async () => {
    const db = await getDatabase(':memory:');

    // Previous: Stage at #5, MX Player at #1
    const prevResults: SerpResult[] = [
      makeSerpResult({ query: 'rajasthani movies', domain: 'stage.in', position: 5, fetchedAt: '2026-03-10T00:00:00Z' }),
      makeSerpResult({ query: 'rajasthani movies', domain: 'mxplayer.in', position: 1, fetchedAt: '2026-03-10T00:00:00Z' }),
    ];
    trackPositions(db, 'rajasthani movies', prevResults, '2026-03-10');

    // Current: Stage improved to #2, MX Player dropped to #3
    const currResults: SerpResult[] = [
      makeSerpResult({ query: 'rajasthani movies', domain: 'stage.in', position: 2, fetchedAt: '2026-03-18T00:00:00Z' }),
      makeSerpResult({ query: 'rajasthani movies', domain: 'mxplayer.in', position: 3, fetchedAt: '2026-03-18T00:00:00Z' }),
    ];
    trackPositions(db, 'rajasthani movies', currResults, '2026-03-18');

    const changes = comparePositions(db, 'rajasthani movies', '2026-03-18', '2026-03-10');
    assert.equal(changes.length, 2);

    const stageChange = changes.find((c) => c.domain === 'stage.in');
    assert.ok(stageChange);
    assert.equal(stageChange.direction, 'improved');
    assert.equal(stageChange.delta, 3); // 5 -> 2

    const mxChange = changes.find((c) => c.domain === 'mxplayer.in');
    assert.ok(mxChange);
    assert.equal(mxChange.direction, 'dropped');
    assert.equal(mxChange.delta, -2); // 1 -> 3

    closeDatabase();
  });

  it('should detect new entries and lost positions', async () => {
    const db = await getDatabase(':memory:');

    // Previous: only MX Player
    trackPositions(db, 'bhojpuri shows', [
      makeSerpResult({ query: 'bhojpuri shows', domain: 'mxplayer.in', position: 1 }),
    ], '2026-03-10');

    // Current: MX Player gone, Stage appears
    trackPositions(db, 'bhojpuri shows', [
      makeSerpResult({ query: 'bhojpuri shows', domain: 'stage.in', position: 3 }),
    ], '2026-03-18');

    const changes = comparePositions(db, 'bhojpuri shows', '2026-03-18', '2026-03-10');
    const stageChange = changes.find((c) => c.domain === 'stage.in');
    assert.ok(stageChange);
    assert.equal(stageChange.direction, 'new_entry');

    const mxChange = changes.find((c) => c.domain === 'mxplayer.in');
    assert.ok(mxChange);
    assert.equal(mxChange.direction, 'lost');

    closeDatabase();
  });
});

describe('Brand Monitor', () => {
  it('should detect Stage brand mentions in SERP results', async () => {
    const db = await getDatabase(':memory:');

    const results: SerpResult[] = [
      makeSerpResult({
        query: 'stage app review',
        domain: 'ottplay.com',
        title: 'Stage App Review: Best Regional OTT',
        snippet: 'Stage is the best app for haryanvi web series. Must watch content.',
        fetchedAt: '2026-03-18T00:00:00Z',
      }),
      makeSerpResult({
        query: 'stage app review',
        domain: 'reddit.com',
        position: 2,
        title: 'Has anyone tried Stage OTT?',
        snippet: 'Stage app has some great regional content but UI could be better.',
        fetchedAt: '2026-03-18T00:00:00Z',
      }),
      makeSerpResult({
        query: 'stage app review',
        domain: 'random.com',
        position: 3,
        title: 'Top 10 Movies 2026',
        snippet: 'No mention of the brand here at all.',
        fetchedAt: '2026-03-18T00:00:00Z',
      }),
    ];

    const found = detectBrandMentions(db, 'stage app review', results);
    assert.equal(found, 2); // ottplay and reddit, not random.com

    const mentions = getBrandMentions(db);
    assert.equal(mentions.length, 2);

    // Check ottplay classified as review
    const reviewMention = mentions.find((m) => m.domain === 'ottplay.com');
    assert.ok(reviewMention);
    assert.equal(reviewMention.mentionType, 'review');
    assert.equal(reviewMention.sentiment, 'positive'); // "best", "must watch"

    // Check reddit classified as forum
    const forumMention = mentions.find((m) => m.domain === 'reddit.com');
    assert.ok(forumMention);
    assert.equal(forumMention.mentionType, 'forum');

    closeDatabase();
  });

  it('should detect competitor comparison mentions', async () => {
    const db = await getDatabase(':memory:');

    const results: SerpResult[] = [
      makeSerpResult({
        query: 'stage vs mx player',
        domain: 'techradar.com',
        title: 'Stage vs MX Player: Which is better for regional content?',
        snippet: 'We compare Stage vs MX Player for haryanvi and bhojpuri content.',
        fetchedAt: '2026-03-18T00:00:00Z',
      }),
    ];

    detectBrandMentions(db, 'stage vs mx player', results);
    const mentions = getBrandMentions(db);
    assert.equal(mentions[0].mentionType, 'competitor_comparison');

    closeDatabase();
  });

  it('should count brand mentions by type', async () => {
    const db = await getDatabase(':memory:');

    detectBrandMentions(db, 'q1', [
      makeSerpResult({ query: 'q1', domain: 'ottplay.com', title: 'Stage review', snippet: 'Stage app review', fetchedAt: '2026-03-18T00:00:00Z' }),
    ]);
    detectBrandMentions(db, 'q2', [
      makeSerpResult({ query: 'q2', domain: 'reddit.com', title: 'Stage discussion', snippet: 'Has anyone tried Stage?', fetchedAt: '2026-03-18T00:00:00Z' }),
    ]);

    const counts = getBrandMentionCounts(db);
    assert.ok(Object.keys(counts).length > 0);

    closeDatabase();
  });
});
