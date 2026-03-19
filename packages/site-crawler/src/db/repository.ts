import type { Database } from 'sql.js';
import type { AuditIssue, CrawlRun, CrawledPage } from '../models/types.js';

export function createCrawlRun(db: Database, run: CrawlRun): void {
  db.run(
    `INSERT INTO crawl_runs (id, start_url, started_at, status) VALUES (?, ?, ?, ?)`,
    [run.id, run.startUrl, run.startedAt, run.status]
  );
}

export function updateCrawlRun(db: Database, id: string, updates: Partial<CrawlRun>): void {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt); }
  if (updates.pagesCrawled !== undefined) { fields.push('pages_crawled = ?'); values.push(updates.pagesCrawled); }
  if (updates.issuesFound !== undefined) { fields.push('issues_found = ?'); values.push(updates.issuesFound); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }

  if (fields.length === 0) return;
  values.push(id);
  db.run(`UPDATE crawl_runs SET ${fields.join(', ')} WHERE id = ?`, values);
}

export function insertAuditIssue(db: Database, issue: AuditIssue): void {
  db.run(
    `INSERT INTO audit_issues (url, category, severity, message, details, crawl_run_id, crawled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [issue.url, issue.category, issue.severity, issue.message, issue.details || null, issue.crawlRunId, issue.crawledAt]
  );
}

export function insertCrawledPage(db: Database, page: CrawledPage, crawlRunId: string): void {
  db.run(
    `INSERT OR REPLACE INTO crawled_pages (url, crawl_run_id, status_code, title, depth, load_time_ms, crawled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [page.url, crawlRunId, page.statusCode, page.title, page.depth, page.loadTimeMs, page.crawledAt]
  );
}

export function getAuditIssues(db: Database, crawlRunId: string): AuditIssue[] {
  const results = db.exec(
    'SELECT id, url, category, severity, message, details, crawl_run_id, crawled_at FROM audit_issues WHERE crawl_run_id = ? ORDER BY severity, category',
    [crawlRunId]
  );
  if (!results.length) return [];

  return results[0].values.map((row: any[]) => ({
    id: row[0] as number,
    url: row[1] as string,
    category: row[2] as AuditIssue['category'],
    severity: row[3] as AuditIssue['severity'],
    message: row[4] as string,
    details: row[5] as string | undefined,
    crawlRunId: row[6] as string,
    crawledAt: row[7] as string,
  }));
}

export function getCrawlRun(db: Database, id: string): CrawlRun | null {
  const results = db.exec(
    'SELECT id, start_url, started_at, completed_at, pages_crawled, issues_found, status FROM crawl_runs WHERE id = ?',
    [id]
  );
  if (!results.length || !results[0].values.length) return null;

  const row = results[0].values[0];
  return {
    id: row[0] as string,
    startUrl: row[1] as string,
    startedAt: row[2] as string,
    completedAt: (row[3] as string) || undefined,
    pagesCrawled: row[4] as number,
    issuesFound: row[5] as number,
    status: row[6] as CrawlRun['status'],
  };
}
