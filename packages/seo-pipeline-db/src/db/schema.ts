import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

let db: Database | null = null;

export async function getDatabase(dbPath: string = 'seo_pipeline.db'): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs();

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  initSchema(db);
  return db;
}

function initSchema(db: Database): void {
  // Enable WAL mode for concurrent read performance
  db.run(`PRAGMA journal_mode=WAL`);

  // 1. keywords
  db.run(`
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      dialect TEXT,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      position REAL NOT NULL DEFAULT 0,
      date TEXT NOT NULL,
      device TEXT NOT NULL DEFAULT 'all',
      country TEXT NOT NULL DEFAULT 'ind',
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(query, date, device, country)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_kw_query ON keywords(query)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_kw_date ON keywords(date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_kw_clicks ON keywords(clicks DESC)`);

  // 2. audit_issues
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('critical', 'high', 'medium', 'low')),
      description TEXT NOT NULL,
      suggested_fix TEXT,
      fix_status TEXT NOT NULL CHECK(fix_status IN ('open', 'in_progress', 'fixed', 'wont_fix')) DEFAULT 'open',
      pr_url TEXT,
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      fixed_at TEXT,
      UNIQUE(url, issue_type)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ai_status ON audit_issues(fix_status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ai_severity ON audit_issues(severity)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ai_url ON audit_issues(url)`);

  // 3. trend_snapshots
  db.run(`
    CREATE TABLE IF NOT EXISTS trend_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('rising', 'declining', 'stable', 'new', 'lost')),
      current_clicks INTEGER NOT NULL DEFAULT 0,
      previous_clicks INTEGER NOT NULL DEFAULT 0,
      clicks_delta INTEGER NOT NULL DEFAULT 0,
      clicks_delta_pct REAL NOT NULL DEFAULT 0,
      current_position REAL NOT NULL DEFAULT 0,
      previous_position REAL NOT NULL DEFAULT 0,
      position_delta REAL NOT NULL DEFAULT 0,
      current_ctr REAL NOT NULL DEFAULT 0,
      previous_ctr REAL NOT NULL DEFAULT 0,
      snapshot_date TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(query, snapshot_date)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ts_direction ON trend_snapshots(direction)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ts_date ON trend_snapshots(snapshot_date)`);

  // 4. content_suggestions
  db.run(`
    CREATE TABLE IF NOT EXISTS content_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      suggestion_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('high', 'medium', 'low')) DEFAULT 'medium',
      status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected', 'applied')) DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_cs_url ON content_suggestions(url)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_cs_status ON content_suggestions(status)`);

  // 5. link_graph
  db.run(`
    CREATE TABLE IF NOT EXISTS link_graph (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL,
      target_url TEXT NOT NULL,
      anchor_text TEXT DEFAULT '',
      crawled_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_url, target_url)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_lg_source ON link_graph(source_url)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_lg_target ON link_graph(target_url)`);

  // 6. link_suggestions
  db.run(`
    CREATE TABLE IF NOT EXISTS link_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL,
      target_url TEXT NOT NULL,
      suggested_anchor_text TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      priority TEXT CHECK(priority IN ('high', 'medium', 'low')) DEFAULT 'medium',
      status TEXT CHECK(status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_url, target_url)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ls_status ON link_suggestions(status)`);

  // 7. geo_scores
  db.run(`
    CREATE TABLE IF NOT EXISTS geo_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      score_type TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      details TEXT,
      measured_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(url, score_type, measured_at)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_gs_url ON geo_scores(url)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_gs_type ON geo_scores(score_type)`);

  // 8. agent_runs
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      run_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failure')) DEFAULT 'running',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      items_processed INTEGER NOT NULL DEFAULT 0,
      items_failed INTEGER NOT NULL DEFAULT 0,
      summary TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ar_agent ON agent_runs(agent_name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ar_status ON agent_runs(status)`);
}

export function saveDatabase(db: Database, dbPath: string = 'seo_pipeline.db'): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(dbPath, buffer);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
