import type { Database } from 'sql.js';
import type { LinkGraphEdge } from '../models/types.js';

export interface AnchorTextProfile {
  targetUrl: string;
  anchors: Array<{ text: string; sourceUrl: string }>;
  uniqueAnchors: number;
  totalLinks: number;
  genericAnchors: string[];
  topAnchor: string;
}

export interface AnchorTextReport {
  totalLinks: number;
  uniqueAnchorTexts: number;
  genericAnchorRate: number;
  emptyAnchorRate: number;
  profiles: AnchorTextProfile[];
  issues: AnchorTextIssue[];
}

export interface AnchorTextIssue {
  type: 'generic' | 'empty' | 'duplicate' | 'too_long' | 'keyword_stuffing';
  severity: 'critical' | 'warning' | 'info';
  url: string;
  anchorText: string;
  message: string;
}

const GENERIC_ANCHORS = new Set([
  'click here', 'here', 'read more', 'learn more', 'more',
  'link', 'this', 'page', 'website', 'site', 'go', 'visit',
  'check it out', 'see more', 'continue', 'details', 'info',
]);

/**
 * Analyze anchor text distribution for all edges in the database.
 */
export function analyzeAnchorTexts(db: Database): AnchorTextReport {
  const results = db.exec(
    'SELECT source_url, target_url, anchor_text FROM link_graph ORDER BY target_url'
  );

  if (!results.length) {
    return {
      totalLinks: 0,
      uniqueAnchorTexts: 0,
      genericAnchorRate: 0,
      emptyAnchorRate: 0,
      profiles: [],
      issues: [],
    };
  }

  const edges: Array<{ sourceUrl: string; targetUrl: string; anchorText: string }> = results[0].values.map((row: any[]) => ({
    sourceUrl: row[0] as string,
    targetUrl: row[1] as string,
    anchorText: row[2] as string,
  }));

  return analyzeEdges(edges);
}

/**
 * Analyze anchor text distribution from edge data directly.
 */
export function analyzeEdges(
  edges: Array<{ sourceUrl: string; targetUrl: string; anchorText: string }>
): AnchorTextReport {
  const issues: AnchorTextIssue[] = [];
  const allAnchors = new Set<string>();
  let emptyCount = 0;
  let genericCount = 0;

  // Group by target URL
  const byTarget = new Map<string, Array<{ text: string; sourceUrl: string }>>();

  for (const edge of edges) {
    const anchors = byTarget.get(edge.targetUrl) ?? [];
    anchors.push({ text: edge.anchorText, sourceUrl: edge.sourceUrl });
    byTarget.set(edge.targetUrl, anchors);

    const normalized = edge.anchorText.toLowerCase().trim();
    if (normalized) allAnchors.add(normalized);

    // Check for issues
    if (!normalized) {
      emptyCount++;
      issues.push({
        type: 'empty',
        severity: 'warning',
        url: edge.sourceUrl,
        anchorText: '',
        message: `Empty anchor text for link to ${edge.targetUrl}`,
      });
    } else if (GENERIC_ANCHORS.has(normalized)) {
      genericCount++;
      issues.push({
        type: 'generic',
        severity: 'warning',
        url: edge.sourceUrl,
        anchorText: edge.anchorText,
        message: `Generic anchor text "${edge.anchorText}" for link to ${edge.targetUrl}`,
      });
    } else if (edge.anchorText.length > 100) {
      issues.push({
        type: 'too_long',
        severity: 'info',
        url: edge.sourceUrl,
        anchorText: edge.anchorText.slice(0, 100) + '...',
        message: `Anchor text too long (${edge.anchorText.length} chars) for link to ${edge.targetUrl}`,
      });
    }
  }

  // Build profiles
  const profiles: AnchorTextProfile[] = [];
  for (const [targetUrl, anchors] of byTarget) {
    const uniqueTexts = new Set(anchors.map(a => a.text.toLowerCase().trim()).filter(Boolean));
    const generics = anchors
      .map(a => a.text.toLowerCase().trim())
      .filter(t => GENERIC_ANCHORS.has(t));

    // Check for over-optimized/duplicate anchor text
    const anchorCounts = new Map<string, number>();
    for (const a of anchors) {
      const norm = a.text.toLowerCase().trim();
      if (norm) anchorCounts.set(norm, (anchorCounts.get(norm) ?? 0) + 1);
    }

    for (const [text, count] of anchorCounts) {
      if (count >= 3 && count / anchors.length > 0.5) {
        issues.push({
          type: 'keyword_stuffing',
          severity: 'warning',
          url: targetUrl,
          anchorText: text,
          message: `Anchor text "${text}" used ${count}/${anchors.length} times (${Math.round(count / anchors.length * 100)}%) — may appear over-optimized`,
        });
      }
    }

    // Find top anchor
    let topAnchor = '';
    let topCount = 0;
    for (const [text, count] of anchorCounts) {
      if (count > topCount) {
        topCount = count;
        topAnchor = text;
      }
    }

    profiles.push({
      targetUrl,
      anchors,
      uniqueAnchors: uniqueTexts.size,
      totalLinks: anchors.length,
      genericAnchors: [...new Set(generics)],
      topAnchor,
    });
  }

  // Sort profiles by total links descending
  profiles.sort((a, b) => b.totalLinks - a.totalLinks);

  return {
    totalLinks: edges.length,
    uniqueAnchorTexts: allAnchors.size,
    genericAnchorRate: edges.length ? genericCount / edges.length : 0,
    emptyAnchorRate: edges.length ? emptyCount / edges.length : 0,
    profiles,
    issues,
  };
}

/**
 * Get all anchor texts pointing to a specific URL.
 */
export function getAnchorsForUrl(db: Database, targetUrl: string): Array<{ sourceUrl: string; anchorText: string }> {
  const results = db.exec(
    'SELECT source_url, anchor_text FROM link_graph WHERE target_url = ?',
    [targetUrl]
  );
  if (!results.length) return [];

  return results[0].values.map((row: any[]) => ({
    sourceUrl: row[0] as string,
    anchorText: row[1] as string,
  }));
}

/**
 * Get anchor text distribution (counts) for a specific target URL.
 */
export function getAnchorDistribution(db: Database, targetUrl: string): Map<string, number> {
  const anchors = getAnchorsForUrl(db, targetUrl);
  const dist = new Map<string, number>();

  for (const a of anchors) {
    const normalized = a.anchorText.toLowerCase().trim() || '(empty)';
    dist.set(normalized, (dist.get(normalized) ?? 0) + 1);
  }

  return dist;
}
