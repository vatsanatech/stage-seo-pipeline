import type { Database } from 'sql.js';
import type { ContentSuggestion, SerpResult, GapAnalysisRun, CompetitorPosition, BrandMention, PositionChange } from '../models/types.js';

// --- Content Suggestions ---

export function upsertContentSuggestion(db: Database, s: Omit<ContentSuggestion, 'id' | 'createdAt' | 'updatedAt'>): void {
  db.run(
    `INSERT INTO content_suggestions
      (keyword, dialect, suggested_content_type, gap_source, competitor_urls, competitor_domains,
       title, description, priority, status, estimated_search_volume, stage_current_position, best_competitor_position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(keyword, dialect, gap_source) DO UPDATE SET
       competitor_urls = excluded.competitor_urls,
       competitor_domains = excluded.competitor_domains,
       title = excluded.title,
       description = excluded.description,
       priority = excluded.priority,
       estimated_search_volume = excluded.estimated_search_volume,
       stage_current_position = excluded.stage_current_position,
       best_competitor_position = excluded.best_competitor_position,
       updated_at = datetime('now')`,
    [
      s.keyword, s.dialect, s.suggestedContentType, s.gapSource,
      s.competitorUrls, s.competitorDomains,
      s.title, s.description, s.priority, s.status,
      s.estimatedSearchVolume, s.stageCurrentPosition, s.bestCompetitorPosition,
    ]
  );
}

export function getContentSuggestions(
  db: Database,
  filters?: { dialect?: string; priority?: string; status?: string; gapSource?: string }
): ContentSuggestion[] {
  let query = 'SELECT * FROM content_suggestions WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.dialect) {
    query += ' AND dialect = ?';
    params.push(filters.dialect);
  }
  if (filters?.priority) {
    query += ' AND priority = ?';
    params.push(filters.priority);
  }
  if (filters?.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters?.gapSource) {
    query += ' AND gap_source = ?';
    params.push(filters.gapSource);
  }

  query += ' ORDER BY priority ASC, best_competitor_position ASC';

  const stmt = db.prepare(query);
  stmt.bind(params);

  const results: ContentSuggestion[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    results.push(mapRowToSuggestion(row));
  }
  stmt.free();
  return results;
}

export function getSuggestionCount(db: Database): number {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM content_suggestions');
  stmt.step();
  const row = stmt.getAsObject() as Record<string, unknown>;
  stmt.free();
  return (row.count as number) ?? 0;
}

export function getSuggestionsByPriority(db: Database): Record<string, number> {
  const stmt = db.prepare('SELECT priority, COUNT(*) as count FROM content_suggestions GROUP BY priority');
  const result: Record<string, number> = {};
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    result[row.priority as string] = row.count as number;
  }
  stmt.free();
  return result;
}

// --- SERP Snapshots ---

export function upsertSerpResult(db: Database, r: SerpResult): void {
  db.run(
    `INSERT INTO serp_snapshots (query, position, url, title, snippet, domain, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(query, url) DO UPDATE SET
       position = excluded.position,
       title = excluded.title,
       snippet = excluded.snippet,
       fetched_at = excluded.fetched_at`,
    [r.query, r.position, r.url, r.title, r.snippet, r.domain, r.fetchedAt]
  );
}

export function getSerpResults(db: Database, query: string): SerpResult[] {
  const stmt = db.prepare('SELECT * FROM serp_snapshots WHERE query = ? ORDER BY position ASC');
  stmt.bind([query]);

  const results: SerpResult[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    results.push({
      query: row.query as string,
      position: row.position as number,
      url: row.url as string,
      title: row.title as string,
      snippet: row.snippet as string,
      domain: row.domain as string,
      fetchedAt: row.fetched_at as string,
    });
  }
  stmt.free();
  return results;
}

// --- Gap Analysis Runs ---

