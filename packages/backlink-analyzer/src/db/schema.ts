import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

let db: Database | null = null;

export async function getDatabase(dbPath: string = 'backlinks.db'): Promise<Database> {
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
    CREATE TABLE IF NOT EXISTS backlinks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_domain TEXT NOT NULL,
      target_url TEXT NOT NULL,
      source_domain TEXT NOT NULL,
      source_url TEXT NOT NULL,
      anchor_text TEXT DEFAULT '',
      crawl_date TEXT NOT NULL,
      link_type TEXT NOT NULL CHECK(link_type IN ('dofollow', 'nofollow', 'ugc', 'sponsored', 'unknown')) DEFAULT 'unknown',
      status TEXT NOT NULL CHECK(status IN ('active', 'lost', 'new', 'broken')) DEFAULT 'active',
      discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(target_url, source_url)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_bl_target ON backlinks(target_domain)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bl_source ON backlinks(source_domain)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bl_status ON backlinks(status)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS link_opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_domain TEXT NOT NULL,
      source_url TEXT NOT NULL,
      competitor_domain TEXT NOT NULL,
      competitor_url TEXT NOT NULL,
      anchor_text TEXT DEFAULT '',
      opportunity_type TEXT NOT NULL CHECK(opportunity_type IN ('competitor_link', 'broken_link', 'resource_page', 'guest_post', 'mention')),
      priority TEXT NOT NULL CHECK(priority IN ('high', 'medium', 'low')) DEFAULT 'medium',
      status TEXT NOT NULL CHECK(status IN ('new', 'outreached', 'acquired', 'rejected')) DEFAULT 'new',
      notes TEXT DEFAULT '',
      discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_url, competitor_url)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_lo_priority ON link_opportunities(priority)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_lo_type ON link_opportunities(opportunity_type)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS backlink_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at TEXT NOT NULL DEFAULT (datetime('now')),
      domains_analyzed INTEGER NOT NULL DEFAULT 0,
      total_backlinks_found INTEGER NOT NULL DEFAULT 0,
      new_backlinks INTEGER NOT NULL DEFAULT 0,
      lost_backlinks INTEGER NOT NULL DEFAULT 0,
      opportunities_found INTEGER NOT NULL DEFAULT 0
    )
  `);
}

export function saveDatabase(db: Database, dbPath: string = 'backlinks.db'): void {
  const data = db.export();
  writeFileSync(dbPath, Buffer.from(data));
}

export function closeDatabase(): void {
  if (db) { db.close(); db = null; }
}
