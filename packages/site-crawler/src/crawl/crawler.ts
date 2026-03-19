import type { CrawlConfig, CrawledPage, InternalLink } from '../models/types.js';
import * as cheerio from 'cheerio';

export interface CrawlCallbacks {
  onPageCrawled?: (page: CrawledPage, links: InternalLink[]) => void;
  onError?: (url: string, error: Error) => void;
  onProgress?: (crawled: number, queued: number) => void;
}

/**
 * BFS site crawler using Playwright.
 * Crawls internal pages from a start URL, extracting HTML for SEO analysis.
 */
export class SiteCrawler {
  private config: Required<CrawlConfig>;
  private visited: Set<string> = new Set();
  private queue: Array<{ url: string; depth: number }> = [];

  constructor(config: CrawlConfig) {
    this.config = {
      startUrl: config.startUrl,
      maxPages: config.maxPages ?? 500,
      maxDepth: config.maxDepth ?? 10,
      concurrency: config.concurrency ?? 3,
      respectRobotsTxt: config.respectRobotsTxt ?? true,
      userAgent: config.userAgent ?? 'SEO-Audit-Bot/1.0',
      timeout: config.timeout ?? 30000,
      includePatterns: config.includePatterns ?? [],
      excludePatterns: config.excludePatterns ?? [],
    };
  }

  async crawl(callbacks: CrawlCallbacks = {}): Promise<CrawledPage[]> {
    // Dynamic import so Playwright is only loaded at crawl time
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const pages: CrawledPage[] = [];
    const baseOrigin = new URL(this.config.startUrl).origin;

    this.queue.push({ url: this.normalizeUrl(this.config.startUrl), depth: 0 });

    try {
      while (this.queue.length > 0 && pages.length < this.config.maxPages) {
        // Process batch of concurrent requests
        const batch = this.queue.splice(0, this.config.concurrency);

        const promises = batch.map(async ({ url, depth }) => {
          if (this.visited.has(url) || depth > this.config.maxDepth) return null;
          this.visited.add(url);

          try {
            const page = await this.crawlPage(browser, url, depth, baseOrigin);
            if (!page) return null;

            const links = this.extractLinks(page.html, url, baseOrigin);

            // Queue internal links
            for (const link of links) {
              const normalized = this.normalizeUrl(link.targetUrl);
              if (!this.visited.has(normalized) && this.shouldCrawl(normalized, baseOrigin)) {
                this.queue.push({ url: normalized, depth: depth + 1 });
              }
            }

            callbacks.onPageCrawled?.(page, links);
            return page;
          } catch (err) {
            callbacks.onError?.(url, err as Error);
            return null;
          }
        });

        const results = await Promise.all(promises);
        for (const result of results) {
          if (result) pages.push(result);
        }

        callbacks.onProgress?.(pages.length, this.queue.length);
      }
    } finally {
      await browser.close();
    }

    return pages;
  }

  private async crawlPage(
    browser: any,
    url: string,
    depth: number,
    _baseOrigin: string
  ): Promise<CrawledPage | null> {
    const context = await browser.newContext({
      userAgent: this.config.userAgent,
    });
    const page = await context.newPage();

    try {
      const startTime = Date.now();
      const response = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.config.timeout,
      });

      if (!response) return null;

      const loadTimeMs = Date.now() - startTime;
      const html = await page.content();
      const title = await page.title();
      const statusCode = response.status();

      const headers: Record<string, string> = {};
      const responseHeaders = response.headers();
      for (const [key, value] of Object.entries(responseHeaders)) {
        headers[key] = String(value);
      }

      return {
        url,
        statusCode,
        title,
        html,
        depth,
        headers,
        crawledAt: new Date().toISOString(),
        loadTimeMs,
      };
    } finally {
      await context.close();
    }
  }

  private extractLinks(html: string, sourceUrl: string, baseOrigin: string): InternalLink[] {
    const $ = cheerio.load(html);
    const links: InternalLink[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      try {
        const absoluteUrl = new URL(href, sourceUrl).href;
        const normalized = this.normalizeUrl(absoluteUrl);

        if (seen.has(normalized)) return;
        seen.add(normalized);

        if (new URL(normalized).origin === baseOrigin) {
          links.push({
            sourceUrl,
            targetUrl: normalized,
            anchorText: $(el).text().trim().slice(0, 200),
          });
        }
      } catch {
        // Skip malformed URLs
      }
    });

    return links;
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove fragment, trailing slash, default ports
      parsed.hash = '';
      let pathname = parsed.pathname;
      if (pathname.length > 1 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      parsed.pathname = pathname;
      return parsed.href;
    } catch {
      return url;
    }
  }

  private shouldCrawl(url: string, baseOrigin: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== baseOrigin) return false;

      // Skip common non-page resources
      const skipExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.css', '.js', '.ico', '.woff', '.woff2', '.ttf', '.mp4', '.mp3', '.zip', '.xml'];
      const ext = parsed.pathname.split('.').pop()?.toLowerCase();
      if (ext && skipExtensions.includes(`.${ext}`)) return false;

      // Check include/exclude patterns
      const fullUrl = parsed.href;
      if (this.config.includePatterns.length > 0) {
        if (!this.config.includePatterns.some(p => p.test(fullUrl))) return false;
      }
      if (this.config.excludePatterns.some(p => p.test(fullUrl))) return false;

      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Extract links from raw HTML without Playwright (for testing or re-processing).
 */
export function extractLinksFromHtml(html: string, sourceUrl: string, baseOrigin: string): InternalLink[] {
  const $ = cheerio.load(html);
  const links: InternalLink[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    try {
      const absoluteUrl = new URL(href, sourceUrl).href;
      if (seen.has(absoluteUrl)) return;
      seen.add(absoluteUrl);

      if (new URL(absoluteUrl).origin === baseOrigin) {
        links.push({
          sourceUrl,
          targetUrl: absoluteUrl,
          anchorText: $(el).text().trim().slice(0, 200),
        });
      }
    } catch {
      // Skip
    }
  });

  return links;
}
