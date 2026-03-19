import initSqlJs, { type Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

let db: Database | null = null;

export async function getDatabase(dbPath: string = 'seo_audit.db'): Promise<Database> {
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
    CREATE TABLE IF NOT EXISTS crawl_runs (
      id TEXT PRIMARY KEY,
      start_url TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      pages_crawled INTEGER DEFAULT 0,
      issues_found INTEGER DEFAULT 0,
      status TEXT CHECK(status IN ('running', 'completed', 'failed')) DEFAULT 'running'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT CHECK(severity IN ('critical', 'warning', 'info')) NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      crawl_run_id TEXT NOT NULL REFERENCES crawl_runs(id),
      crawled_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_audit_issues_url ON audit_issues(url)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_audit_issues_category ON audit_issues(category)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_audit_issues_severity ON audit_issues(severity)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_audit_issues_run ON audit_issues(crawl_run_id)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS crawled_pages (
      url TEXT NOT NULL,
      crawl_run_id TEXT NOT NULL REFERENCES crawl_runs(id),
      status_code INTEGER,
      title TEXT,
      depth INTEGER,
      load_time_ms INTEGER,
      crawled_at TEXT NOT NULL,
      PRIMARY KEY (url, crawl_run_id)
    )
  `);
}

export function saveDatabase(db: Database, dbPath: string = 'seo_audit.db'): void {
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
