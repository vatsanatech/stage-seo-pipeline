import { type Database } from 'sql.js';
import type {
  AuditIssue,
  AgentRun,
  ContentSuggestion,
  GeoScore,
  LinkSuggestion,
} from '../models/types.js';

// --- Audit Issues ---

export function getOpenAuditIssues(db: Database): AuditIssue[] {
  const results = db.exec(
    `SELECT * FROM audit_issues WHERE fix_status = 'open' ORDER BY severity, detected_at DESC`
  );
  return resultsToObjects<AuditIssue>(results);
}

export function insertAuditIssue(
  db: Database,
  issue: Omit<AuditIssue, 'id' | 'detected_at' | 'fixed_at'>
): void {
  db.run(
    `INSERT OR IGNORE INTO audit_issues (url, issue_type, severity, description, suggested_fix, fix_status, pr_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [issue.url, issue.issue_type, issue.severity, issue.description, issue.suggested_fix ?? null, issue.fix_status, issue.pr_url ?? null]
  );
}

export function updateAuditIssueStatus(
  db: Database,
  id: number,
  status: AuditIssue['fix_status'],
  prUrl?: string
): void {
  const fixedAt = status === 'fixed' ? "datetime('now')" : 'NULL';
  db.run(
    `UPDATE audit_issues SET fix_status = ?, pr_url = COALESCE(?, pr_url), fixed_at = ${fixedAt} WHERE id = ?`,
    [status, prUrl ?? null, id]
  );
}

// --- Agent Runs ---

export function startAgentRun(db: Database, agentName: string, runType: string): number {
  db.run(
    `INSERT INTO agent_runs (agent_name, run_type, status) VALUES (?, ?, 'running')`,
    [agentName, runType]
  );
  const result = db.exec(`SELECT last_insert_rowid() as id`);
  return result[0].values[0][0] as number;
}

export function finishAgentRun(
  db: Database,
  runId: number,
  status: 'success' | 'failure',
  itemsProcessed: number,
  itemsFailed: number,
  summary?: string
): void {
  db.run(
    `UPDATE agent_runs SET status = ?, finished_at = datetime('now'), items_processed = ?, items_failed = ?, summary = ? WHERE id = ?`,
    [status, itemsProcessed, itemsFailed, summary ?? null, runId]
  );
}

// --- Content Suggestions ---

export function getPendingContentSuggestions(db: Database): ContentSuggestion[] {
  const results = db.exec(
    `SELECT * FROM content_suggestions WHERE status = 'pending' ORDER BY priority, created_at DESC`
  );
  return resultsToObjects<ContentSuggestion>(results);
}

export function insertContentSuggestion(
  db: Database,
  suggestion: Omit<ContentSuggestion, 'id' | 'created_at'>
): void {
  db.run(
    `INSERT INTO content_suggestions (url, suggestion_type, title, body, priority, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [suggestion.url, suggestion.suggestion_type, suggestion.title, suggestion.body, suggestion.priority, suggestion.status]
  );
}

// --- Link Suggestions ---

export function getPendingLinkSuggestions(db: Database): LinkSuggestion[] {
  const results = db.exec(
    `SELECT * FROM link_suggestions WHERE status = 'pending' ORDER BY priority, created_at DESC`
  );
  return resultsToObjects<LinkSuggestion>(results);
}

// --- GEO Scores ---

export function getLatestGeoScores(db: Database, url: string): GeoScore[] {
  const results = db.exec(
    `SELECT * FROM geo_scores WHERE url = ? ORDER BY measured_at DESC LIMIT 10`,
    [url]
  );
  return resultsToObjects<GeoScore>(results);
}

export function insertGeoScore(
  db: Database,
  score: Omit<GeoScore, 'id' | 'measured_at'>
): void {
  db.run(
    `INSERT OR IGNORE INTO geo_scores (url, score_type, score, details) VALUES (?, ?, ?, ?)`,
    [score.url, score.score_type, score.score, score.details ?? null]
  );
}

// --- Helpers ---

function resultsToObjects<T>(results: { columns: string[]; values: any[][] }[]): T[] {
  if (!results.length) return [];
  const { columns, values } = results[0];
  return values.map((row) => {
    const obj: any = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj as T;
  });
}