export function insertGapAnalysisRun(db: Database, run: Omit<GapAnalysisRun, 'id'>): number {
  db.run(
    `INSERT INTO gap_analysis_runs (run_at, keywords_analyzed, gaps_found, suggestions_created, dialects_covered, competitors_covered)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [run.runAt, run.keywordsAnalyzed, run.gapsFound, run.suggestionsCreated, run.dialectsCovered, run.competitorsCovered]
  );
  const stmt = db.prepare('SELECT last_insert_rowid() as id');
  stmt.step();
  const row = stmt.getAsObject() as Record<string, unknown>;
  stmt.free();
  return row.id as number;
}

export function getLatestRun(db: Database): GapAnalysisRun | null {
  const stmt = db.prepare('SELECT * FROM gap_analysis_runs ORDER BY run_at DESC LIMIT 1');
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject() as Record<string, unknown>;
  stmt.free();
  return {
    id: row.id as number,
    runAt: row.run_at as string,
    keywordsAnalyzed: row.keywords_analyzed as number,
    gapsFound: row.gaps_found as number,
    suggestionsCreated: row.suggestions_created as number,
    dialectsCovered: row.dialects_covered as string,
    competitorsCovered: row.competitors_covered as string,
  };
}

// --- Competitor Positions (SEO-9) ---

export function insertCompetitorPosition(db: Database, pos: Omit<CompetitorPosition, 'id'>): void {
  db.run(
    `INSERT INTO competitor_positions (keyword, domain, position, url, title, is_stage, is_competitor, tracked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(keyword, domain, tracked_at) DO UPDATE SET
       position = excluded.position,
       url = excluded.url,
       title = excluded.title`,
    [pos.keyword, pos.domain, pos.position, pos.url, pos.title, pos.isStage ? 1 : 0, pos.isCompetitor ? 1 : 0, pos.trackedAt]
  );
}

export function getLatestPositions(db: Database, keyword: string): CompetitorPosition[] {
  const stmt = db.prepare(
    `SELECT * FROM competitor_positions
     WHERE keyword = ? AND tracked_at = (SELECT MAX(tracked_at) FROM competitor_positions WHERE keyword = ?)
     ORDER BY position ASC`
  );
  stmt.bind([keyword, keyword]);

  const results: CompetitorPosition[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    results.push(mapRowToPosition(row));
  }
  stmt.free();
  return results;
}

export function getPositionHistory(db: Database, keyword: string, domain: string, limit: number = 30): CompetitorPosition[] {
  const stmt = db.prepare(
    `SELECT * FROM competitor_positions
     WHERE keyword = ? AND domain = ?
     ORDER BY tracked_at DESC
     LIMIT ?`
  );
  stmt.bind([keyword, domain, limit]);

  const results: CompetitorPosition[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    results.push(mapRowToPosition(row));
  }
  stmt.free();
  return results;
}

export function comparePositions(db: Database, keyword: string, currentDate: string, previousDate: string): PositionChange[] {
  const getCurrent = db.prepare(
    'SELECT * FROM competitor_positions WHERE keyword = ? AND tracked_at = ? AND (is_stage = 1 OR is_competitor = 1)'
  );
  getCurrent.bind([keyword, currentDate]);
  const currentMap = new Map<string, CompetitorPosition>();
  while (getCurrent.step()) {
    const row = getCurrent.getAsObject() as Record<string, unknown>;
    const pos = mapRowToPosition(row);
    currentMap.set(pos.domain, pos);
  }
  getCurrent.free();

  const getPrevious = db.prepare(
    'SELECT * FROM competitor_positions WHERE keyword = ? AND tracked_at = ? AND (is_stage = 1 OR is_competitor = 1)'
  );
  getPrevious.bind([keyword, previousDate]);
  const previousMap = new Map<string, CompetitorPosition>();
  while (getPrevious.step()) {
    const row = getPrevious.getAsObject() as Record<string, unknown>;
    const pos = mapRowToPosition(row);
    previousMap.set(pos.domain, pos);
  }
  getPrevious.free();

  const changes: PositionChange[] = [];
  const allDomains = new Set([...currentMap.keys(), ...previousMap.keys()]);

  for (const domain of allDomains) {
    const current = currentMap.get(domain);
    const previous = previousMap.get(domain);

    if (current && previous) {
      const delta = previous.position - current.position; // positive = improved
      changes.push({
        keyword,
        domain,
        previousPosition: previous.position,
        currentPosition: current.position,
        delta,
        direction: delta > 0 ? 'improved' : delta < 0 ? 'dropped' : 'stable',
      });
    } else if (current && !previous) {
      changes.push({
        keyword,
        domain,
        previousPosition: null,
        currentPosition: current.position,
        delta: null,
        direction: 'new_entry',
      });
    } else if (!current && previous) {
      changes.push({
        keyword,
        domain,
        previousPosition: previous.position,
        currentPosition: 0,
        delta: null,
        direction: 'lost',
      });
    }
  }

  return changes.sort((a, b) => a.currentPosition - b.currentPosition);
}

// --- Brand Mentions (SEO-9) ---

export function upsertBrandMention(db: Database, m: Omit<BrandMention, 'id'>): void {
  db.run(
    `INSERT INTO brand_mentions (query, domain, url, title, snippet, mention_type, sentiment, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(query, url) DO UPDATE SET
       title = excluded.title,
       snippet = excluded.snippet,
       mention_type = excluded.mention_type,
       sentiment = excluded.sentiment,
       detected_at = excluded.detected_at`,
    [m.query, m.domain, m.url, m.title, m.snippet, m.mentionType, m.sentiment, m.detectedAt]
  );
}

export function getBrandMentions(
  db: Database,
  filters?: { mentionType?: string; sentiment?: string; limit?: number }
): BrandMention[] {
  let query = 'SELECT * FROM brand_mentions WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.mentionType) {
    query += ' AND mention_type = ?';
    params.push(filters.mentionType);
  }
  if (filters?.sentiment) {
    query += ' AND sentiment = ?';
    params.push(filters.sentiment);
  }
  query += ' ORDER BY detected_at DESC';
  if (filters?.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }

  const stmt = db.prepare(query);
  stmt.bind(params);

  const results: BrandMention[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    results.push({
      id: row.id as number,
      query: row.query as string,
      domain: row.domain as string,
      url: row.url as string,
      title: row.title as string,
      snippet: row.snippet as string,
      mentionType: row.mention_type as BrandMention['mentionType'],
      sentiment: row.sentiment as BrandMention['sentiment'],
      detectedAt: row.detected_at as string,
    });
  }
  stmt.free();
  return results;
}

export function getBrandMentionCounts(db: Database): Record<string, number> {
  const stmt = db.prepare('SELECT mention_type, COUNT(*) as count FROM brand_mentions GROUP BY mention_type');
  const result: Record<string, number> = {};
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    result[row.mention_type as string] = row.count as number;
  }
  stmt.free();
  return result;
}

// --- Helpers ---

function mapRowToPosition(row: Record<string, unknown>): CompetitorPosition {
  return {
    id: row.id as number,
    keyword: row.keyword as string,
    domain: row.domain as string,
    position: row.position as number,
    url: row.url as string,
    title: row.title as string,
    isStage: (row.is_stage as number) === 1,
    isCompetitor: (row.is_competitor as number) === 1,
    trackedAt: row.tracked_at as string,
  };
}

function mapRowToSuggestion(row: Record<string, unknown>): ContentSuggestion {
  return {
    id: row.id as number,
    keyword: row.keyword as string,
    dialect: row.dialect as ContentSuggestion['dialect'],
    suggestedContentType: row.suggested_content_type as ContentSuggestion['suggestedContentType'],
    gapSource: row.gap_source as ContentSuggestion['gapSource'],
    competitorUrls: row.competitor_urls as string,
    competitorDomains: row.competitor_domains as string,
    title: row.title as string,
    description: row.description as string,
    priority: row.priority as ContentSuggestion['priority'],
    status: row.status as ContentSuggestion['status'],
    estimatedSearchVolume: row.estimated_search_volume as number | null,
    stageCurrentPosition: row.stage_current_position as number | null,
    bestCompetitorPosition: row.best_competitor_position as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
