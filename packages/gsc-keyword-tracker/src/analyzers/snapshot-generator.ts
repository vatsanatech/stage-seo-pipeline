import type { Database } from 'sql.js';
import type { KeywordRecord, TrendSnapshot, TrendSource } from '../models/types.js';
import { upsertTrendSnapshot } from '../db/repository.js';
import { detectDialect } from './dialect-detector.js';

/**
 * Generate trend snapshots from GSC keyword data.
 * Each snapshot captures keyword metrics for a specific period.
 */
export function generateGscSnapshots(
  db: Database,
  keywords: KeywordRecord[],
  periodStart: string,
  periodEnd: string
): number {
  let count = 0;

  for (const kw of keywords) {
    const trendIndex = computeTrendIndex(kw);

    upsertTrendSnapshot(db, {
      query: kw.query,
      dialect: kw.dialect ?? detectDialect(kw.query),
      source: 'gsc',
      clicks: kw.clicks,
      impressions: kw.impressions,
      ctr: kw.ctr,
      position: kw.position,
      trendIndex,
      periodStart,
      periodEnd,
    });
    count++;
  }

  return count;
}

/**
 * Generate trend snapshots from Google Trends data.
 * trendIndex maps directly to Google Trends interest (0-100).
 */
export function generateGoogleTrendsSnapshots(
  db: Database,
  trendsData: Array<{ query: string; interest: number }>,
  periodStart: string,
  periodEnd: string
): number {
  let count = 0;

  for (const item of trendsData) {
    upsertTrendSnapshot(db, {
      query: item.query,
      dialect: detectDialect(item.query),
      source: 'google_trends',
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
      trendIndex: item.interest,
      periodStart,
      periodEnd,
    });
    count++;
  }

  return count;
}

/**
 * Compute a normalized trend index (0-100) from GSC metrics.
 * Uses a weighted combination of clicks, impressions, CTR, and position.
 */
function computeTrendIndex(kw: KeywordRecord): number {
  // Normalize individual metrics to 0-100 scale
  const clicksScore = Math.min(kw.clicks / 10, 100); // 1000+ clicks = 100
  const impressionsScore = Math.min(kw.impressions / 100, 100); // 10000+ impressions = 100
  const ctrScore = Math.min(kw.ctr * 1000, 100); // 10%+ CTR = 100
  const positionScore = Math.max(0, 100 - (kw.position - 1) * 10); // Position 1 = 100, 11+ = 0

  // Weighted average
  const index = (
    clicksScore * 0.35 +
    impressionsScore * 0.25 +
    ctrScore * 0.15 +
    positionScore * 0.25
  );

  return Math.round(index * 100) / 100;
}
