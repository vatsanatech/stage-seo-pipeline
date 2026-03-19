import type { LinkSuggestion, PageScore } from '../models/types.js';
import { LinkGraph } from './graph.js';

interface SuggestionOptions {
  maxSuggestionsPerPage?: number;
  orphanThreshold?: number;
  minPagerankForTarget?: number;
}

/**
 * Generate internal link suggestions based on graph analysis.
 *
 * Strategies:
 * 1. Link TO orphan pages from high-hub pages (rescue orphans)
 * 2. Link TO high-authority pages from pages that don't already link to them (boost important content)
 * 3. Link FROM dead-end pages to high-authority pages (fix dead ends)
 */
export function generateLinkSuggestions(
  graph: LinkGraph,
  scores: PageScore[],
  options: SuggestionOptions = {}
): LinkSuggestion[] {
  const {
    maxSuggestionsPerPage = 5,
    orphanThreshold = 1,
    minPagerankForTarget = 0,
  } = options;

  const suggestions: LinkSuggestion[] = [];
  const now = new Date().toISOString();

  const scoreMap = new Map(scores.map((s) => [s.url, s]));
  const existingLinks = new Set(
    graph.getEdges().map((e) => `${e.sourceUrl}::${e.targetUrl}`)
  );

  const sortedByAuthority = [...scores].sort((a, b) => b.authorityScore - a.authorityScore);
  const sortedByHub = [...scores].sort((a, b) => b.hubScore - a.hubScore);
  const topAuthorities = sortedByAuthority.slice(0, Math.ceil(scores.length * 0.2));
  const topHubs = sortedByHub.slice(0, Math.ceil(scores.length * 0.2));

  // Strategy 1: Rescue orphan pages by linking from top hubs
  const orphans = graph.findOrphanPages(orphanThreshold);
  for (const orphanUrl of orphans) {
    let count = 0;
    for (const hub of topHubs) {
      if (count >= maxSuggestionsPerPage) break;
      if (hub.url === orphanUrl) continue;
      const key = `${hub.url}::${orphanUrl}`;
      if (existingLinks.has(key)) continue;

      suggestions.push({
        sourceUrl: hub.url,
        targetUrl: orphanUrl,
        suggestedAnchorText: extractSlug(orphanUrl),
        reason: `Orphan page (${graph.getInboundCount(orphanUrl)} inbound links) — link from high-hub page to improve discoverability`,
        priority: 'high',
        createdAt: now,
      });
      existingLinks.add(key);
      count++;
    }
  }

  // Strategy 2: Dead-end pages should link to high-authority content
  const deadEnds = graph.findDeadEnds();
  for (const deadEndUrl of deadEnds) {
    let count = 0;
    for (const auth of topAuthorities) {
      if (count >= maxSuggestionsPerPage) break;
      if (auth.url === deadEndUrl) continue;
      const key = `${deadEndUrl}::${auth.url}`;
      if (existingLinks.has(key)) continue;

      suggestions.push({
        sourceUrl: deadEndUrl,
        targetUrl: auth.url,
        suggestedAnchorText: extractSlug(auth.url),
        reason: `Dead-end page (0 outbound links) — add links to high-authority pages to improve crawlability`,
        priority: 'medium',
        createdAt: now,
      });
      existingLinks.add(key);
      count++;
    }
  }

  // Strategy 3: Pages with low PageRank should link to/from high-authority pages
  const lowRankPages = [...scores]
    .filter((s) => s.pagerank > minPagerankForTarget)
    .sort((a, b) => a.pagerank - b.pagerank)
    .slice(0, Math.ceil(scores.length * 0.3));

  for (const page of lowRankPages) {
    let count = 0;
    for (const auth of topAuthorities) {
      if (count >= 2) break;
      if (auth.url === page.url) continue;

      // Suggest linking FROM high-authority TO low-rank (if not already linked)
      const key = `${auth.url}::${page.url}`;
      if (existingLinks.has(key)) continue;

      suggestions.push({
        sourceUrl: auth.url,
        targetUrl: page.url,
        suggestedAnchorText: extractSlug(page.url),
        reason: `Low PageRank page (${page.pagerank.toFixed(4)}) — link from high-authority page to distribute link equity`,
        priority: 'low',
        createdAt: now,
      });
      existingLinks.add(key);
      count++;
    }
  }

  return suggestions;
}

function extractSlug(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const slug = pathname.replace(/\/$/, '').split('/').pop() || '';
    return slug.replace(/[-_]/g, ' ').replace(/\.\w+$/, '') || 'home';
  } catch {
    return url.split('/').pop() || url;
  }
}
