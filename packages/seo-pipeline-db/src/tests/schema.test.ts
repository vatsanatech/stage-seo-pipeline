import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, closeDatabase } from '../db/schema.js';

describe('seo-pipeline-db schema', () => {
  it('should create all 8 tables', async () => {
    const db = await getDatabase(':memory:');

    const result = db.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    );

    const tables = result[0].values.map((r) => r[0] as string);

    assert.deepStrictEqual(tables, [
      'agent_runs',
      'audit_issues',
      'content_suggestions',
      'geo_scores',
      'keywords',
      'link_graph',
      'link_suggestions',
      'trend_snapshots',
    ]);

    closeDatabase();
  });

  it('should insert and query audit issues', async () => {
    const db = await getDatabase(':memory:');

    db.run(
      `INSERT INTO audit_issues (url, issue_type, severity, description) VALUES (?, ?, ?, ?)`,
      ['/blog/test', 'missing_h1', 'high', 'Page is missing H1 tag']
    );

    const rows = db.exec(`SELECT * FROM audit_issues WHERE fix_status = 'open'`);
    assert.equal(rows[0].values.length, 1);
    assert.equal(rows[0].values[0][1], '/blog/test');

    closeDatabase();
  });

  it('should insert and query agent runs', async () => {
    const db = await getDatabase(':memory:');

    db.run(
      `INSERT INTO agent_runs (agent_name, run_type, status) VALUES (?, ?, ?)`,
      ['autofix', 'daily_fix', 'running']
    );

    const rows = db.exec(`SELECT * FROM agent_runs WHERE status = 'running'`);
    assert.equal(rows[0].values.length, 1);
    assert.equal(rows[0].values[0][1], 'autofix');

    closeDatabase();
  });

  it('should enforce unique constraints', async () => {
    const db = await getDatabase(':memory:');

    db.run(
      `INSERT INTO link_graph (source_url, target_url) VALUES (?, ?)`,
      ['/page-a', '/page-b']
    );

    // Second insert with same source+target should be ignored with OR IGNORE
    db.run(
      `INSERT OR IGNORE INTO link_graph (source_url, target_url) VALUES (?, ?)`,
      ['/page-a', '/page-b']
    );

    const rows = db.exec(`SELECT COUNT(*) FROM link_graph`);
    assert.equal(rows[0].values[0][0], 1);

    closeDatabase();
  });
});
