import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

const CC_INDEX_URL = 'https://index.commoncrawl.org';
const DEFAULT_COLLECTION = 'CC-MAIN-2025-08'; // Recent crawl
const REQUEST_TIMEOUT_MS = 30_000;

/** CommonCrawl Index API response record */
export interface CcRecord {
  urlkey: string;
  timestamp: string;
  url: string;
  mime: string;
  status: string;
  digest: string;
  length: string;
  offset: string;
  filename: string;
}

/**
 * Query CommonCrawl Index API for pages that link to a domain.
 * Uses the URL-based index to find pages containing links to the target.
 */
export async function queryCcIndex(
  targetDomain: string,
  collection: string = DEFAULT_COLLECTION,
  limit: number = 100
): Promise<CcRecord[]> {
  // CommonCrawl index searches by URL key (reversed domain)
  const urlKey = reverseHost(targetDomain);
  const params = new URLSearchParams({
    url: `*.${targetDomain}/*`,
    output: 'json',
    limit: String(limit),
    fl: 'urlkey,timestamp,url,mime,status,digest,length,offset,filename',
  });

  const url = `${CC_INDEX_URL}/${collection}-index?${params.toString()}`;

  try {
    const response = await fetchUrl(url);
    if (!response.trim()) return [];

    // CC Index returns NDJSON (newline-delimited JSON)
    return response
      .trim()
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as CcRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is CcRecord => r !== null);
  } catch (err) {
    console.error(`[CC] Failed to query index for "${targetDomain}":`, (err as Error).message);
    return [];
  }
}

/**
 * Get available CommonCrawl collections (most recent first).
 */
export async function getCollections(): Promise<string[]> {
  try {
    const response = await fetchUrl(`${CC_INDEX_URL}/collinfo.json`);
    const collections = JSON.parse(response) as Array<{ id: string }>;
    return collections.map((c) => c.id);
  } catch {
    return [DEFAULT_COLLECTION];
  }
}

/**
 * Extract domain from a URL.
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    // Fallback for malformed URLs
    const match = url.match(/https?:\/\/(?:www\.)?([^/]+)/);
    return match ? match[1] : url;
  }
}

function reverseHost(domain: string): string {
  return domain.split('.').reverse().join(',');
}

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const doRequest = isHttps ? httpsRequest : httpRequest;
    const parsed = new URL(url);

    const req = doRequest(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'StageOTT-BacklinkAnalyzer/1.0',
          Accept: 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchUrl(res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href)
            .then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    req.end();
  });
}
