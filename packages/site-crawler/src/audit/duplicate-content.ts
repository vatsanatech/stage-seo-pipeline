import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';

export interface DuplicateGroup {
  type: 'title' | 'h1' | 'content' | 'canonical_conflict';
  value: string;
  urls: string[];
}

export interface DuplicateContentIssue {
  type: DuplicateGroup['type'];
  severity: 'critical' | 'warning' | 'info';
  message: string;
  urls: string[];
  value: string;
}

export interface DuplicateContentReport {
  totalPages: number;
  duplicateGroups: DuplicateGroup[];
  issues: DuplicateContentIssue[];
  summary: {
    duplicateTitles: number;
    duplicateH1s: number;
    nearDuplicateContent: number;
    canonicalConflicts: number;
  };
}

export interface PageContent {
  url: string;
  title: string;
  h1: string;
  bodyText: string;
  canonical: string;
}

/**
 * Extract SEO-relevant content from HTML for duplicate detection.
 */
export function extractPageContent(url: string, html: string): PageContent {
  const $ = cheerio.load(html);

  const title = $('title').first().text().trim();
  const h1 = $('h1').first().text().trim();
  const canonical = $('link[rel="canonical"]').first().attr('href')?.trim() || '';

  // Extract visible body text (strip scripts, styles, nav, footer)
  $('script, style, nav, footer, header, aside').remove();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

  return { url, title, h1, bodyText, canonical };
}

/**
 * Detect duplicate content across a set of crawled pages.
 */
export function detectDuplicates(pages: PageContent[]): DuplicateContentReport {
  const groups: DuplicateGroup[] = [];
  const issues: DuplicateContentIssue[] = [];

  // Detect duplicate titles
  const titleMap = groupByValue(pages, p => p.title);
  for (const [title, urls] of titleMap) {
    if (urls.length > 1 && title) {
      groups.push({ type: 'title', value: title, urls });
      issues.push({
        type: 'title',
        severity: 'warning',
        message: `${urls.length} pages share the same title: "${title.slice(0, 80)}"`,
        urls,
        value: title,
      });
    }
  }

  // Detect duplicate H1s
  const h1Map = groupByValue(pages, p => p.h1);
  for (const [h1, urls] of h1Map) {
    if (urls.length > 1 && h1) {
      groups.push({ type: 'h1', value: h1, urls });
      issues.push({
        type: 'h1',
        severity: 'warning',
        message: `${urls.length} pages share the same H1: "${h1.slice(0, 80)}"`,
        urls,
        value: h1,
      });
    }
  }

  // Detect near-duplicate content via content hashing (simhash-like using shingles)
  const contentMap = groupByValue(pages, p => hashContent(p.bodyText));
  for (const [hash, urls] of contentMap) {
    if (urls.length > 1 && hash !== hashContent('')) {
      const samplePage = pages.find(p => hashContent(p.bodyText) === hash);
      const preview = samplePage?.bodyText.slice(0, 100) || '';
      groups.push({ type: 'content', value: `hash:${hash}`, urls });
      issues.push({
        type: 'content',
        severity: 'critical',
        message: `${urls.length} pages have identical body content`,
        urls,
        value: preview,
      });
    }
  }

  // Detect canonical conflicts (different pages pointing to same canonical,
  // or page canonical pointing to a different URL that also exists)
  const canonicalMap = new Map<string, string[]>();
  for (const page of pages) {
    if (page.canonical && page.canonical !== page.url) {
      const urls = canonicalMap.get(page.canonical) ?? [];
      urls.push(page.url);
      canonicalMap.set(page.canonical, urls);
    }
  }

  for (const [canonical, urls] of canonicalMap) {
    if (urls.length > 1) {
      groups.push({ type: 'canonical_conflict', value: canonical, urls });
      issues.push({
        type: 'canonical_conflict',
        severity: 'critical',
        message: `${urls.length} pages point to the same canonical: ${canonical}`,
        urls,
        value: canonical,
      });
    }
  }

  return {
    totalPages: pages.length,
    duplicateGroups: groups,
    issues,
    summary: {
      duplicateTitles: groups.filter(g => g.type === 'title').length,
      duplicateH1s: groups.filter(g => g.type === 'h1').length,
      nearDuplicateContent: groups.filter(g => g.type === 'content').length,
      canonicalConflicts: groups.filter(g => g.type === 'canonical_conflict').length,
    },
  };
}

function groupByValue(pages: PageContent[], keyFn: (p: PageContent) => string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const page of pages) {
    const key = keyFn(page);
    if (!key) continue;
    const urls = map.get(key) ?? [];
    urls.push(page.url);
    map.set(key, urls);
  }
  return map;
}

function hashContent(text: string): string {
  // Normalize whitespace and lowercase for comparison
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return '';
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
