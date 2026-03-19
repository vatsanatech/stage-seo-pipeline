import type { Database } from 'sql.js';
import type { Backlink, LinkOpportunity } from '../models/types.js';
import { STAGE_DOMAINS, COMPETITOR_DOMAINS } from '../models/types.js';
import { upsertOpportunity } from '../db/repository.js';

/**
 * Find link building opportunities by analyzing competitor backlinks.
 * Identifies sites linking to competitors but not to Stage.
 */
export function findCompetitorLinkOpportunities(
  db: Database,
  competitorBacklinks: Backlink[],
  stageSourceDomains: Set<string>
): number {
  let found = 0;

  for (const bl of competitorBacklinks) {
    // Skip if Stage already has a link from this source domain
    if (stageSourceDomains.has(bl.sourceDomain)) continue;

    // Skip low-value sources
    if (isLowValueSource(bl.sourceDomain)) continue;

    const priority = classifyOpportunityPriority(bl);

    upsertOpportunity(db, {
      sourceDomain: bl.sourceDomain,
      sourceUrl: bl.sourceUrl,
      competitorDomain: bl.targetDomain,
      competitorUrl: bl.targetUrl,
      anchorText: bl.anchorText,
      opportunityType: 'competitor_link',
      priority,
      status: 'new',
      notes: `Competitor ${bl.targetDomain} has backlink from ${bl.sourceDomain}. Stage could target this site.`,
    });
    found++;
  }

  return found;
}

/**
 * Get the set of source domains that already link to Stage.
 */
export function getStageSourceDomains(db: Database): Set<string> {
  const domains = new Set<string>();

  for (const stageDomain of STAGE_DOMAINS) {
    const stmt = db.prepare(
      'SELECT DISTINCT source_domain FROM backlinks WHERE target_domain = ?'
    );
    stmt.bind([stageDomain]);
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      domains.add(row.source_domain as string);
    }
    stmt.free();
  }

  return domains;
}

/**
 * Analyze backlink gap between Stage and competitors.
 */
export function analyzeBacklinkGap(
  stageProfile: { totalBacklinks: number; uniqueSourceDomains: number },
  competitorProfiles: Array<{ domain: string; totalBacklinks: number; uniqueSourceDomains: number }>
): Array<{ competitor: string; backlinkGap: number; domainGap: number }> {
  return competitorProfiles
    .map((cp) => ({
      competitor: cp.domain,
      backlinkGap: cp.totalBacklinks - stageProfile.totalBacklinks,
      domainGap: cp.uniqueSourceDomains - stageProfile.uniqueSourceDomains,
    }))
    .sort((a, b) => b.backlinkGap - a.backlinkGap);
}

function classifyOpportunityPriority(bl: Backlink): 'high' | 'medium' | 'low' {
  // High value sources
  const highValuePatterns = [
    /news/i, /times/i, /ndtv/i, /mint/i, /economic/i,
    /techcrunch/i, /yourstory/i, /inc42/i, /entrackr/i,
    /gadgets360/i, /beebom/i, /ottplay/i,
    /\.edu/i, /\.gov/i, /\.ac\./i,
  ];

  if (highValuePatterns.some((p) => p.test(bl.sourceDomain) || p.test(bl.sourceUrl))) {
    return 'high';
  }

  // Dofollow links are more valuable
  if (bl.linkType === 'dofollow') return 'medium';

  return 'low';
}

function isLowValueSource(domain: string): boolean {
  const lowValue = [
    'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'pinterest.com',
    'linkedin.com', 'youtube.com', 'reddit.com', 'quora.com',
    'web.archive.org', 'archive.org',
    'google.com', 'bing.com', 'yahoo.com',
  ];
  return lowValue.some((lv) => domain.includes(lv));
}
