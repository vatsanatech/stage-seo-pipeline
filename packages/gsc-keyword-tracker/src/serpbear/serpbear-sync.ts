import type { Database } from 'sql.js';
import type { KeywordRecord } from '../models/types.js';
import { upsertKeyword } from '../db/repository.js';
import { detectDialect } from '../analyzers/dialect-detector.js';
import type { SerpBearClient, SerpBearKeyword } from './serpbear-client.js';

/** Result of a SerpBear sync operation */
export interface SyncResult {
  domain: string;
  keywordsSynced: number;
  newKeywords: number;
  positionChanges: number;
  keywords: Array<{
    keyword: string;
    position: number;
    previousPosition: number;
    change: number;
  }>;
}

/**
 * Sync keyword positions from SerpBear into the keywords table.
 * Maps SerpBear position data to the same format as GSC data.
 */
export async function syncSerpBearKeywords(
  db: Database,
  client: SerpBearClient,
  targetDomain?: string
): Promise<SyncResult[]> {
  const domains = await client.getDomains();
  const results: SyncResult[] = [];

  for (const domain of domains) {
    // If target domain specified, only sync that one
    if (targetDomain && !domain.domain.includes(targetDomain)) continue;

    console.log(`[SerpBear] Syncing keywords for ${domain.domain}...`);

    const keywords = await client.getKeywords(domain.id);
    const syncResult = persistSerpBearKeywords(db, domain.domain, keywords);
    results.push(syncResult);

    console.log(`[SerpBear] Synced ${syncResult.keywordsSynced} keywords for ${domain.domain}`);
  }

  return results;
}

/**
 * Convert SerpBear keywords to KeywordRecords and persist them.
 */
export function persistSerpBearKeywords(
  db: Database,
  domain: string,
  serpBearKeywords: SerpBearKeyword[]
): SyncResult {
  const today = new Date().toISOString().split('T')[0];
  let newKeywords = 0;
  let positionChanges = 0;
  const keywordDetails: SyncResult['keywords'] = [];

  for (const sbk of serpBearKeywords) {
    const dialect = detectDialect(sbk.keyword);
    const change = sbk.previousPosition > 0
      ? sbk.previousPosition - sbk.position // Positive = improved
      : 0;

    if (sbk.previousPosition === 0) newKeywords++;
    if (change !== 0) positionChanges++;

    // Map to keyword record format
    const record: Omit<KeywordRecord, 'id' | 'fetchedAt'> = {
      query: sbk.keyword,
      dialect,
      clicks: 0, // SerpBear doesn't track clicks
      impressions: 0,
      ctr: 0,
      position: sbk.position,
      date: today,
      device: sbk.device?.toLowerCase() || 'all',
      country: sbk.country?.toLowerCase() || 'ind',
    };

    upsertKeyword(db, record);

    keywordDetails.push({
      keyword: sbk.keyword,
      position: sbk.position,
      previousPosition: sbk.previousPosition,
      change,
    });
  }

  return {
    domain,
    keywordsSynced: serpBearKeywords.length,
    newKeywords,
    positionChanges,
    keywords: keywordDetails.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)),
  };
}

/**
 * Convert SerpBear history to trend snapshots for trajectory tracking.
 */
export function convertHistoryToSnapshots(
  keyword: string,
  history: Array<{ date: string; position: number }>
): Array<{ query: string; position: number; periodStart: string; periodEnd: string }> {
  return history.map((h) => ({
    query: keyword,
    position: h.position,
    periodStart: h.date,
    periodEnd: h.date,
  }));
}
