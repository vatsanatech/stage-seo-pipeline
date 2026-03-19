import type { Database } from 'sql.js';
import type { GraphStats, LinkGraphEdge, PageScore, OrphanPage, LinkSuggestion } from '../models/types.js';
import { LinkGraph } from './graph.js';
import { generateLinkSuggestions } from './suggestions.js';
import { getAllEdges, insertEdges, upsertPageScore, insertSuggestion } from '../db/repository.js';

export interface AnalysisResult {
  stats: GraphStats;
  scores: PageScore[];
  orphanPages: OrphanPage[];
  suggestions: LinkSuggestion[];
}

export function analyzeGraph(db: Database): AnalysisResult {
  const edges = getAllEdges(db);
  const graph = new LinkGraph();
  graph.buildFromEdges(edges);

  const scores = graph.computeAllScores();

  // Persist scores
  for (const score of scores) {
    upsertPageScore(db, score);
  }

  // Find orphan pages (0 or 1 inbound links, excluding homepage-like patterns)
  const orphanUrls = graph.findOrphanPages(1);
  const orphanPages: OrphanPage[] = orphanUrls.map((url) => {
    const inbound = graph.getInboundCount(url);
    let reason = 'No inbound links — completely orphaned';
    if (inbound === 1) reason = 'Only 1 inbound link — weakly connected';
    return { url, inboundLinks: inbound, reason };
  });

  // Generate link suggestions
  const suggestions = generateLinkSuggestions(graph, scores);

  // Persist suggestions
  for (const suggestion of suggestions) {
    insertSuggestion(db, suggestion);
  }

  // Compute stats
  const sortedByPagerank = [...scores].sort((a, b) => b.pagerank - a.pagerank);
  const sortedByAuthority = [...scores].sort((a, b) => b.authorityScore - a.authorityScore);
  const sortedByHub = [...scores].sort((a, b) => b.hubScore - a.hubScore);

  const totalInbound = scores.reduce((sum, s) => sum + s.inboundLinks, 0);
  const totalOutbound = scores.reduce((sum, s) => sum + s.outboundLinks, 0);

  const stats: GraphStats = {
    totalPages: scores.length,
    totalLinks: edges.length,
    orphanPages: orphanPages.length,
    avgInboundLinks: scores.length ? totalInbound / scores.length : 0,
    avgOutboundLinks: scores.length ? totalOutbound / scores.length : 0,
    maxPagerank: sortedByPagerank.length
      ? { url: sortedByPagerank[0].url, score: sortedByPagerank[0].pagerank }
      : { url: '', score: 0 },
    topAuthorities: sortedByAuthority.slice(0, 10),
    topHubs: sortedByHub.slice(0, 10),
  };

  return { stats, scores, orphanPages, suggestions };
}

/**
 * Import crawled link data into the database.
 */
export function importLinks(db: Database, edges: LinkGraphEdge[]): number {
  insertEdges(db, edges);
  return edges.length;
}
