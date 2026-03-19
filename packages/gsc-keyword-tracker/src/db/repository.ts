import type { Database } from 'sql.js';
import type { KeywordRecord, KeywordTrend, TrackerRun, TrendSnapshot, KeywordTrajectory } from '../models/types.js';

// --- Keywords ---

export function upsertKeyword(db: Database, kw: Omit<KeywordRecord, 'id' | 'fetchedAt'>): void {
  db.run(
    `INSERT INTO keywords (query, dialect, clicks, impressions, ctr, position, date, device, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(query, date, device, country) DO UPDATE SET
       dialect = excluded.dialect,
       clicks = excluded.clicks,
       impressions = excluded.impressions,
       ctr = excluded.ctr,
       position = excluded.position,
       fetched_at = datetime('now')`,
    [kw.query, kw.dialect, kw.clicks, kw.impressions, kw.ctr, kw.position, kw.date, kw.device, kw.country]
  );
}

export function getKeywordsForPeriod(db: Database, startDate: string, endDate: string): KeywordRecord[] {
  const stmt = db.prepare(
    `SELECT query, dialect, SUM(clicks) as clicks, SUM(impressions) as impressions,
            AVG(ctr) as ctr, AVG(position) as position
     FROM keywords
     WHERE date >= ? AND date <= ?
     GROUP BY query
     ORDER BY clicks DESC`
  );
  stmt.bind([startDate, endDate]);

  const results: KeywordRecord[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    results.push({
      query: row.query as string,
      dialect: row.dialect as KeywordRecord['dialect'],
      clicks: row.clicks as number,
      impressions: row.impressions as number,
      ctr: row.ctr as number,
      position: row.position as number,
      date: startDate,
      device: 'all',
      country: 'ind',
      fetchedAt: '',
    });
  }
  stmt.free();
  return results;
}

// --- Keyword Trends ---

export function upsertKeywordTrend(db: Database, trend: KeywordTrend): void {
  db.run(
    `INSERT INTO keyword_trends
      (query, dialect, direction, current_clicks, previous_clicks, clicks_delta, clicks_delta_pct,
       current_impressions, previous_impressions, impressions_delta,
       current_position, previous_position, position_delta, current_ctr, previous_ctr)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(query, computed_at) DO UPDATE SET
       dialect = excluded.dialect,
       direction = excluded.direction,
       current_clicks = excluded.current_clicks,
       previous_clicks = excluded.previous_clicks,
       clicks_delta = excluded.clicks_delta,
       clicks_delta_pct = excluded.clicks_delta_pct,
       current_impressions = excluded.current_impressions,
       previous_impressions = excluded.previous_impressions,
       impressions_delta = excluded.impressions_delta,
       current_position = excluded.current_position,
       previous_position = excluded.previous_position,
       position_delta = excluded.position_delta,
       current_ctr = excluded.current_ctr,
       previous_ctr = excluded.previous_ctr`,
    [
      trend.query, trend.dialect, trend.direction,
      trend.currentClicks, trend.previousClicks, trend.clicksDelta, trend.clicksDeltaPct,
      trend.currentImpressions, trend.previousImpressions, trend.impressionsDelta,
      trend.currentPosition, trend.previousPosition, trend.positionDelta,
      trend.currentCtr, trend.previousCtr,
    ]
  );
}

export function getTrends(
  db: Database,
  filters?: { direction?: string; dialect?: string; limit?: number }
): KeywordTrend[] {
  let query = 'SELECT * FROM keyword_trends WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.direction) {
    query += ' AND direction = ?';
    params.push(filters.direction);
  }
  if (filters?.dialect) {
    query += ' AND dialect = ?';
    params.push(filters.dialect);
  }

  query += ' ORDER BY ABS(clicks_delta) DESC';

  if (filters?.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }

  const stmt = db.prepare(query);
  stmt.bind(params);

  const results: KeywordTrend[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    results.push(mapRowToTrend(row));
  }
  stmt.free();
  return results;
}

export function getTrendCounts(db: Database): Record<string, number> {
  const stmt = db.prepare('SELECT direction, COUNT(*) as count FROM keyword_trends GROUP BY direction');
  const result: Record<string, number> = {};
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    result[row.direction as string] = row.count as number;
  }
  stmt.free();
  return result;
}

// --- Tracker Runs ---

