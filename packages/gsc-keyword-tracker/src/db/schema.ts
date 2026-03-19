import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

let db: Database | null = null;

export async function getDatabase(dbPath: string = 'gsc_keywords.db'): Promise<Database> {
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
  db.run(`CREATE INDEX IF NOT EXISTS idx_kw_dialect ON keywords(dialect)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_kw_date ON keywords(date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_kw_clicks ON keywords(clicks DESC)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS keyword_trends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      dialect TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('rising', 'declining', 'stable', 'new', 'lost')),
      current_clicks INTEGER NOT NULL DEFAULT 0,
      previous_clicks INTEGER NOT NULL DEFAULT 0,
      clicks_delta INTEGER NOT NULL DEFAULT 0,
      clicks_delta_pct REAL NOT NULL DEFAULT 0,
      current_impressions INTEGER NOT NULL DEFAULT 0,
      previous_impressions INTEGER NOT NULL DEFAULT 0,
      impressions_delta INTEGER NOT NULL DEFAULT 0,
      current_position REAL NOT NULL DEFAULT 0,
      previous_position REAL NOT NULL DEFAULT 0,
      position_delta REAL NOT NULL DEFAULT 0,
      current_ctr REAL NOT NULL DEFAULT 0,
      previous_ctr REAL NOT NULL DEFAULT 0,
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(query, computed_at)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_kt_direction ON keyword_trends(direction)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_kt_dialect ON keyword_trends(dialect)`);

  // Trend snapshots for long-term keyword trajectory (SEO-27)
  db.run(`
    CREATE TABLE IF NOT EXISTS trend_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      dialect TEXT,
      source TEXT NOT NULL CHECK(source IN ('gsc', 'google_trends', 'manual')),
      clicks INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      ctr REAL DEFAULT 0,
      position REAL DEFAULT 0,
      trend_index REAL DEFAULT 0,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(query, source, period_start, period_end)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_ts_query ON trend_snapshots(query)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ts_dialect ON trend_snapshots(dialect)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ts_source ON trend_snapshots(source)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ts_snapshot_at ON trend_snapshots(snapshot_at)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS tracker_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at TEXT NOT NULL DEFAULT (datetime('now')),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      previous_period_start TEXT NOT NULL,
      previous_period_end TEXT NOT NULL,
      total_keywords INTEGER NOT NULL DEFAULT 0,
      rising_keywords INTEGER NOT NULL DEFAULT 0,
      declining_keywords INTEGER NOT NULL DEFAULT 0,
      new_keywords INTEGER NOT NULL DEFAULT 0,
      lost_keywords INTEGER NOT NULL DEFAULT 0,
      dialects_covered TEXT DEFAULT '[]'
    )
  `);
}

export function saveDatabase(db: Database, dbPath: string = 'gsc_keywords.db'): void {
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
