import type { Database } from 'sql.js';
import type { SerpResult, CompetitorPosition, PositionChange } from '../models/types.js';
import { isCompetitorDomain, isStageDomain } from './serp-scraper.js';
import { insertCompetitorPosition, comparePositions } from '../db/repository.js';

/**
 * Track SERP positions for Stage and competitors over time.
 * Call this after scraping SERP results to build time-series position data.
 */
export function trackPositions(db: Database, keyword: string, results: SerpResult[], trackedAt: string): number {
  let tracked = 0;

  for (const result of results) {
    const isStage = isStageDomain(result.domain);
    const isCompetitor = isCompetitorDomain(result.domain);

    // Track Stage and competitor positions
    if (isStage || isCompetitor) {
      insertCompetitorPosition(db, {
        keyword,
        domain: result.domain,
        position: result.position,
        url: result.url,
        title: result.title,
        isStage,
        isCompetitor,
        trackedAt,
      });
      tracked++;
    }
  }

  return tracked;
}

/**
 * Get a summary of position changes for all tracked keywords.
 */
export function getPositionSummary(
  db: Database,
  currentDate: string,
  previousDate: string,
  keywords: string[]
): {
  stageImproved: PositionChange[];
  stageDropped: PositionChange[];
  competitorGains: PositionChange[];
  competitorLosses: PositionChange[];
} {
  const stageImproved: PositionChange[] = [];
  const stageDropped: PositionChange[] = [];
  const competitorGains: PositionChange[] = [];
  const competitorLosses: PositionChange[] = [];

  for (const keyword of keywords) {
    const changes = comparePositions(db, keyword, currentDate, previousDate);

    for (const change of changes) {
      if (isStageDomain(change.domain)) {
        if (change.direction === 'improved') stageImproved.push(change);
        else if (change.direction === 'dropped') stageDropped.push(change);
      } else if (isCompetitorDomain(change.domain)) {
        if (change.direction === 'improved') competitorGains.push(change);
        else if (change.direction === 'dropped') competitorLosses.push(change);
      }
    }
  }

  return {
    stageImproved: stageImproved.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)),
    stageDropped: stageDropped.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)),
    competitorGains: competitorGains.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)),
    competitorLosses: competitorLosses.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)),
  };
}
