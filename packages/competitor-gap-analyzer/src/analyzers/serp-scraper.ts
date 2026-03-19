import * as cheerio from 'cheerio';
import { fetchUrl, delay } from '../utils/http.js';
import type { SerpResult } from '../models/types.js';
import { COMPETITORS } from '../models/types.js';

const DUCKDUCKGO_HTML_URL = 'https://html.duckduckgo.com/html/';
const REQUEST_DELAY_MS = 4000; // Be respectful with rate limiting
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 8000;

/**
 * Scrape DuckDuckGo HTML search results for a keyword.
 * Returns parsed SERP results with positions.
 */
export async function scrapeDuckDuckGo(query: string): Promise<SerpResult[]> {
  const params = new URLSearchParams({ q: query, kl: 'in-en' }); // India locale
  const url = `${DUCKDUCKGO_HTML_URL}?${params.toString()}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const html = await fetchUrl(url);
      const results = parseDuckDuckGoResults(html, query);
      if (results.length > 0 || attempt === MAX_RETRIES) return results;
      // Empty results might mean rate limiting, retry
      console.warn(`[SERP] Got 0 results for "${query}", retrying (${attempt + 1}/${MAX_RETRIES})...`);
      await delay(RETRY_DELAY_MS);
    } catch (err) {
      console.error(`[SERP] Failed to fetch results for "${query}":`, (err as Error).message);
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }
  return [];
}

function parseDuckDuckGoResults(html: string, query: string): SerpResult[] {
  const $ = cheerio.load(html);
  const results: SerpResult[] = [];
  const now = new Date().toISOString();

  $('.result').each((index, element) => {
    const titleEl = $(element).find('.result__title a');
    const snippetEl = $(element).find('.result__snippet');
    const urlEl = $(element).find('.result__url');

    const title = titleEl.text().trim();
    const snippet = snippetEl.text().trim();
    let resultUrl = titleEl.attr('href') || '';

    // DuckDuckGo wraps URLs in a redirect - extract the actual URL
    if (resultUrl.includes('uddg=')) {
      try {
        const decoded = new URL(resultUrl, 'https://duckduckgo.com');
        resultUrl = decoded.searchParams.get('uddg') || resultUrl;
      } catch {
        // Use URL text fallback
        resultUrl = urlEl.text().trim();
        if (resultUrl && !resultUrl.startsWith('http')) {
          resultUrl = 'https://' + resultUrl;
        }
      }
    }

    if (!title || !resultUrl) return;

    let domain: string;
    try {
      domain = new URL(resultUrl).hostname.replace('www.', '');
    } catch {
      domain = urlEl.text().trim().split('/')[0];
    }

    results.push({
      query,
      position: index + 1,
      url: resultUrl,
      title,
      snippet,
      domain,
      fetchedAt: now,
    });
  });

  return results;
}

/**
 * Check if a domain belongs to a tracked competitor.
 */
export function isCompetitorDomain(domain: string): boolean {
  const cleanDomain = domain.replace('www.', '').toLowerCase();
  return COMPETITORS.some((c) => cleanDomain.includes(c) || c.includes(cleanDomain));
}

/**
 * Check if a domain belongs to Stage.
 */
export function isStageDomain(domain: string): boolean {
  const cleanDomain = domain.replace('www.', '').toLowerCase();
  return cleanDomain.includes('stage') || cleanDomain.includes('stageott') || cleanDomain.includes('stage.in');
}

/**
 * Batch scrape with rate limiting.
 */
export async function batchScrape(queries: string[]): Promise<Map<string, SerpResult[]>> {
  const results = new Map<string, SerpResult[]>();

  for (const query of queries) {
    console.log(`[SERP] Scraping: "${query}"`);
    const serpResults = await scrapeDuckDuckGo(query);
    results.set(query, serpResults);
    console.log(`[SERP] Found ${serpResults.length} results for "${query}"`);

    // Rate limit
    if (queries.indexOf(query) < queries.length - 1) {
      await delay(REQUEST_DELAY_MS);
    }
  }

  return results;
}
