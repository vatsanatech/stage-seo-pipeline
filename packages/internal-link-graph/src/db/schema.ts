import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

let db: Database | null = null;

export async function getDatabase(dbPath: string = 'link_graph.db'): Promise<Database> {
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
    CREATE TABLE IF NOT EXISTS link_graph (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL,
      target_url TEXT NOT NULL,
      anchor_text TEXT DEFAULT '',
      crawled_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_url, target_url)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_link_graph_source ON link_graph(source_url)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_link_graph_target ON link_graph(target_url)
  `);

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

  db.run(`
    CREATE TABLE IF NOT EXISTS page_scores (
      url TEXT PRIMARY KEY,
      pagerank REAL DEFAULT 0,
      authority_score REAL DEFAULT 0,
      hub_score REAL DEFAULT 0,
      inbound_links INTEGER DEFAULT 0,
      outbound_links INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export function saveDatabase(db: Database, dbPath: string = 'link_graph.db'): void {
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
