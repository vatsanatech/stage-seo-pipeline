import type { Dialect, KeywordSeed } from '../models/types.js';
import { DIALECTS } from '../models/types.js';

/**
 * Generate keyword seeds for competitor gap analysis.
 * These are OTT-focused keywords relevant to Stage's regional content.
 */
export function generateKeywordSeeds(): KeywordSeed[] {
  const seeds: KeywordSeed[] = [];

  // Dialect-specific content keywords
  const dialectContentPatterns = [
    { template: '{dialect} web series', category: 'content', intent: 'navigational' as const },
    { template: '{dialect} movies online', category: 'content', intent: 'transactional' as const },
    { template: '{dialect} short films', category: 'content', intent: 'navigational' as const },
    { template: '{dialect} comedy shows', category: 'content', intent: 'navigational' as const },
    { template: '{dialect} drama series', category: 'content', intent: 'navigational' as const },
    { template: '{dialect} romantic movies', category: 'content', intent: 'navigational' as const },
    { template: '{dialect} action movies', category: 'content', intent: 'navigational' as const },
    { template: '{dialect} horror web series', category: 'content', intent: 'navigational' as const },
    { template: 'best {dialect} web series 2024', category: 'content', intent: 'informational' as const },
    { template: 'new {dialect} movies', category: 'content', intent: 'navigational' as const },
    { template: '{dialect} web series free', category: 'content', intent: 'transactional' as const },
    { template: 'watch {dialect} movies online', category: 'content', intent: 'transactional' as const },
    { template: '{dialect} OTT platform', category: 'platform', intent: 'navigational' as const },
    { template: '{dialect} streaming app', category: 'platform', intent: 'navigational' as const },
    { template: '{dialect} entertainment', category: 'content', intent: 'informational' as const },
  ];

  for (const dialect of DIALECTS) {
    for (const pattern of dialectContentPatterns) {
      seeds.push({
        keyword: pattern.template.replace('{dialect}', dialect),
        dialect,
        category: pattern.category,
        searchIntent: pattern.intent,
      });
    }
  }

  // Generic OTT competitive keywords (no specific dialect)
  const genericKeywords: Omit<KeywordSeed, 'dialect'>[] = [
    { keyword: 'regional language OTT India', category: 'platform', searchIntent: 'informational' },
    { keyword: 'Indian regional web series', category: 'content', searchIntent: 'navigational' },
    { keyword: 'desi web series online free', category: 'content', searchIntent: 'transactional' },
    { keyword: 'Hindi dubbed regional movies', category: 'content', searchIntent: 'navigational' },
    { keyword: 'micro drama app India', category: 'platform', searchIntent: 'navigational' },
    { keyword: 'short form video India OTT', category: 'content', searchIntent: 'informational' },
    { keyword: 'free OTT app India', category: 'platform', searchIntent: 'transactional' },
    { keyword: 'best OTT for regional content', category: 'platform', searchIntent: 'informational' },
    { keyword: 'stage app web series', category: 'brand', searchIntent: 'navigational' },
    { keyword: 'stage OTT', category: 'brand', searchIntent: 'navigational' },
  ];

  for (const kw of genericKeywords) {
    seeds.push({ ...kw, dialect: null });
  }

  return seeds;
}

/** Detect dialect from keyword or content text */
export function detectDialect(text: string): Dialect | null {
  const lower = text.toLowerCase();
  for (const dialect of DIALECTS) {
    if (lower.includes(dialect)) return dialect;
  }
  // Check Hindi-script dialect names
  const dialectMap: Record<string, Dialect> = {
    'हरयाणवी': 'haryanvi',
    'राजस्थानी': 'rajasthani',
    'भोजपुरी': 'bhojpuri',
    'गुजराती': 'gujarati',
  };
  for (const [hindiName, dialect] of Object.entries(dialectMap)) {
    if (lower.includes(hindiName)) return dialect;
  }
  return null;
}
