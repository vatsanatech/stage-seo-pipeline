import { getDatabase, saveDatabase, closeDatabase } from './db/schema.js';
import { upsertBacklink, getBacklinks, buildBacklinkProfile, insertBacklinkRun, getOpportunityCount } from './db/repository.js';
import { queryCcIndex, extractDomain } from './analyzers/commoncrawl-client.js';
import { findCompetitorLinkOpportunities, getStageSourceDomains, analyzeBacklinkGap } from './analyzers/opportunity-finder.js';
import { STAGE_DOMAINS, COMPETITOR_DOMAINS } from './models/types.js';
import type { Backlink, BacklinkProfile } from './models/types.js';

export interface AnalyzerOptions {
  dbPath?: string;
  collection?: string;
  limit?: number;
}

export interface AnalysisResult {
  stageProfile: BacklinkProfile;
  competitorProfiles: BacklinkProfile[];
  backlinkGap: Array<{ competitor: string; backlinkGap: number; domainGap: number }>;
  opportunitiesFound: number;
  totalOpportunities: number;
}

/**
 * Run the full backlink analysis pipeline:
 * 1. Query CommonCrawl for Stage backlinks
 * 2. Query CommonCrawl for competitor backlinks
 * 3. Build profiles and identify gaps
 * 4. Find link building opportunities
 */
export async function runAnalysis(opts: AnalyzerOptions = {}): Promise<AnalysisResult> {
  const { dbPath = 'backlinks.db', collection, limit = 100 } = opts;

  console.log('[Backlink] Starting backlink analysis...');
  const db = await getDatabase(dbPath);

  // Analyze Stage backlinks
  for (const domain of STAGE_DOMAINS) {
    console.log(`[Backlink] Querying CommonCrawl for ${domain}...`);
    const records = await queryCcIndex(domain, collection, limit);
    console.log(`[Backlink] Found ${records.length} records for ${domain}`);

    for (const record of records) {
      const sourceDomain = extractDomain(record.url);
      upsertBacklink(db, {
        targetDomain: domain,
        targetUrl: `https://${domain}/`,
        sourceDomain,
        sourceUrl: record.url,
        anchorText: '',
        crawlDate: record.timestamp,
        linkType: 'unknown',
        status: 'active',
      });
    }
  }

  // Analyze competitor backlinks
  for (const domain of COMPETITOR_DOMAINS) {
    console.log(`[Backlink] Querying CommonCrawl for ${domain}...`);
    const records = await queryCcIndex(domain, collection, limit);
    console.log(`[Backlink] Found ${records.length} records for ${domain}`);

    for (const record of records) {
      const sourceDomain = extractDomain(record.url);
      upsertBacklink(db, {
        targetDomain: domain,
        targetUrl: `https://${domain}/`,
        sourceDomain,
        sourceUrl: record.url,
        anchorText: '',
        crawlDate: record.timestamp,
        linkType: 'unknown',
        status: 'active',
      });
    }
  }

  // Build profiles
  const stageProfile = buildBacklinkProfile(db, STAGE_DOMAINS[0]);
  const competitorProfiles = COMPETITOR_DOMAINS.map((d) => buildBacklinkProfile(db, d));

  // Find opportunities
  const stageSourceDomains = getStageSourceDomains(db);
  let totalNewOpportunities = 0;

  for (const domain of COMPETITOR_DOMAINS) {
    const competitorBls = getBacklinks(db, domain);
    const found = findCompetitorLinkOpportunities(db, competitorBls, stageSourceDomains);
    totalNewOpportunities += found;
  }

  // Analyze gap
  const backlinkGap = analyzeBacklinkGap(stageProfile, competitorProfiles);

  // Record run
  insertBacklinkRun(db, {
    runAt: new Date().toISOString(),
    domainsAnalyzed: STAGE_DOMAINS.length + COMPETITOR_DOMAINS.length,
    totalBacklinksFound: stageProfile.totalBacklinks + competitorProfiles.reduce((s, p) => s + p.totalBacklinks, 0),
    newBacklinks: 0,
    lostBacklinks: 0,
    opportunitiesFound: totalNewOpportunities,
  });

  saveDatabase(db, dbPath);

  const totalOpportunities = getOpportunityCount(db);
  console.log(`[Backlink] Done. Stage: ${stageProfile.totalBacklinks} backlinks, Opportunities: ${totalNewOpportunities} new (${totalOpportunities} total)`);

  return { stageProfile, competitorProfiles, backlinkGap, opportunitiesFound: totalNewOpportunities, totalOpportunities };
}

/**
 * Run analysis with pre-loaded data (for testing).
 */
export async function runAnalysisWithData(
  stageBacklinks: Backlink[],
  competitorBacklinks: Backlink[],
  dbPath: string = ':memory:'
): Promise<AnalysisResult> {
  const db = await getDatabase(dbPath);

  for (const bl of stageBacklinks) { upsertBacklink(db, bl); }
  for (const bl of competitorBacklinks) { upsertBacklink(db, bl); }

  const stageProfile = buildBacklinkProfile(db, stageBacklinks[0]?.targetDomain || 'stage.in');
  const competitorDomains = [...new Set(competitorBacklinks.map((bl) => bl.targetDomain))];
  const competitorProfiles = competitorDomains.map((d) => buildBacklinkProfile(db, d));

  const stageSourceDomains = new Set(stageBacklinks.map((bl) => bl.sourceDomain));
  let totalNewOpportunities = 0;
  for (const domain of competitorDomains) {
    const bls = competitorBacklinks.filter((bl) => bl.targetDomain === domain);
    totalNewOpportunities += findCompetitorLinkOpportunities(db, bls, stageSourceDomains);
  }

  const backlinkGap = analyzeBacklinkGap(stageProfile, competitorProfiles);
  const totalOpportunities = getOpportunityCount(db);

  return { stageProfile, competitorProfiles, backlinkGap, opportunitiesFound: totalNewOpportunities, totalOpportunities };
}

export { getDatabase, saveDatabase, closeDatabase } from './db/schema.js';
export { queryCcIndex, extractDomain } from './analyzers/commoncrawl-client.js';
export { findCompetitorLinkOpportunities, analyzeBacklinkGap } from './analyzers/opportunity-finder.js';
export type { Backlink, BacklinkProfile, LinkOpportunity, BacklinkRun } from './models/types.js';
