import { request as httpsRequest } from 'node:https';

const TRENDS_API_BASE = 'https://trends.google.com/trends/api';
const WIDGET_TOKEN_URL = `${TRENDS_API_BASE}/explore`;
const MULTILINE_URL = `${TRENDS_API_BASE}/widgetdata/multiline`;
const RELATED_QUERIES_URL = `${TRENDS_API_BASE}/widgetdata/relatedsearches`;

/** Google Trends interest over time data point */
export interface TrendsDataPoint {
  date: string; // YYYY-MM-DD
  value: number; // 0-100 interest score
  keyword: string;
}

/** Google Trends related query */
export interface RelatedQuery {
  query: string;
  value: number; // Relative interest or "Breakout"
  type: 'top' | 'rising';
}

/** Google Trends request options */
export interface TrendsOptions {
  keywords: string[];
  geo?: string; // e.g., 'IN' for India
  timeRange?: string; // e.g., 'today 3-m', 'today 12-m', 'now 7-d'
  category?: number; // Google Trends category ID
}

/**
 * Fetch interest over time from Google Trends.
 * Uses the same API endpoint that pytrends uses.
 */
export async function getInterestOverTime(opts: TrendsOptions): Promise<TrendsDataPoint[]> {
  const { keywords, geo = 'IN', timeRange = 'today 3-m' } = opts;

  try {
    // Step 1: Get widget tokens from explore endpoint
    const tokens = await getWidgetTokens(keywords, geo, timeRange);
    if (!tokens.timelineToken) {
      console.warn('[Trends] No timeline widget token found');
      return [];
    }

    // Step 2: Fetch multiline data using token
    const data = await fetchMultilineData(tokens.timelineToken, tokens.timelineRequest);
    return data;
  } catch (err) {
    console.error('[Trends] Failed to fetch interest over time:', (err as Error).message);
    return [];
  }
}

/**
 * Fetch related queries for a keyword from Google Trends.
 */
export async function getRelatedQueries(opts: TrendsOptions): Promise<RelatedQuery[]> {
  const { keywords, geo = 'IN', timeRange = 'today 3-m' } = opts;

  try {
    const tokens = await getWidgetTokens(keywords, geo, timeRange);
    if (!tokens.relatedToken) {
      return [];
    }

    const data = await fetchRelatedData(tokens.relatedToken, tokens.relatedRequest);
    return data;
  } catch (err) {
    console.error('[Trends] Failed to fetch related queries:', (err as Error).message);
    return [];
  }
}

/**
 * Simple interest snapshot: get the current relative interest for multiple keywords.
 * Returns the latest interest value (0-100) for each keyword.
 */
export async function getInterestSnapshot(
  keywords: string[],
  geo: string = 'IN'
): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  // Google Trends can compare up to 5 keywords at once
  const batches = chunkArray(keywords, 5);

  for (const batch of batches) {
    const dataPoints = await getInterestOverTime({
      keywords: batch,
      geo,
      timeRange: 'now 7-d', // Last 7 days for current snapshot
    });

    // Get the latest value for each keyword
    for (const kw of batch) {
      const kwPoints = dataPoints.filter((p) => p.keyword === kw);
      if (kwPoints.length > 0) {
        const latest = kwPoints[kwPoints.length - 1];
        result.set(kw, latest.value);
      }
    }
  }

  return result;
}

// --- Internal helpers ---

interface WidgetTokens {
  timelineToken: string | null;
  timelineRequest: unknown;
  relatedToken: string | null;
  relatedRequest: unknown;
}

async function getWidgetTokens(
  keywords: string[],
  geo: string,
  timeRange: string
): Promise<WidgetTokens> {
  const comparisonItem = keywords.map((kw) => ({
    keyword: kw,
    geo,
    time: timeRange,
  }));

  const reqBody = {
    comparisonItem,
    category: 0,
    property: '',
  };

  const params = new URLSearchParams({
    hl: 'en-US',
    tz: '-330', // IST
    req: JSON.stringify(reqBody),
  });

  const url = `${WIDGET_TOKEN_URL}?${params.toString()}`;
  const response = await fetchTrendsUrl(url);

  // Google Trends returns ")]}'\n" prefix before JSON
  const jsonStr = response.replace(/^\)\]\}',?\n/, '');
  const parsed = JSON.parse(jsonStr);

  let timelineToken: string | null = null;
  let timelineRequest: unknown = null;
  let relatedToken: string | null = null;
  let relatedRequest: unknown = null;

  for (const widget of parsed.widgets || []) {
    if (widget.id === 'TIMESERIES') {
      timelineToken = widget.token;
      timelineRequest = widget.request;
    }
    if (widget.id === 'RELATED_QUERIES') {
      relatedToken = widget.token;
      relatedRequest = widget.request;
    }
  }

  return { timelineToken, timelineRequest, relatedToken, relatedRequest };
}

async function fetchMultilineData(token: string, req: unknown): Promise<TrendsDataPoint[]> {
  const params = new URLSearchParams({
    hl: 'en-US',
    tz: '-330',
    req: JSON.stringify(req),
    token,
  });

  const url = `${MULTILINE_URL}?${params.toString()}`;
  const response = await fetchTrendsUrl(url);
  const jsonStr = response.replace(/^\)\]\}',?\n/, '');
  const parsed = JSON.parse(jsonStr);

  const dataPoints: TrendsDataPoint[] = [];
  const timelineData = parsed.default?.timelineData || [];

  for (const point of timelineData) {
    const date = point.formattedTime || '';
    const values = point.value || [];
    const keywords = parsed.default?.averages
      ? (req as { comparisonItem?: Array<{ complexKeywordsRestriction?: { keyword?: Array<{ value?: string }> } }> })
          ?.comparisonItem?.map((item: { complexKeywordsRestriction?: { keyword?: Array<{ value?: string }> } }) =>
            item.complexKeywordsRestriction?.keyword?.[0]?.value || ''
          ) || []
      : [];

    for (let i = 0; i < values.length; i++) {
      dataPoints.push({
        date: normalizeDate(date),
        value: values[i],
        keyword: keywords[i] || `keyword_${i}`,
      });
    }
  }

  return dataPoints;
}

async function fetchRelatedData(token: string, req: unknown): Promise<RelatedQuery[]> {
  const params = new URLSearchParams({
    hl: 'en-US',
    tz: '-330',
    req: JSON.stringify(req),
    token,
  });

  const url = `${RELATED_QUERIES_URL}?${params.toString()}`;
  const response = await fetchTrendsUrl(url);
  const jsonStr = response.replace(/^\)\]\}',?\n/, '');
  const parsed = JSON.parse(jsonStr);

  const queries: RelatedQuery[] = [];

  // Top queries
  const topQueries = parsed.default?.rankedList?.[0]?.rankedKeyword || [];
  for (const item of topQueries) {
    queries.push({
      query: item.query || '',
      value: item.value || 0,
      type: 'top',
    });
  }

  // Rising queries
  const risingQueries = parsed.default?.rankedList?.[1]?.rankedKeyword || [];
  for (const item of risingQueries) {
    queries.push({
      query: item.query || '',
      value: item.value || 0,
      type: 'rising',
    });
  }

  return queries;
}

function fetchTrendsUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StageOTT-SEO/1.0)',
          Accept: 'application/json',
        },
        timeout: 15_000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchTrendsUrl(res.headers.location).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Google Trends API error ${res.statusCode}: ${text.substring(0, 200)}`));
          } else {
            resolve(text);
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function normalizeDate(dateStr: string): string {
  // Convert various date formats to YYYY-MM-DD
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  } catch {
    // Fall through
  }
  return dateStr;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
