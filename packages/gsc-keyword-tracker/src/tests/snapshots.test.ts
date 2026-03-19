import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, closeDatabase } from '../db/schema.js';
import { getTrendSnapshots, getKeywordTrajectory, getTopTrajectories, getSnapshotCount } from '../db/repository.js';
import { generateGscSnapshots, generateGoogleTrendsSnapshots } from '../analyzers/snapshot-generator.js';
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

describe('Trend Snapshots', () => {
  it('should generate and persist GSC snapshots', async () => {
    const db = await getDatabase(':memory:');

    const keywords: KeywordRecord[] = [
      makeKeyword({ query: 'haryanvi web series', dialect: 'haryanvi', clicks: 450, impressions: 12000, ctr: 0.0375, position: 3.2 }),
      makeKeyword({ query: 'rajasthani movies', dialect: 'rajasthani', clicks: 280, impressions: 8500, ctr: 0.033, position: 4.1 }),
    ];

    const created = generateGscSnapshots(db, keywords, '2026-03-01', '2026-03-15');
    assert.equal(created, 2);

    const count = getSnapshotCount(db);
    assert.equal(count, 2);

    const snapshots = getTrendSnapshots(db, 'haryanvi web series');
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].source, 'gsc');
    assert.equal(snapshots[0].clicks, 450);
    assert.ok(snapshots[0].trendIndex > 0);

    closeDatabase();
  });

  it('should generate Google Trends snapshots', async () => {
    const db = await getDatabase(':memory:');

    const trendsData = [
      { query: 'haryanvi web series', interest: 75 },
      { query: 'bhojpuri comedy', interest: 42 },
    ];

    const created = generateGoogleTrendsSnapshots(db, trendsData, '2026-03-01', '2026-03-15');
    assert.equal(created, 2);

    const snapshots = getTrendSnapshots(db, 'haryanvi web series', 'google_trends');
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].trendIndex, 75);

    closeDatabase();
  });

  it('should compute keyword trajectory from multiple snapshots', async () => {
    const db = await getDatabase(':memory:');

    // Simulate 3 periods of data (rising trajectory)
    const periods = [
      { start: '2026-02-01', end: '2026-02-14', clicks: 100 },
      { start: '2026-02-15', end: '2026-02-28', clicks: 200 },
      { start: '2026-03-01', end: '2026-03-14', clicks: 350 },
    ];

    for (const p of periods) {
      generateGscSnapshots(db, [
        makeKeyword({ query: 'haryanvi web series', dialect: 'haryanvi', clicks: p.clicks, impressions: p.clicks * 20 }),
      ], p.start, p.end);
    }

    const trajectory = getKeywordTrajectory(db, 'haryanvi web series');
    assert.ok(trajectory);
    assert.equal(trajectory.query, 'haryanvi web series');
    assert.equal(trajectory.snapshots.length, 3);
    assert.equal(trajectory.overallDirection, 'rising');
    assert.ok(trajectory.velocityPct > 0);

    closeDatabase();
  });

  it('should detect declining trajectory', async () => {
    const db = await getDatabase(':memory:');

    const periods = [
      { start: '2026-02-01', end: '2026-02-14', clicks: 500 },
      { start: '2026-02-15', end: '2026-02-28', clicks: 300 },
      { start: '2026-03-01', end: '2026-03-14', clicks: 100 },
    ];

    for (const p of periods) {
      generateGscSnapshots(db, [
        makeKeyword({ query: 'declining keyword', clicks: p.clicks }),
      ], p.start, p.end);
    }

    const trajectory = getKeywordTrajectory(db, 'declining keyword');
    assert.ok(trajectory);
    assert.equal(trajectory.overallDirection, 'declining');
    assert.ok(trajectory.velocityPct < 0);

    closeDatabase();
  });

  it('should get top trajectories by direction', async () => {
    const db = await getDatabase(':memory:');

    // Rising keyword
    generateGscSnapshots(db, [makeKeyword({ query: 'rising kw', clicks: 100 })], '2026-02-01', '2026-02-14');
    generateGscSnapshots(db, [makeKeyword({ query: 'rising kw', clicks: 500 })], '2026-03-01', '2026-03-14');

    // Declining keyword
    generateGscSnapshots(db, [makeKeyword({ query: 'declining kw', clicks: 500 })], '2026-02-01', '2026-02-14');
    generateGscSnapshots(db, [makeKeyword({ query: 'declining kw', clicks: 100 })], '2026-03-01', '2026-03-14');

    const rising = getTopTrajectories(db, 'rising');
    assert.equal(rising.length, 1);
    assert.equal(rising[0].query, 'rising kw');

    const declining = getTopTrajectories(db, 'declining');
    assert.equal(declining.length, 1);
    assert.equal(declining[0].query, 'declining kw');

    closeDatabase();
  });

  it('should upsert snapshots for same period', async () => {
    const db = await getDatabase(':memory:');

    // First snapshot
    generateGscSnapshots(db, [makeKeyword({ query: 'test kw', clicks: 100 })], '2026-03-01', '2026-03-14');
    // Updated snapshot for same period
    generateGscSnapshots(db, [makeKeyword({ query: 'test kw', clicks: 200 })], '2026-03-01', '2026-03-14');

    const snapshots = getTrendSnapshots(db, 'test kw');
    assert.equal(snapshots.length, 1); // Upserted, not duplicated
    assert.equal(snapshots[0].clicks, 200); // Updated value

    closeDatabase();
  });
});
