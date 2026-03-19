import { getDatabase, saveDatabase, closeDatabase } from './db/schema.js';
import { upsertKeyword, getKeywordsForPeriod, upsertKeywordTrend, insertTrackerRun, getTrends, getTrendCounts, getSnapshotCount } from './db/repository.js';
import { GscClient } from './gsc/client.js';
import { analyzeTrends, summarizeTrends } from './analyzers/trend-analyzer.js';
import { detectDialect, getDialectDistribution } from './analyzers/dialect-detector.js';
import { generateGscSnapshots } from './analyzers/snapshot-generator.js';
import type { GscAuthConfig, GscResponseRow, KeywordRecord, KeywordTrend } from './models/types.js';

export interface TrackerOptions {
  siteUrl: string;
  authConfig: GscAuthConfig;
  dbPath?: string;
  rowLimit?: number;
}

export interface TrackingResult {
  periodStart: string;
  periodEnd: string;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  totalKeywords: number;
  rising: number;
  declining: number;
  new_: number;
  lost: number;
  stable: number;
  dialectDistribution: Record<string, number>;
  topRising: KeywordTrend[];
  topDeclining: KeywordTrend[];
}

/**
 * Run the GSC keyword tracking pipeline:
 * 1. Fetch current period (last 14 days) keywords from GSC
 * 2. Fetch previous period (14 days before that)
 * 3. Auto-detect dialect for each keyword
 * 4. Compare periods to identify rising/declining/new/lost keywords
 * 5. Persist everything to SQLite
 */
export async function runTracker(opts: TrackerOptions): Promise<TrackingResult> {
  const { siteUrl, authConfig, dbPath = 'gsc_keywords.db', rowLimit = 5000 } = opts;

  console.log('[GSC Tracker] Starting keyword tracking...');

  const db = await getDatabase(dbPath);
  const client = new GscClient(siteUrl, authConfig);

  // Calculate 14-day rolling windows
  const now = new Date();
  const periodEnd = formatDate(addDays(now, -3)); // GSC data lags ~3 days
  const periodStart = formatDate(addDays(now, -16));
  const previousPeriodEnd = formatDate(addDays(now, -17));
  const previousPeriodStart = formatDate(addDays(now, -30));

  console.log(`[GSC Tracker] Current period: ${periodStart} to ${periodEnd}`);
  console.log(`[GSC Tracker] Previous period: ${previousPeriodStart} to ${previousPeriodEnd}`);

  // Fetch from GSC
  const currentRows = await client.querySearchAnalytics(periodStart, periodEnd, ['query'], rowLimit);
  const previousRows = await client.querySearchAnalytics(previousPeriodStart, previousPeriodEnd, ['query'], rowLimit);

  console.log(`[GSC Tracker] Fetched ${currentRows.length} current, ${previousRows.length} previous keywords`);

  // Convert and persist
  const currentKeywords = gscRowsToKeywords(currentRows, periodEnd);
  const previousKeywords = gscRowsToKeywords(previousRows, previousPeriodEnd);

  for (const kw of currentKeywords) {
    upsertKeyword(db, kw);
  }
  for (const kw of previousKeywords) {
    upsertKeyword(db, kw);
  }

  // Analyze trends
  const trends = analyzeTrends(currentKeywords, previousKeywords);
  const summary = summarizeTrends(trends);

  // Persist trends
  for (const trend of trends) {
    upsertKeywordTrend(db, trend);
  }

  // Generate trend snapshots for trajectory tracking (SEO-27)
  const snapshotsCreated = generateGscSnapshots(db, currentKeywords, periodStart, periodEnd);
  console.log(`[GSC Tracker] Created ${snapshotsCreated} trend snapshots`);

  // Record run
  const dialectDistribution = getDialectDistribution(currentKeywords.map((k) => k.query));
  insertTrackerRun(db, {
    runAt: new Date().toISOString(),
    periodStart,
    periodEnd,
    previousPeriodStart,
    previousPeriodEnd,
    totalKeywords: trends.length,
    risingKeywords: summary.rising,
    decliningKeywords: summary.declining,
    newKeywords: summary.new_,
    lostKeywords: summary.lost,
    dialectsCovered: JSON.stringify(Object.keys(dialectDistribution).filter((d) => d !== 'unclassified' && dialectDistribution[d] > 0)),
  });

  saveDatabase(db, dbPath);

  console.log(`[GSC Tracker] Done. Rising: ${summary.rising}, Declining: ${summary.declining}, New: ${summary.new_}, Lost: ${summary.lost}`);

  return {
    periodStart,
    periodEnd,
    previousPeriodStart,
    previousPeriodEnd,
    totalKeywords: trends.length,
    rising: summary.rising,
    declining: summary.declining,
    new_: summary.new_,
    lost: summary.lost,
    stable: summary.stable,
    dialectDistribution,
    topRising: summary.topRising,
    topDeclining: summary.topDeclining,
  };
}

