import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

let db: Database | null = null;

export async function getDatabase(dbPath: string = 'competitor_gaps.db'): Promise<Database> {
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
    CREATE TABLE IF NOT EXISTS content_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      dialect TEXT,
      suggested_content_type TEXT NOT NULL CHECK(suggested_content_type IN ('show', 'movie', 'micro_drama')),
      gap_source TEXT NOT NULL CHECK(gap_source IN ('serp_gap', 'keyword_gap', 'content_type_gap', 'dialect_gap', 'trending_gap')),
      competitor_urls TEXT DEFAULT '[]',
      competitor_domains TEXT DEFAULT '[]',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priority TEXT NOT NULL CHECK(priority IN ('critical', 'high', 'medium', 'low')) DEFAULT 'medium',
      status TEXT NOT NULL CHECK(status IN ('new', 'reviewed', 'accepted', 'rejected', 'implemented')) DEFAULT 'new',
      estimated_search_volume INTEGER,
      stage_current_position INTEGER,
      best_competitor_position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(keyword, dialect, gap_source)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_cs_keyword ON content_suggestions(keyword)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_cs_dialect ON content_suggestions(dialect)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_cs_priority ON content_suggestions(priority)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_cs_status ON content_suggestions(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_cs_gap_source ON content_suggestions(gap_source)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS serp_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      position INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      snippet TEXT DEFAULT '',
      domain TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(query, url)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_serp_query ON serp_snapshots(query)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_serp_domain ON serp_snapshots(domain)`);

  // Competitor position tracking over time (SEO-9)
  db.run(`
    CREATE TABLE IF NOT EXISTS competitor_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      domain TEXT NOT NULL,
      position INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT DEFAULT '',
      is_stage INTEGER NOT NULL DEFAULT 0,
      is_competitor INTEGER NOT NULL DEFAULT 0,
      tracked_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(keyword, domain, tracked_at)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_cp_keyword ON competitor_positions(keyword)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_cp_domain ON competitor_positions(domain)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_cp_tracked_at ON competitor_positions(tracked_at)`);

  // Brand mentions detected in SERP results (SEO-9)
  db.run(`
    CREATE TABLE IF NOT EXISTS brand_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      domain TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      snippet TEXT DEFAULT '',
      mention_type TEXT NOT NULL CHECK(mention_type IN ('direct', 'competitor_comparison', 'review', 'news', 'forum')),
      sentiment TEXT CHECK(sentiment IN ('positive', 'negative', 'neutral')) DEFAULT 'neutral',
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(query, url)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_bm_mention_type ON brand_mentions(mention_type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bm_domain ON brand_mentions(domain)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS gap_analysis_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at TEXT NOT NULL DEFAULT (datetime('now')),
      keywords_analyzed INTEGER NOT NULL DEFAULT 0,
      gaps_found INTEGER NOT NULL DEFAULT 0,
      suggestions_created INTEGER NOT NULL DEFAULT 0,
      dialects_covered TEXT DEFAULT '[]',
      competitors_covered TEXT DEFAULT '[]'
    )
  `);
}

export function saveDatabase(db: Database, dbPath: string = 'competitor_gaps.db'): void {
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
