import type { Dialect } from '../models/types.js';
import { DIALECTS } from '../models/types.js';

/**
 * Dialect keyword patterns for auto-detection.
 * Includes English transliterations, Hindi script names, and common content terms.
 */
const DIALECT_PATTERNS: Record<Dialect, RegExp[]> = {
  haryanvi: [
    /haryanvi/i,
    /haryani/i,
    /हरयाणवी/,
    /हरियाणवी/,
    /jaat/i,
    /tau /i,
    /sapna choudhary/i,
    /desi jaat/i,
    /haryana/i,
  ],
  rajasthani: [
    /rajasthani/i,
    /marwari/i,
    /राजस्थानी/,
    /मारवाड़ी/,
    /mewari/i,
    /shekhawati/i,
    /rajasthan/i,
    /padharo/i,
  ],
  bhojpuri: [
    /bhojpuri/i,
    /भोजपुरी/,
    /pawan singh/i,
    /khesari/i,
    /dinesh lal/i,
    /nirahua/i,
    /bhojpur/i,
    /gorakhpur/i,
  ],
  gujarati: [
    /gujarati/i,
    /gujrati/i,
    /ગુજરાતી/,
    /garba/i,
    /navratri/i,
    /gujarat/i,
    /kathiyawadi/i,
    /ahmedabad/i,
  ],
};

/**
 * Auto-detect dialect from a search query.
 * Uses pattern matching with confidence scoring.
 */
export function detectDialect(query: string): Dialect | null {
  const scores = new Map<Dialect, number>();

  for (const dialect of DIALECTS) {
    let score = 0;
    for (const pattern of DIALECT_PATTERNS[dialect]) {
      if (pattern.test(query)) {
        // Direct dialect name match = high confidence
        if (pattern.source.toLowerCase().includes(dialect)) {
          score += 10;
        } else {
          score += 3; // Related term match
        }
      }
    }
    if (score > 0) {
      scores.set(dialect, score);
    }
  }

  if (scores.size === 0) return null;

  // Return highest scoring dialect
  let bestDialect: Dialect | null = null;
  let bestScore = 0;
  for (const [dialect, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestDialect = dialect;
    }
  }

  return bestDialect;
}

/**
 * Get dialect distribution from a list of keywords.
 */
export function getDialectDistribution(queries: string[]): Record<string, number> {
  const distribution: Record<string, number> = { unclassified: 0 };

  for (const dialect of DIALECTS) {
    distribution[dialect] = 0;
  }

  for (const query of queries) {
    const dialect = detectDialect(query);
    if (dialect) {
      distribution[dialect]++;
    } else {
      distribution.unclassified++;
    }
  }

  return distribution;
}
