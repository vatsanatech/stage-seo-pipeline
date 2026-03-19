import type { Database } from 'sql.js';
import type { KeywordRecord, KeywordTrend, TrendDirection } from '../models/types.js';
import { detectDialect } from './dialect-detector.js';

/** Thresholds for classifying keyword trends */
const RISING_THRESHOLD_PCT = 10;
const DECLINING_THRESHOLD_PCT = -10;

/**
 * Compare two periods of keyword data and identify rising/declining/new/lost keywords.
 */
export function analyzeTrends(
  currentPeriod: KeywordRecord[],
  previousPeriod: KeywordRecord[]
): KeywordTrend[] {
  const previousMap = new Map<string, KeywordRecord>();
  for (const kw of previousPeriod) {
    previousMap.set(kw.query, kw);
  }

  const currentMap = new Map<string, KeywordRecord>();
  for (const kw of currentPeriod) {
    currentMap.set(kw.query, kw);
  }

  const trends: KeywordTrend[] = [];

  // Check current keywords against previous
  for (const current of currentPeriod) {
    const previous = previousMap.get(current.query);

    if (!previous) {
      // New keyword (didn't exist in previous period)
      trends.push({
        query: current.query,
        dialect: detectDialect(current.query),
        direction: 'new',
        currentClicks: current.clicks,
        previousClicks: 0,
        clicksDelta: current.clicks,
        clicksDeltaPct: 100,
        currentImpressions: current.impressions,
        previousImpressions: 0,
        impressionsDelta: current.impressions,
        currentPosition: current.position,
        previousPosition: 0,
        positionDelta: 0,
        currentCtr: current.ctr,
        previousCtr: 0,
      });
      continue;
    }

    const clicksDelta = current.clicks - previous.clicks;
    const clicksDeltaPct = previous.clicks > 0
      ? (clicksDelta / previous.clicks) * 100
      : current.clicks > 0 ? 100 : 0;

    const direction = classifyDirection(clicksDeltaPct, current.clicks, previous.clicks);

    trends.push({
      query: current.query,
      dialect: detectDialect(current.query),
      direction,
      currentClicks: current.clicks,
      previousClicks: previous.clicks,
      clicksDelta,
      clicksDeltaPct: Math.round(clicksDeltaPct * 100) / 100,
      currentImpressions: current.impressions,
      previousImpressions: previous.impressions,
      impressionsDelta: current.impressions - previous.impressions,
      currentPosition: current.position,
      previousPosition: previous.position,
      positionDelta: Math.round((previous.position - current.position) * 100) / 100,
      currentCtr: current.ctr,
      previousCtr: previous.ctr,
    });
  }

  // Find lost keywords (existed in previous but not current)
  for (const previous of previousPeriod) {
    if (!currentMap.has(previous.query)) {
      trends.push({
        query: previous.query,
        dialect: detectDialect(previous.query),
        direction: 'lost',
        currentClicks: 0,
        previousClicks: previous.clicks,
        clicksDelta: -previous.clicks,
        clicksDeltaPct: -100,
        currentImpressions: 0,
        previousImpressions: previous.impressions,
        impressionsDelta: -previous.impressions,
        currentPosition: 0,
        previousPosition: previous.position,
        positionDelta: 0,
        currentCtr: 0,
        previousCtr: previous.ctr,
      });
    }
  }

  return trends;
}

function classifyDirection(deltaPct: number, currentClicks: number, previousClicks: number): TrendDirection {
  if (currentClicks === 0 && previousClicks === 0) return 'stable';
  if (deltaPct >= RISING_THRESHOLD_PCT) return 'rising';
  if (deltaPct <= DECLINING_THRESHOLD_PCT) return 'declining';
  return 'stable';
}

/**
 * Get summary stats from a set of trends.
 */
export function summarizeTrends(trends: KeywordTrend[]): {
  total: number;
  rising: number;
  declining: number;
  stable: number;
  new_: number;
  lost: number;
  topRising: KeywordTrend[];
  topDeclining: KeywordTrend[];
} {
  const rising = trends.filter((t) => t.direction === 'rising');
  const declining = trends.filter((t) => t.direction === 'declining');

  return {
    total: trends.length,
    rising: rising.length,
    declining: declining.length,
    stable: trends.filter((t) => t.direction === 'stable').length,
    new_: trends.filter((t) => t.direction === 'new').length,
    lost: trends.filter((t) => t.direction === 'lost').length,
    topRising: rising.sort((a, b) => b.clicksDelta - a.clicksDelta).slice(0, 10),
    topDeclining: declining.sort((a, b) => a.clicksDelta - b.clicksDelta).slice(0, 10),
  };
}