/**
 * Run tracker with mock data (for testing without GSC credentials).
 */
export async function runTrackerWithData(
  currentKeywords: KeywordRecord[],
  previousKeywords: KeywordRecord[],
  dbPath: string = 'gsc_keywords.db'
): Promise<TrackingResult> {
  const db = await getDatabase(dbPath);

  for (const kw of currentKeywords) {
    upsertKeyword(db, kw);
  }
  for (const kw of previousKeywords) {
    upsertKeyword(db, kw);
  }

  const trends = analyzeTrends(currentKeywords, previousKeywords);
  const summary = summarizeTrends(trends);

  for (const trend of trends) {
    upsertKeywordTrend(db, trend);
  }

  // Generate trend snapshots (SEO-27)
  const periodStart = currentKeywords[0]?.date || '';
  const periodEnd = currentKeywords[0]?.date || '';
  if (periodStart) {
    generateGscSnapshots(db, currentKeywords, periodStart, periodEnd);
  }

  const dialectDistribution = getDialectDistribution(currentKeywords.map((k) => k.query));

  saveDatabase(db, dbPath);

  return {
    periodStart,
    periodEnd,
    previousPeriodStart: previousKeywords[0]?.date || '',
    previousPeriodEnd: previousKeywords[0]?.date || '',
    totalKeywords: trends.length,
    rising: summary.rising,
    declining: summary.declining,
    new_: summary.new_,
    lost: summary.lost,
    stable: summary.stable,
    dialectDistribution,
    topRising: summary.topRising,
    topDeclining: summary.topDeclining,
  };
}

function gscRowsToKeywords(rows: GscResponseRow[], date: string): KeywordRecord[] {
  return rows.map((row) => ({
    query: row.keys[0],
    dialect: detectDialect(row.keys[0]),
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
    date,
    device: 'all',
    country: 'ind',
    fetchedAt: new Date().toISOString(),
  }));
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export { getDatabase, saveDatabase, closeDatabase } from './db/schema.js';
export { detectDialect } from './analyzers/dialect-detector.js';
export { generateGscSnapshots, generateGoogleTrendsSnapshots } from './analyzers/snapshot-generator.js';
export { getTrendSnapshots, getKeywordTrajectory, getTopTrajectories } from './db/repository.js';
export { evaluateAlerts, sendKeywordAlerts, DEFAULT_THRESHOLDS } from './alerts/keyword-alerter.js';
export { sendSlackWebhook, buildAttachment, SEVERITY_COLORS } from './alerts/slack-client.js';
export type { KeywordRecord, KeywordTrend, TrackerRun, GscAuthConfig, TrendSnapshot, KeywordTrajectory } from './models/types.js';
export type { KeywordAlert, AlertThresholds } from './alerts/keyword-alerter.js';
export type { Severity, SlackPayload, SlackSendResult } from './alerts/slack-client.js';
export { getInterestOverTime, getRelatedQueries, getInterestSnapshot } from './trends/google-trends-client.js';
export { correlateTrendsWithGsc, persistTrendsData, generateRegionalSuggestions } from './trends/trends-correlator.js';
export type { TrendsDataPoint, RelatedQuery, TrendsOptions } from './trends/google-trends-client.js';
export type { TrendsCorrelation } from './trends/trends-correlator.js';
export { SerpBearClient, createSerpBearClient } from './serpbear/serpbear-client.js';
export { syncSerpBearKeywords, persistSerpBearKeywords, convertHistoryToSnapshots } from './serpbear/serpbear-sync.js';
export type { SerpBearKeyword, SerpBearDomain, SerpBearConfig } from './serpbear/serpbear-client.js';
export type { SyncResult } from './serpbear/serpbear-sync.js';
