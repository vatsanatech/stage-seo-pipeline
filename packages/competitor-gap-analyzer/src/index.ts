import type { Database } from 'sql.js';
import { getDatabase, saveDatabase, closeDatabase } from './db/schema.js';
import { getContentSuggestions, getSuggestionsByPriority, insertGapAnalysisRun, getSuggestionCount } from './db/repository.js';
import { batchScrape } from './analyzers/serp-scraper.js';
import { analyzeKeywordGap, processGapIntoSuggestions, persistSerpSnapshot } from './analyzers/gap-detector.js';
import { generateKeywordSeeds } from './utils/keywords.js';
import type { KeywordSeed } from './models/types.js';

export interface AnalyzerOptions {
  dbPath?: string;
  maxKeywords?: number;
  dryRun?: boolean;
}

export interface AnalysisResult {
  keywordsAnalyzed: number;
  gapsFound: number;
  suggestionsCreated: number;
  totalSuggestions: number;
  byPriority: Record<string, number>;
}

/**
 * Run the full competitor gap analysis pipeline:
 * 1. Generate keyword seeds
 * 2. Scrape SERP for each keyword
 * 3. Detect gaps where competitors rank but Stage doesn't
 * 4. Create content suggestions from gaps
 * 5. Persist everything to SQLite
 */
export async function runAnalysis(opts: AnalyzerOptions = {}): Promise<AnalysisResult> {
  const { dbPath = 'competitor_gaps.db', maxKeywords, dryRun = false } = opts;

  console.log('[Analyzer] Starting competitor gap analysis...');

  const db = await getDatabase(dbPath);
  let seeds = generateKeywordSeeds();

  if (maxKeywords && maxKeywords < seeds.length) {
    // Prioritize: critical brand keywords first, then dialect-specific
    seeds = prioritizeSeeds(seeds).slice(0, maxKeywords);
  }

  console.log(`[Analyzer] Analyzing ${seeds.length} keywords...`);

  const queries = seeds.map((s) => s.keyword);
  const serpResults = dryRun ? new Map() : await batchScrape(queries);

  let gapsFound = 0;
  let suggestionsCreated = 0;

  for (const seed of seeds) {
    const results = serpResults.get(seed.keyword) || [];

    // Persist SERP snapshot
    if (results.length > 0) {
      persistSerpSnapshot(db, results);
    }

    // Analyze gap
    const presence = analyzeKeywordGap(seed.keyword, results);

    if (!presence.stagePresent || (presence.stagePosition && presence.stagePosition > 5)) {
      if (presence.competitorResults.length > 0) {
        gapsFound++;
        suggestionsCreated += processGapIntoSuggestions(db, presence);
      }
    }
  }

  // Record the analysis run
  const dialectsCovered = [...new Set(seeds.filter((s) => s.dialect).map((s) => s.dialect!))];
  insertGapAnalysisRun(db, {
    runAt: new Date().toISOString(),
    keywordsAnalyzed: seeds.length,
    gapsFound,
    suggestionsCreated,
    dialectsCovered: JSON.stringify(dialectsCovered),
    competitorsCovered: JSON.stringify(['mxplayer.in', 'jiocinema.com', 'zee5.com', 'sonyliv.com', 'hotstar.com']),
  });

  saveDatabase(db, dbPath);

  const totalSuggestions = getSuggestionCount(db);
  const byPriority = getSuggestionsByPriority(db);

  console.log(`[Analyzer] Done. Gaps: ${gapsFound}, Suggestions created: ${suggestionsCreated}, Total: ${totalSuggestions}`);

  return { keywordsAnalyzed: seeds.length, gapsFound, suggestionsCreated, totalSuggestions, byPriority };
}

/** Get all current suggestions from the database */
export async function getSuggestions(
  dbPath: string = 'competitor_gaps.db',
  filters?: { dialect?: string; priority?: string; status?: string; gapSource?: string }
) {
  const db = await getDatabase(dbPath);
  return getContentSuggestions(db, filters);
}

function prioritizeSeeds(seeds: KeywordSeed[]): KeywordSeed[] {
  return seeds.sort((a, b) => {
    // Brand keywords first
    if (a.category === 'brand' && b.category !== 'brand') return -1;
    if (b.category === 'brand' && a.category !== 'brand') return 1;
    // Then dialect-specific
    if (a.dialect && !b.dialect) return -1;
    if (b.dialect && !a.dialect) return 1;
    // Then transactional intent
    if (a.searchIntent === 'transactional' && b.searchIntent !== 'transactional') return -1;
    if (b.searchIntent === 'transactional' && a.searchIntent !== 'transactional') return 1;
    return 0;
  });
}

export { getDatabase, saveDatabase, closeDatabase } from './db/schema.js';
export { trackPositions, getPositionSummary } from './analyzers/serp-tracker.js';
export { detectBrandMentions, generateBrandQueries } from './analyzers/brand-monitor.js';
export { findUnlinkedMentions, createMentionAlert, buildMentionAlertPayload } from './analyzers/mention-alerter.js';
export type { ContentSuggestion, SerpResult, CompetitorPresence, GapAnalysisRun, CompetitorPosition, BrandMention, PositionChange } from './models/types.js';
export type { UnlinkedMention, MentionAlert } from './analyzers/mention-alerter.js';
