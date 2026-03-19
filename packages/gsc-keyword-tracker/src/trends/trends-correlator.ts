import type { Database } from 'sql.js';
import type { KeywordTrend, TrendSnapshot } from '../models/types.js';
import { getTrendSnapshots } from '../db/repository.js';
import { generateGoogleTrendsSnapshots } from '../analyzers/snapshot-generator.js';

/** Correlation between GSC keyword performance and Google Trends interest */
export interface TrendsCorrelation {
  keyword: string;
  gscClicks: number;
  gscPosition: number;
  trendsInterest: number;
  correlationType: 'aligned' | 'divergent_opportunity' | 'divergent_declining' | 'insufficient_data';
  insight: string;
}

/**
 * Correlate GSC keyword data with Google Trends interest.
 * Identifies opportunities where trends interest is high but GSC performance is low.
 */
export function correlateTrendsWithGsc(
  db: Database,
  gscTrends: KeywordTrend[],
  trendsData: Map<string, number>
): TrendsCorrelation[] {
  const correlations: TrendsCorrelation[] = [];

  for (const trend of gscTrends) {
    const trendsInterest = trendsData.get(trend.query);
    if (trendsInterest === undefined) continue;

    const correlation = classifyCorrelation(trend, trendsInterest);
    correlations.push(correlation);
  }

  return correlations.sort((a, b) => {
    // Divergent opportunities first (high trends interest, low GSC)
    const order: Record<string, number> = {
      divergent_opportunity: 0,
      divergent_declining: 1,
      aligned: 2,
      insufficient_data: 3,
    };
    return (order[a.correlationType] ?? 4) - (order[b.correlationType] ?? 4);
  });
}

/**
 * Persist Google Trends interest data as snapshots.
 */
export function persistTrendsData(
  db: Database,
  trendsData: Map<string, number>,
  periodStart: string,
  periodEnd: string
): number {
  const items: Array<{ query: string; interest: number }> = [];
  for (const [query, interest] of trendsData) {
    items.push({ query, interest });
  }
  return generateGoogleTrendsSnapshots(db, items, periodStart, periodEnd);
}

/**
 * Generate regional keyword suggestions based on Google Trends data.
 */
export function generateRegionalSuggestions(
  trendsData: Map<string, number>,
  dialect: string
): Array<{ keyword: string; interest: number; suggestion: string }> {
  const suggestions: Array<{ keyword: string; interest: number; suggestion: string }> = [];

  for (const [keyword, interest] of trendsData) {
    if (interest >= 50) {
      suggestions.push({
        keyword,
        interest,
        suggestion: `High regional interest (${interest}/100) for "${keyword}" in ${dialect} market. Consider creating targeted content.`,
      });
    }
  }

  return suggestions.sort((a, b) => b.interest - a.interest);
}

function classifyCorrelation(trend: KeywordTrend, trendsInterest: number): TrendsCorrelation {
  const gscPerformanceScore = computeGscScore(trend);

  // High trends interest + low GSC = opportunity
  if (trendsInterest >= 50 && gscPerformanceScore < 30) {
    return {
      keyword: trend.query,
      gscClicks: trend.currentClicks,
      gscPosition: trend.currentPosition,
      trendsInterest,
      correlationType: 'divergent_opportunity',
      insight: `Google Trends shows high interest (${trendsInterest}/100) but GSC performance is low (position ${trend.currentPosition.toFixed(1)}, ${trend.currentClicks} clicks). Opportunity to optimize content.`,
    };
  }

  // Low trends interest + declining GSC = seasonal/declining topic
  if (trendsInterest < 30 && trend.direction === 'declining') {
    return {
      keyword: trend.query,
      gscClicks: trend.currentClicks,
      gscPosition: trend.currentPosition,
      trendsInterest,
      correlationType: 'divergent_declining',
      insight: `Both Google Trends (${trendsInterest}/100) and GSC show decline. Topic may be seasonal or losing relevance.`,
    };
  }

  // Generally aligned
  return {
    keyword: trend.query,
    gscClicks: trend.currentClicks,
    gscPosition: trend.currentPosition,
    trendsInterest,
    correlationType: 'aligned',
    insight: `GSC and Trends data are aligned. Trends interest: ${trendsInterest}/100, clicks: ${trend.currentClicks}.`,
  };
}

function computeGscScore(trend: KeywordTrend): number {
  // Normalize GSC performance to 0-100
  const clicksScore = Math.min(trend.currentClicks / 5, 100); // 500+ = 100
  const positionScore = Math.max(0, 100 - (trend.currentPosition - 1) * 10);
  return (clicksScore * 0.6 + positionScore * 0.4);
}