export function insertTrackerRun(db: Database, run: Omit<TrackerRun, 'id'>): number {
  db.run(
    `INSERT INTO tracker_runs
      (run_at, period_start, period_end, previous_period_start, previous_period_end,
       total_keywords, rising_keywords, declining_keywords, new_keywords, lost_keywords, dialects_covered)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      run.runAt, run.periodStart, run.periodEnd, run.previousPeriodStart, run.previousPeriodEnd,
      run.totalKeywords, run.risingKeywords, run.decliningKeywords, run.newKeywords, run.lostKeywords,
      run.dialectsCovered,
    ]
  );
  const stmt = db.prepare('SELECT last_insert_rowid() as id');
  stmt.step();
  const row = stmt.getAsObject() as Record<string, unknown>;
  stmt.free();
  return row.id as number;
}

// --- Trend Snapshots (SEO-27) ---

export function upsertTrendSnapshot(db: Database, snap: Omit<TrendSnapshot, 'id' | 'snapshotAt'>): void {
  db.run(
    `INSERT INTO trend_snapshots
      (query, dialect, source, clicks, impressions, ctr, position, trend_index, period_start, period_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(query, source, period_start, period_end) DO UPDATE SET
       dialect = excluded.dialect,
       clicks = excluded.clicks,
       impressions = excluded.impressions,
       ctr = excluded.ctr,
       position = excluded.position,
       trend_index = excluded.trend_index,
       snapshot_at = datetime('now')`,
    [
      snap.query, snap.dialect, snap.source,
      snap.clicks, snap.impressions, snap.ctr, snap.position,
      snap.trendIndex, snap.periodStart, snap.periodEnd,
    ]
  );
}

export function getTrendSnapshots(
  db: Database,
  query: string,
  source?: string,
  limit: number = 30
): TrendSnapshot[] {
  let sql = 'SELECT * FROM trend_snapshots WHERE query = ?';
  const params: unknown[] = [query];

  if (source) {
    sql += ' AND source = ?';
    params.push(source);
  }

  sql += ' ORDER BY period_end DESC LIMIT ?';
  params.push(limit);

  const stmt = db.prepare(sql);
  stmt.bind(params);

  const results: TrendSnapshot[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    results.push(mapRowToSnapshot(row));
  }
  stmt.free();
  return results;
}

export function getKeywordTrajectory(db: Database, query: string, source: string = 'gsc'): KeywordTrajectory | null {
  const snapshots = getTrendSnapshots(db, query, source, 30);
  if (snapshots.length === 0) return null;

  const dialect = snapshots[0].dialect;

  // Calculate trajectory direction and velocity
  let overallDirection: KeywordTrend['direction'] = 'stable';
  let velocityPct = 0;

  if (snapshots.length >= 2) {
    const newest = snapshots[0]; // Sorted DESC
    const oldest = snapshots[snapshots.length - 1];

    const clicksDelta = newest.clicks - oldest.clicks;
    velocityPct = oldest.clicks > 0
      ? Math.round((clicksDelta / oldest.clicks) * 100 * 100) / 100
      : newest.clicks > 0 ? 100 : 0;

    if (velocityPct > 10) overallDirection = 'rising';
    else if (velocityPct < -10) overallDirection = 'declining';
    else overallDirection = 'stable';
  }

  return {
    query,
    dialect,
    snapshots: snapshots.reverse(), // Chronological order
    overallDirection,
    velocityPct,
  };
}

export function getTopTrajectories(
  db: Database,
  direction: 'rising' | 'declining',
  limit: number = 10
): KeywordTrajectory[] {
  // Get keywords with multiple snapshots
  const stmt = db.prepare(
    `SELECT query, COUNT(*) as cnt FROM trend_snapshots
     WHERE source = 'gsc'
     GROUP BY query HAVING cnt >= 2
     ORDER BY cnt DESC LIMIT ?`
  );
  stmt.bind([limit * 3]); // Fetch more, filter after

  const queries: string[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    queries.push(row.query as string);
  }
  stmt.free();

  const trajectories: KeywordTrajectory[] = [];
  for (const query of queries) {
    const traj = getKeywordTrajectory(db, query);
    if (traj && traj.overallDirection === direction) {
      trajectories.push(traj);
    }
  }

  return trajectories
    .sort((a, b) => Math.abs(b.velocityPct) - Math.abs(a.velocityPct))
    .slice(0, limit);
}

export function getSnapshotCount(db: Database): number {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM trend_snapshots');
  stmt.step();
  const row = stmt.getAsObject() as Record<string, unknown>;
  stmt.free();
  return (row.count as number) ?? 0;
}

// --- Helpers ---

function mapRowToSnapshot(row: Record<string, unknown>): TrendSnapshot {
  return {
    id: row.id as number,
    query: row.query as string,
    dialect: row.dialect as TrendSnapshot['dialect'],
    source: row.source as TrendSnapshot['source'],
    clicks: row.clicks as number,
    impressions: row.impressions as number,
    ctr: row.ctr as number,
    position: row.position as number,
    trendIndex: row.trend_index as number,
    periodStart: row.period_start as string,
    periodEnd: row.period_end as string,
    snapshotAt: row.snapshot_at as string,
  };
}

function mapRowToTrend(row: Record<string, unknown>): KeywordTrend {
  return {
    query: row.query as string,
    dialect: row.dialect as KeywordTrend['dialect'],
    direction: row.direction as KeywordTrend['direction'],
    currentClicks: row.current_clicks as number,
    previousClicks: row.previous_clicks as number,
    clicksDelta: row.clicks_delta as number,
    clicksDeltaPct: row.clicks_delta_pct as number,
    currentImpressions: row.current_impressions as number,
    previousImpressions: row.previous_impressions as number,
    impressionsDelta: row.impressions_delta as number,
    currentPosition: row.current_position as number,
    previousPosition: row.previous_position as number,
    positionDelta: row.position_delta as number,
    currentCtr: row.current_ctr as number,
    previousCtr: row.previous_ctr as number,
  };
}
