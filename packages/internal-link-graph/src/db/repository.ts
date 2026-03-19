import type { Database } from 'sql.js';
import type { LinkGraphEdge, LinkSuggestion, PageScore } from '../models/types.js';

export function insertEdge(db: Database, edge: LinkGraphEdge): void {
  db.run(
    `INSERT OR REPLACE INTO link_graph (source_url, target_url, anchor_text, crawled_at)
     VALUES (?, ?, ?, ?)`,
    [edge.sourceUrl, edge.targetUrl, edge.anchorText, edge.crawledAt]
  );
}

export function insertEdges(db: Database, edges: LinkGraphEdge[]): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO link_graph (source_url, target_url, anchor_text, crawled_at)
     VALUES (?, ?, ?, ?)`
  );
  for (const edge of edges) {
    stmt.run([edge.sourceUrl, edge.targetUrl, edge.anchorText, edge.crawledAt]);
  }
  stmt.free();
}

export function getAllEdges(db: Database): LinkGraphEdge[] {
  const results = db.exec(
    'SELECT id, source_url, target_url, anchor_text, crawled_at FROM link_graph'
  );
  if (!results.length) return [];

  return results[0].values.map((row) => ({
    id: row[0] as number,
    sourceUrl: row[1] as string,
    targetUrl: row[2] as string,
    anchorText: row[3] as string,
    crawledAt: row[4] as string,
  }));
}

export function getAllPages(db: Database): string[] {
  const results = db.exec(`
    SELECT DISTINCT url FROM (
      SELECT source_url AS url FROM link_graph
      UNION
      SELECT target_url AS url FROM link_graph
    )
  `);
  if (!results.length) return [];
  return results[0].values.map((row) => row[0] as string);
}

export function upsertPageScore(db: Database, score: PageScore): void {
  db.run(
    `INSERT OR REPLACE INTO page_scores (url, pagerank, authority_score, hub_score, inbound_links, outbound_links, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [score.url, score.pagerank, score.authorityScore, score.hubScore, score.inboundLinks, score.outboundLinks]
  );
}

export function getPageScores(db: Database): PageScore[] {
  const results = db.exec(
    'SELECT url, pagerank, authority_score, hub_score, inbound_links, outbound_links FROM page_scores ORDER BY pagerank DESC'
  );
  if (!results.length) return [];

  return results[0].values.map((row) => ({
    url: row[0] as string,
    pagerank: row[1] as number,
    authorityScore: row[2] as number,
    hubScore: row[3] as number,
    inboundLinks: row[4] as number,
    outboundLinks: row[5] as number,
  }));
}

export function insertSuggestion(db: Database, suggestion: LinkSuggestion): void {
  db.run(
    `INSERT OR REPLACE INTO link_suggestions (source_url, target_url, suggested_anchor_text, reason, priority, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [suggestion.sourceUrl, suggestion.targetUrl, suggestion.suggestedAnchorText, suggestion.reason, suggestion.priority, suggestion.createdAt]
  );
}

export function getSuggestions(db: Database, status: string = 'pending'): LinkSuggestion[] {
  const results = db.exec(
    'SELECT id, source_url, target_url, suggested_anchor_text, reason, priority, created_at FROM link_suggestions WHERE status = ?',
    [status]
  );
  if (!results.length) return [];

  return results[0].values.map((row) => ({
    id: row[0] as number,
    sourceUrl: row[1] as string,
    targetUrl: row[2] as string,
    suggestedAnchorText: row[3] as string,
    reason: row[4] as string,
    priority: row[5] as 'high' | 'medium' | 'low',
    createdAt: row[6] as string,
  }));
}
