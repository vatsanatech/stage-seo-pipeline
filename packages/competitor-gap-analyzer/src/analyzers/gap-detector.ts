import type { Database } from 'sql.js';
import type { SerpResult, ContentSuggestion, CompetitorPresence, GapSource, Priority, ContentType, Dialect } from '../models/types.js';
import { isCompetitorDomain, isStageDomain } from './serp-scraper.js';
import { upsertContentSuggestion, upsertSerpResult } from '../db/repository.js';
import { detectDialect } from '../utils/keywords.js';

/**
 * Analyze SERP results for a keyword and detect competitor gaps.
 * A gap exists when competitors rank but Stage doesn't.
 */
export function analyzeKeywordGap(query: string, results: SerpResult[]): CompetitorPresence {
  const competitorResults = results.filter((r) => isCompetitorDomain(r.domain));
  const stageResult = results.find((r) => isStageDomain(r.domain));

  return {
    keyword: query,
    dialect: detectDialect(query),
    competitorResults,
    stagePresent: !!stageResult,
    stagePosition: stageResult ? stageResult.position : null,
  };
}

/**
 * Convert a competitor presence gap into content suggestions and persist them.
 */
export function processGapIntoSuggestions(
  db: Database,
  presence: CompetitorPresence
): number {
  // No gap if Stage is already present and ranking well
  if (presence.stagePresent && presence.stagePosition !== null && presence.stagePosition <= 5) {
    return 0;
  }

  // No gap if no competitors are ranking either
  if (presence.competitorResults.length === 0) {
    return 0;
  }

  const gapSource = determineGapSource(presence);
  const priority = determinePriority(presence);
  const contentType = inferContentType(presence.keyword, presence.competitorResults);
  const bestPosition = Math.min(...presence.competitorResults.map((r) => r.position));

  const competitorUrls = JSON.stringify(presence.competitorResults.map((r) => r.url));
  const competitorDomains = JSON.stringify([...new Set(presence.competitorResults.map((r) => r.domain))]);

  const suggestion: Omit<ContentSuggestion, 'id' | 'createdAt' | 'updatedAt'> = {
    keyword: presence.keyword,
    dialect: presence.dialect,
    suggestedContentType: contentType,
    gapSource,
    competitorUrls,
    competitorDomains,
    title: generateSuggestionTitle(presence, contentType),
    description: generateSuggestionDescription(presence, contentType),
    priority,
    status: 'new',
    estimatedSearchVolume: estimateSearchVolume(presence),
    stageCurrentPosition: presence.stagePosition,
    bestCompetitorPosition: bestPosition,
  };

  upsertContentSuggestion(db, suggestion);
  return 1;
}

/**
 * Persist SERP results to the snapshot table for historical tracking.
 */
export function persistSerpSnapshot(db: Database, results: SerpResult[]): void {
  for (const result of results) {
    upsertSerpResult(db, result);
  }
}

function determineGapSource(presence: CompetitorPresence): GapSource {
  if (!presence.stagePresent && presence.competitorResults.length >= 2) {
    return 'serp_gap'; // Multiple competitors rank, Stage doesn't
  }
  if (!presence.stagePresent && presence.competitorResults.length === 1) {
    return 'keyword_gap'; // Single competitor owns this keyword
  }
  if (presence.stagePresent && presence.stagePosition && presence.stagePosition > 10) {
    return 'serp_gap'; // Stage ranks too low
  }
  if (presence.dialect) {
    return 'dialect_gap'; // Dialect-specific gap
  }
  return 'content_type_gap';
}

function determinePriority(presence: CompetitorPresence): Priority {
  const competitorCount = presence.competitorResults.length;
  const bestCompPosition = competitorCount > 0
    ? Math.min(...presence.competitorResults.map((r) => r.position))
    : 100;

  // Critical: multiple competitors in top 3, Stage absent
  if (!presence.stagePresent && competitorCount >= 2 && bestCompPosition <= 3) {
    return 'critical';
  }
  // High: competitor in top 5, Stage absent
  if (!presence.stagePresent && bestCompPosition <= 5) {
    return 'high';
  }
  // High: Stage present but outranked badly
  if (presence.stagePresent && presence.stagePosition && presence.stagePosition > 10 && bestCompPosition <= 3) {
    return 'high';
  }
  // Medium: competitor ranking, Stage either absent or below page 1
  if (competitorCount >= 1 && bestCompPosition <= 10) {
    return 'medium';
  }
  return 'low';
}

function inferContentType(keyword: string, competitorResults: SerpResult[]): ContentType {
  const lower = keyword.toLowerCase();
  const allText = (keyword + ' ' + competitorResults.map((r) => r.title + ' ' + r.snippet).join(' ')).toLowerCase();

  if (allText.includes('web series') || allText.includes('series') || allText.includes('show') || allText.includes('episode')) {
    return 'show';
  }
  if (allText.includes('short') || allText.includes('micro') || allText.includes('reel') || allText.includes('vertical')) {
    return 'micro_drama';
  }
  if (allText.includes('movie') || allText.includes('film')) {
    return 'movie';
  }
  // Default based on keyword patterns
  if (lower.includes('series') || lower.includes('show')) return 'show';
  if (lower.includes('movie') || lower.includes('film')) return 'movie';
  return 'show'; // Default to show for OTT
}

function generateSuggestionTitle(presence: CompetitorPresence, contentType: ContentType): string {
  const typeLabel = contentType === 'show' ? 'Web Series' : contentType === 'movie' ? 'Movie' : 'Micro Drama';
  const dialectLabel = presence.dialect ? ` (${capitalize(presence.dialect)})` : '';
  return `${typeLabel} content gap: "${presence.keyword}"${dialectLabel}`;
}

function generateSuggestionDescription(presence: CompetitorPresence, contentType: ContentType): string {
  const competitors = [...new Set(presence.competitorResults.map((r) => r.domain))];
  const positions = presence.competitorResults.map((r) => `${r.domain} (#${r.position})`).join(', ');

  let desc = `Competitors ranking for "${presence.keyword}": ${positions}. `;
  if (!presence.stagePresent) {
    desc += 'Stage has NO presence for this keyword. ';
  } else {
    desc += `Stage ranks at position #${presence.stagePosition}. `;
  }
  desc += `Opportunity to create ${contentType.replace('_', ' ')} content targeting this keyword`;
  if (presence.dialect) {
    desc += ` in ${capitalize(presence.dialect)} dialect`;
  }
  desc += '.';
  return desc;
}

function estimateSearchVolume(presence: CompetitorPresence): number | null {
  // Rough heuristic: more competitors ranking = higher volume
  const competitorCount = presence.competitorResults.length;
  if (competitorCount >= 3) return 5000;
  if (competitorCount >= 2) return 2000;
  if (competitorCount >= 1) return 500;
  return null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
