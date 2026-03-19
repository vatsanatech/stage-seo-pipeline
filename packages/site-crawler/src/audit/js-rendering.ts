import * as cheerio from 'cheerio';

export interface JsRenderingDiff {
  url: string;
  titleDiff: { raw: string; rendered: string } | null;
  h1Diff: { raw: string[]; rendered: string[] } | null;
  metaDescDiff: { raw: string; rendered: string } | null;
  canonicalDiff: { raw: string; rendered: string } | null;
  schemaMarkupDiff: { rawCount: number; renderedCount: number; renderedOnly: string[] } | null;
  ogTagsDiff: { rawMissing: string[]; renderedPresent: string[] } | null;
  issues: JsRenderingIssue[];
}

export interface JsRenderingIssue {
  url: string;
  element: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  rawValue: string;
  renderedValue: string;
}

/**
 * Compare raw HTML (as fetched without JS execution) vs Playwright-rendered HTML.
 * Flags SEO-critical elements that are only visible after JS execution.
 */
export function compareRendering(url: string, rawHtml: string, renderedHtml: string): JsRenderingDiff {
  const raw$ = cheerio.load(rawHtml);
  const rendered$ = cheerio.load(renderedHtml);
  const issues: JsRenderingIssue[] = [];

  // Title comparison
  const rawTitle = raw$('title').first().text().trim();
  const renderedTitle = rendered$('title').first().text().trim();
  let titleDiff: JsRenderingDiff['titleDiff'] = null;

  if (rawTitle !== renderedTitle) {
    titleDiff = { raw: rawTitle, rendered: renderedTitle };
    if (!rawTitle && renderedTitle) {
      issues.push({
        url, element: 'title', severity: 'critical',
        message: 'Title tag only visible after JS rendering — search engines may not see it',
        rawValue: rawTitle, renderedValue: renderedTitle,
      });
    } else if (rawTitle && renderedTitle && rawTitle !== renderedTitle) {
      issues.push({
        url, element: 'title', severity: 'warning',
        message: 'Title changes after JS rendering',
        rawValue: rawTitle, renderedValue: renderedTitle,
      });
    }
  }

  // H1 comparison
  const rawH1s = extractTextList(raw$, 'h1');
  const renderedH1s = extractTextList(rendered$, 'h1');
  let h1Diff: JsRenderingDiff['h1Diff'] = null;

  if (JSON.stringify(rawH1s) !== JSON.stringify(renderedH1s)) {
    h1Diff = { raw: rawH1s, rendered: renderedH1s };

    if (rawH1s.length === 0 && renderedH1s.length > 0) {
      issues.push({
        url, element: 'h1', severity: 'critical',
        message: `H1 heading only visible after JS rendering (${renderedH1s.length} found in rendered, 0 in raw)`,
        rawValue: '(none)', renderedValue: renderedH1s.join(', '),
      });
    } else if (rawH1s.length > 0 && renderedH1s.length > rawH1s.length) {
      issues.push({
        url, element: 'h1', severity: 'info',
        message: `Additional H1 headings added by JS (${rawH1s.length} raw → ${renderedH1s.length} rendered)`,
        rawValue: rawH1s.join(', '), renderedValue: renderedH1s.join(', '),
      });
    }
  }

  // Meta description comparison
  const rawDesc = raw$('meta[name="description"]').first().attr('content')?.trim() ?? '';
  const renderedDesc = rendered$('meta[name="description"]').first().attr('content')?.trim() ?? '';
  let metaDescDiff: JsRenderingDiff['metaDescDiff'] = null;

  if (rawDesc !== renderedDesc) {
    metaDescDiff = { raw: rawDesc, rendered: renderedDesc };
    if (!rawDesc && renderedDesc) {
      issues.push({
        url, element: 'meta_description', severity: 'critical',
        message: 'Meta description only visible after JS rendering',
        rawValue: rawDesc, renderedValue: renderedDesc,
      });
    }
  }

  // Canonical comparison
  const rawCanonical = raw$('link[rel="canonical"]').first().attr('href')?.trim() ?? '';
  const renderedCanonical = rendered$('link[rel="canonical"]').first().attr('href')?.trim() ?? '';
  let canonicalDiff: JsRenderingDiff['canonicalDiff'] = null;

  if (rawCanonical !== renderedCanonical) {
    canonicalDiff = { raw: rawCanonical, rendered: renderedCanonical };
    if (!rawCanonical && renderedCanonical) {
      issues.push({
        url, element: 'canonical', severity: 'warning',
        message: 'Canonical URL only visible after JS rendering',
        rawValue: rawCanonical, renderedValue: renderedCanonical,
      });
    } else if (rawCanonical && renderedCanonical && rawCanonical !== renderedCanonical) {
      issues.push({
        url, element: 'canonical', severity: 'critical',
        message: 'Canonical URL changes after JS rendering — conflicting signals',
        rawValue: rawCanonical, renderedValue: renderedCanonical,
      });
    }
  }

  // Schema markup (JSON-LD) comparison
  const rawSchemas = extractJsonLdTypes(raw$);
  const renderedSchemas = extractJsonLdTypes(rendered$);
  let schemaMarkupDiff: JsRenderingDiff['schemaMarkupDiff'] = null;

  const renderedOnly = renderedSchemas.filter(s => !rawSchemas.includes(s));

  if (rawSchemas.length !== renderedSchemas.length || renderedOnly.length > 0) {
    schemaMarkupDiff = {
      rawCount: rawSchemas.length,
      renderedCount: renderedSchemas.length,
      renderedOnly,
    };

    if (rawSchemas.length === 0 && renderedSchemas.length > 0) {
      issues.push({
        url, element: 'schema_markup', severity: 'critical',
        message: `Schema markup only visible after JS rendering (${renderedSchemas.length} JSON-LD blocks: ${renderedSchemas.join(', ')})`,
        rawValue: '(none)', renderedValue: renderedSchemas.join(', '),
      });
    } else if (renderedOnly.length > 0) {
      issues.push({
        url, element: 'schema_markup', severity: 'warning',
        message: `Additional schema markup added by JS: ${renderedOnly.join(', ')}`,
        rawValue: rawSchemas.join(', '), renderedValue: renderedSchemas.join(', '),
      });
    }
  }

  // OG tags comparison
  const ogProps = ['og:title', 'og:description', 'og:image', 'og:url'];
  const rawMissingOg: string[] = [];
  const renderedPresentOg: string[] = [];

  for (const prop of ogProps) {
    const rawVal = raw$(`meta[property="${prop}"]`).first().attr('content')?.trim();
    const renderedVal = rendered$(`meta[property="${prop}"]`).first().attr('content')?.trim();

    if (!rawVal && renderedVal) {
      rawMissingOg.push(prop);
      renderedPresentOg.push(prop);
    }
  }

  let ogTagsDiff: JsRenderingDiff['ogTagsDiff'] = null;
  if (rawMissingOg.length > 0) {
    ogTagsDiff = { rawMissing: rawMissingOg, renderedPresent: renderedPresentOg };
    issues.push({
      url, element: 'og_tags', severity: 'warning',
      message: `OG tags only visible after JS rendering: ${rawMissingOg.join(', ')}`,
      rawValue: '(missing)', renderedValue: renderedPresentOg.join(', '),
    });
  }

  return {
    url,
    titleDiff,
    h1Diff,
    metaDescDiff,
    canonicalDiff,
    schemaMarkupDiff,
    ogTagsDiff,
    issues,
  };
}

function extractTextList($: cheerio.CheerioAPI, selector: string): string[] {
  const items: string[] = [];
  $(selector).each((_, el) => {
    const text = $(el).text().trim();
    if (text) items.push(text);
  });
  return items;
}

function extractJsonLdTypes($: cheerio.CheerioAPI): string[] {
  const types: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html();
    if (!content) return;
    try {
      const parsed = JSON.parse(content);
      if (parsed['@type']) types.push(parsed['@type']);
      if (parsed['@graph'] && Array.isArray(parsed['@graph'])) {
        for (const item of parsed['@graph']) {
          if (item['@type']) types.push(item['@type']);
        }
      }
    } catch {
      // Skip invalid JSON-LD
    }
  });
  return types;
}

/**
 * Fetch raw HTML (no JS) for comparison with Playwright-rendered HTML.
 * Uses native fetch (Node 18+) with Googlebot-like user agent.
 */
export async function fetchRawHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    },
    redirect: 'follow',
  });
  return response.text();
}
