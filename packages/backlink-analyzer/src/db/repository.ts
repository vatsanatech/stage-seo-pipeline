import type { Database } from 'sql.js';
import type { Backlink, BacklinkProfile, LinkOpportunity, BacklinkRun } from '../models/types.js';

// --- Backlinks ---

export function upsertBacklink(db: Database, bl: Omit<Backlink, 'id' | 'discoveredAt'>): void {
  db.run(
    `INSERT INTO backlinks (target_domain, target_url, source_domain, source_url, anchor_text, crawl_date, link_type, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(target_url, source_url) DO UPDATE SET
       anchor_text = excluded.anchor_text,
       crawl_date = excluded.crawl_date,
       link_type = excluded.link_type,
       status = excluded.status`,
    [bl.targetDomain, bl.targetUrl, bl.sourceDomain, bl.sourceUrl, bl.anchorText, bl.crawlDate, bl.linkType, bl.status]
  );
}

export function getBacklinks(db: Database, targetDomain: string, limit: number = 100): Backlink[] {
  const stmt = db.prepare(
    'SELECT * FROM backlinks WHERE target_domain = ? ORDER BY crawl_date DESC LIMIT ?'
  );
  stmt.bind([targetDomain, limit]);
  const results: Backlink[] = [];
  while (stmt.step()) {
    results.push(mapRowToBacklink(stmt.getAsObject() as Record<string, unknown>));
  }
  stmt.free();
  return results;
}

export function getBacklinkCount(db: Database, targetDomain?: string): number {
  const sql = targetDomain
    ? 'SELECT COUNT(*) as count FROM backlinks WHERE target_domain = ?'
    : 'SELECT COUNT(*) as count FROM backlinks';
  const stmt = db.prepare(sql);
  if (targetDomain) stmt.bind([targetDomain]);
  stmt.step();
  const row = stmt.getAsObject() as Record<string, unknown>;
  stmt.free();
  return (row.count as number) ?? 0;
}

export function buildBacklinkProfile(db: Database, targetDomain: string): BacklinkProfile {
  const total = getBacklinkCount(db, targetDomain);

  // Unique source domains
  const uniqueStmt = db.prepare(
    'SELECT COUNT(DISTINCT source_domain) as cnt FROM backlinks WHERE target_domain = ?'
  );
  uniqueStmt.bind([targetDomain]);
  uniqueStmt.step();
  const uniqueRow = uniqueStmt.getAsObject() as Record<string, unknown>;
  uniqueStmt.free();
  const uniqueDomains = (uniqueRow.cnt as number) ?? 0;

  // Link type counts
  const typeStmt = db.prepare(
    'SELECT link_type, COUNT(*) as cnt FROM backlinks WHERE target_domain = ? GROUP BY link_type'
  );
  typeStmt.bind([targetDomain]);
  let dofollow = 0;
  let nofollow = 0;
  while (typeStmt.step()) {
    const r = typeStmt.getAsObject() as Record<string, unknown>;
    if (r.link_type === 'dofollow') dofollow = r.cnt as number;
    else nofollow += r.cnt as number;
  }
  typeStmt.free();

  // Top source domains
  const topStmt = db.prepare(
    'SELECT source_domain, COUNT(*) as cnt FROM backlinks WHERE target_domain = ? GROUP BY source_domain ORDER BY cnt DESC LIMIT 10'
  );
  topStmt.bind([targetDomain]);
  const topDomains: Array<{ domain: string; count: number }> = [];
  while (topStmt.step()) {
    const r = topStmt.getAsObject() as Record<string, unknown>;
    topDomains.push({ domain: r.source_domain as string, count: r.cnt as number });
  }
  topStmt.free();

  // Anchor text distribution
  const anchorStmt = db.prepare(
    "SELECT anchor_text, COUNT(*) as cnt FROM backlinks WHERE target_domain = ? AND anchor_text != '' GROUP BY anchor_text ORDER BY cnt DESC LIMIT 10"
  );
  anchorStmt.bind([targetDomain]);
  const anchors: Array<{ text: string; count: number }> = [];
  while (anchorStmt.step()) {
    const r = anchorStmt.getAsObject() as Record<string, unknown>;
    anchors.push({ text: r.anchor_text as string, count: r.cnt as number });
  }
  anchorStmt.free();

  return {
    domain: targetDomain,
    totalBacklinks: total,
    uniqueSourceDomains: uniqueDomains,
    dofollowCount: dofollow,
    nofollowCount: nofollow,
    topSourceDomains: topDomains,
    anchorTextDistribution: anchors,
  };
}

