import type { Database } from 'sql.js';
import type { SerpResult, BrandMention, MentionType, Sentiment } from '../models/types.js';
import { upsertBrandMention } from '../db/repository.js';

/** Stage brand terms to monitor */
const BRAND_TERMS = [
  'stage',
  'stage app',
  'stage ott',
  'stageott',
  'stage.in',
  'stage films',
  'stage web series',
  'boliyon ki kranti', // Stage tagline
];

/** Competitor brand names for comparison detection */
const COMPETITOR_NAMES = [
  'mx player', 'mxplayer',
  'jiocinema', 'jio cinema',
  'zee5',
  'sonyliv', 'sony liv',
  'hotstar', 'disney+ hotstar',
];

/** Forum/community domains */
const FORUM_DOMAINS = ['reddit.com', 'quora.com', 'twitter.com', 'x.com', 'facebook.com'];
const NEWS_DOMAINS = ['ndtv.com', 'livemint.com', 'economictimes.com', 'techcrunch.com', 'entrackr.com', 'inc42.com', 'yourstory.com'];
const REVIEW_DOMAINS = ['techradar.com', 'gadgets360.com', 'beebom.com', 'ottplay.com', 'justwatch.com'];

/**
 * Scan SERP results for brand mentions of Stage.
 * Classifies each mention by type and sentiment.
 */
export function detectBrandMentions(db: Database, query: string, results: SerpResult[]): number {
  let mentionsFound = 0;

  for (const result of results) {
    const textToAnalyze = `${result.title} ${result.snippet}`.toLowerCase();
    const hasStageMention = BRAND_TERMS.some((term) => textToAnalyze.includes(term.toLowerCase()));

    if (!hasStageMention) continue;

    const mentionType = classifyMentionType(result, textToAnalyze);
    const sentiment = analyzeSentiment(textToAnalyze);

    upsertBrandMention(db, {
      query,
      domain: result.domain,
      url: result.url,
      title: result.title,
      snippet: result.snippet,
      mentionType,
      sentiment,
      detectedAt: result.fetchedAt,
    });

    mentionsFound++;
  }

  return mentionsFound;
}

function classifyMentionType(result: SerpResult, text: string): MentionType {
  const domain = result.domain.toLowerCase();

  // Check if it's a comparison/vs article
  const hasCompetitorMention = COMPETITOR_NAMES.some((name) => text.includes(name.toLowerCase()));
  if (hasCompetitorMention && (text.includes(' vs ') || text.includes('alternative') || text.includes('compare') || text.includes('better than'))) {
    return 'competitor_comparison';
  }

  // Check domain-based classification
  if (FORUM_DOMAINS.some((d) => domain.includes(d))) return 'forum';
  if (NEWS_DOMAINS.some((d) => domain.includes(d))) return 'news';
  if (REVIEW_DOMAINS.some((d) => domain.includes(d))) return 'review';

  // Check content-based classification
  if (text.includes('review') || text.includes('rating') || text.includes('worth it')) return 'review';
  if (text.includes('news') || text.includes('announce') || text.includes('launch')) return 'news';

  return 'direct';
}

function analyzeSentiment(text: string): Sentiment {
  const positiveSignals = [
    'best', 'great', 'amazing', 'excellent', 'love', 'top',
    'must watch', 'recommended', 'popular', 'trending', 'hit',
    'award', 'success', 'growing', 'million users',
  ];

  const negativeSignals = [
    'worst', 'bad', 'terrible', 'hate', 'avoid',
    'not working', 'bug', 'crash', 'scam', 'waste',
    'poor quality', 'disappointed', 'failing', 'shutdown',
  ];

  let positiveScore = 0;
  let negativeScore = 0;

  for (const signal of positiveSignals) {
    if (text.includes(signal)) positiveScore++;
  }
  for (const signal of negativeSignals) {
    if (text.includes(signal)) negativeScore++;
  }

  if (positiveScore > negativeScore) return 'positive';
  if (negativeScore > positiveScore) return 'negative';
  return 'neutral';
}

/**
 * Generate brand monitoring queries for SERP scanning.
 */
export function generateBrandQueries(): string[] {
  return [
    'stage app ott',
    'stage app review',
    'stage vs mx player',
    'stage vs jiocinema',
    'stage ott download',
    'stage regional web series',
    'stage app haryanvi',
    'stage app rajasthani',
    'stage app bhojpuri',
    'stage app gujarati',
    'best regional ott app india stage',
    '"stage app" review',
  ];
}
