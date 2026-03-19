export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

export interface SitemapOptions {
  baseUrl: string;
  defaultChangefreq?: SitemapEntry['changefreq'];
  depthPriorityMap?: Record<number, number>;
  excludePatterns?: RegExp[];
  includePatterns?: RegExp[];
}

/**
 * Generate a sitemap.xml string from crawled page data.
 * Priority is automatically calculated based on crawl depth.
 */
export function generateSitemap(
  pages: Array<{ url: string; depth: number; lastModified?: string; statusCode?: number }>,
  options: SitemapOptions
): string {
  const {
    defaultChangefreq = 'weekly',
    depthPriorityMap = { 0: 1.0, 1: 0.8, 2: 0.6, 3: 0.4 },
    excludePatterns = [],
    includePatterns = [],
  } = options;

  const entries: SitemapEntry[] = [];

  for (const page of pages) {
    // Skip non-200 pages
    if (page.statusCode !== undefined && page.statusCode !== 200) continue;

    // Apply include/exclude filters
    if (excludePatterns.length > 0 && excludePatterns.some(p => p.test(page.url))) continue;
    if (includePatterns.length > 0 && !includePatterns.some(p => p.test(page.url))) continue;

    const priority = depthPriorityMap[page.depth] ?? Math.max(0.1, 1.0 - page.depth * 0.2);

    entries.push({
      loc: page.url,
      lastmod: page.lastModified ?? undefined,
      changefreq: inferChangefreq(page.url, page.depth, defaultChangefreq),
      priority: Math.round(priority * 10) / 10,
    });
  }

  // Sort by priority desc, then alphabetically
  entries.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.loc.localeCompare(b.loc));

  return buildXml(entries);
}

/**
 * Generate a sitemap index for large sites with multiple sitemaps.
 */
export function generateSitemapIndex(
  sitemapUrls: Array<{ loc: string; lastmod?: string }>
): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  for (const sitemap of sitemapUrls) {
    lines.push('  <sitemap>');
    lines.push(`    <loc>${escapeXml(sitemap.loc)}</loc>`);
    if (sitemap.lastmod) {
      lines.push(`    <lastmod>${escapeXml(sitemap.lastmod)}</lastmod>`);
    }
    lines.push('  </sitemap>');
  }

  lines.push('</sitemapindex>');
  return lines.join('\n');
}

/**
 * Parse an existing sitemap.xml string into entries.
 */
export function parseSitemap(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const urlRegex = /<url>([\s\S]*?)<\/url>/g;

  let match;
  while ((match = urlRegex.exec(xml)) !== null) {
    const block = match[1];
    const loc = extractTag(block, 'loc');
    if (!loc) continue;

    entries.push({
      loc,
      lastmod: extractTag(block, 'lastmod') ?? undefined,
      changefreq: (extractTag(block, 'changefreq') ?? undefined) as SitemapEntry['changefreq'],
      priority: extractTag(block, 'priority') ? parseFloat(extractTag(block, 'priority')!) : undefined,
    });
  }

  return entries;
}

/**
 * Validate a sitemap against common issues.
 */
export function validateSitemap(xml: string): SitemapValidation {
  const issues: string[] = [];
  const entries = parseSitemap(xml);

  if (entries.length === 0) {
    issues.push('Sitemap contains no URLs');
  }

  if (entries.length > 50000) {
    issues.push(`Sitemap exceeds 50,000 URL limit (${entries.length} URLs)`);
  }

  const byteSize = Buffer.byteLength(xml, 'utf-8');
  if (byteSize > 50 * 1024 * 1024) {
    issues.push(`Sitemap exceeds 50MB size limit (${Math.round(byteSize / 1024 / 1024)}MB)`);
  }

  // Check for duplicate URLs
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.loc)) {
      issues.push(`Duplicate URL: ${entry.loc}`);
    }
    seen.add(entry.loc);

    // Validate priority range
    if (entry.priority !== undefined && (entry.priority < 0 || entry.priority > 1)) {
      issues.push(`Invalid priority ${entry.priority} for ${entry.loc} (must be 0.0-1.0)`);
    }
  }

  if (!xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')) {
    issues.push('Missing sitemaps.org namespace declaration');
  }

  return {
    valid: issues.length === 0,
    urlCount: entries.length,
    sizeBytes: byteSize,
    issues,
  };
}

export interface SitemapValidation {
  valid: boolean;
  urlCount: number;
  sizeBytes: number;
  issues: string[];
}

function buildXml(entries: SitemapEntry[]): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  for (const entry of entries) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);
    if (entry.lastmod) {
      lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    }
    if (entry.changefreq) {
      lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
    }
    if (entry.priority !== undefined) {
      lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
    }
    lines.push('  </url>');
  }

  lines.push('</urlset>');
  return lines.join('\n');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function extractTag(block: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const match = regex.exec(block);
  return match ? match[1].trim() : null;
}

function inferChangefreq(
  url: string,
  depth: number,
  defaultFreq: SitemapEntry['changefreq']
): SitemapEntry['changefreq'] {
  // Homepage changes most frequently
  if (depth === 0) return 'daily';

  // Blog/news pages change frequently
  const path = new URL(url).pathname.toLowerCase();
  if (path.includes('/blog') || path.includes('/news') || path.includes('/article')) {
    return 'weekly';
  }

  // Deep pages change less often
  if (depth >= 3) return 'monthly';

  return defaultFreq;
}