// --- Link Opportunities ---

export function upsertOpportunity(db: Database, opp: Omit<LinkOpportunity, 'id' | 'discoveredAt'>): void {
  db.run(
    `INSERT INTO link_opportunities
      (source_domain, source_url, competitor_domain, competitor_url, anchor_text, opportunity_type, priority, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_url, competitor_url) DO UPDATE SET
       anchor_text = excluded.anchor_text,
       opportunity_type = excluded.opportunity_type,
       priority = excluded.priority,
       notes = excluded.notes`,
    [opp.sourceDomain, opp.sourceUrl, opp.competitorDomain, opp.competitorUrl, opp.anchorText, opp.opportunityType, opp.priority, opp.status, opp.notes]
  );
}

export function getOpportunities(
  db: Database,
  filters?: { priority?: string; type?: string; status?: string; limit?: number }
): LinkOpportunity[] {
  let sql = 'SELECT * FROM link_opportunities WHERE 1=1';
  const params: unknown[] = [];
  if (filters?.priority) { sql += ' AND priority = ?'; params.push(filters.priority); }
  if (filters?.type) { sql += ' AND opportunity_type = ?'; params.push(filters.type); }
  if (filters?.status) { sql += ' AND status = ?'; params.push(filters.status); }
  sql += ' ORDER BY priority ASC, discovered_at DESC';
  if (filters?.limit) { sql += ' LIMIT ?'; params.push(filters.limit); }

  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results: LinkOpportunity[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject() as Record<string, unknown>;
    results.push({
      id: r.id as number,
      sourceDomain: r.source_domain as string,
      sourceUrl: r.source_url as string,
      competitorDomain: r.competitor_domain as string,
      competitorUrl: r.competitor_url as string,
      anchorText: r.anchor_text as string,
      opportunityType: r.opportunity_type as LinkOpportunity['opportunityType'],
      priority: r.priority as LinkOpportunity['priority'],
      status: r.status as LinkOpportunity['status'],
      notes: r.notes as string,
      discoveredAt: r.discovered_at as string,
    });
  }
  stmt.free();
  return results;
}

export function getOpportunityCount(db: Database): number {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM link_opportunities');
  stmt.step();
  const row = stmt.getAsObject() as Record<string, unknown>;
  stmt.free();
  return (row.count as number) ?? 0;
}

// --- Runs ---

export function insertBacklinkRun(db: Database, run: Omit<BacklinkRun, 'id'>): number {
  db.run(
    `INSERT INTO backlink_runs (run_at, domains_analyzed, total_backlinks_found, new_backlinks, lost_backlinks, opportunities_found)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [run.runAt, run.domainsAnalyzed, run.totalBacklinksFound, run.newBacklinks, run.lostBacklinks, run.opportunitiesFound]
  );
  const stmt = db.prepare('SELECT last_insert_rowid() as id');
  stmt.step();
  const row = stmt.getAsObject() as Record<string, unknown>;
  stmt.free();
  return row.id as number;
}

// --- Helpers ---

function mapRowToBacklink(row: Record<string, unknown>): Backlink {
  return {
    id: row.id as number,
    targetDomain: row.target_domain as string,
    targetUrl: row.target_url as string,
    sourceDomain: row.source_domain as string,
    sourceUrl: row.source_url as string,
    anchorText: row.anchor_text as string,
    crawlDate: row.crawl_date as string,
    linkType: row.link_type as Backlink['linkType'],
    status: row.status as Backlink['status'],
    discoveredAt: row.discovered_at as string,
  };
}
