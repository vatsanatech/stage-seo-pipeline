import * as cheerio from 'cheerio';
import type { CrawledPage, AuditIssue, AuditCategory, AuditSeverity } from '../models/types.js';

type CheckFn = (page: CrawledPage, $: cheerio.CheerioAPI, crawlRunId: string) => AuditIssue[];

function issue(
  url: string,
  category: AuditCategory,
  severity: AuditSeverity,
  message: string,
  crawlRunId: string,
  crawledAt: string,
  details?: string
): AuditIssue {
  return { url, category, severity, message, details, crawlRunId, crawledAt };
}

const checkMetaTitle: CheckFn = (page, $, runId) => {
  const issues: AuditIssue[] = [];
  const titles = $('title');

  if (titles.length === 0) {
    issues.push(issue(page.url, 'meta_title', 'critical', 'Missing <title> tag', runId, page.crawledAt));
  } else if (titles.length > 1) {
    issues.push(issue(page.url, 'meta_title', 'warning', `Multiple <title> tags found (${titles.length})`, runId, page.crawledAt));
  } else {
    const title = titles.first().text().trim();
    if (!title) {
      issues.push(issue(page.url, 'meta_title', 'critical', 'Empty <title> tag', runId, page.crawledAt));
    } else if (title.length < 10) {
      issues.push(issue(page.url, 'meta_title', 'warning', `Title too short (${title.length} chars)`, runId, page.crawledAt, title));
    } else if (title.length > 60) {
      issues.push(issue(page.url, 'meta_title', 'warning', `Title too long (${title.length} chars, recommended ≤60)`, runId, page.crawledAt, title));
    }
  }
  return issues;
};

const checkMetaDescription: CheckFn = (page, $, runId) => {
  const issues: AuditIssue[] = [];
  const desc = $('meta[name="description"]');

  if (desc.length === 0) {
    issues.push(issue(page.url, 'meta_description', 'critical', 'Missing meta description', runId, page.crawledAt));
  } else {
    const content = desc.first().attr('content')?.trim() ?? '';
    if (!content) {
      issues.push(issue(page.url, 'meta_description', 'critical', 'Empty meta description', runId, page.crawledAt));
    } else if (content.length < 50) {
      issues.push(issue(page.url, 'meta_description', 'warning', `Meta description too short (${content.length} chars)`, runId, page.crawledAt, content));
    } else if (content.length > 160) {
      issues.push(issue(page.url, 'meta_description', 'warning', `Meta description too long (${content.length} chars, recommended ≤160)`, runId, page.crawledAt, content));
    }
  }
  return issues;
};

const checkCanonical: CheckFn = (page, $, runId) => {
  const issues: AuditIssue[] = [];
  const canonical = $('link[rel="canonical"]');

  if (canonical.length === 0) {
    issues.push(issue(page.url, 'canonical', 'warning', 'Missing canonical URL', runId, page.crawledAt));
  } else if (canonical.length > 1) {
    issues.push(issue(page.url, 'canonical', 'critical', `Multiple canonical tags found (${canonical.length})`, runId, page.crawledAt));
  } else {
    const href = canonical.first().attr('href')?.trim();
    if (!href) {
      issues.push(issue(page.url, 'canonical', 'critical', 'Empty canonical href', runId, page.crawledAt));
    }
  }
  return issues;
};

const checkOgTags: CheckFn = (page, $, runId) => {
  const issues: AuditIssue[] = [];
  const requiredOg = ['og:title', 'og:description', 'og:image', 'og:url'];
  const missing: string[] = [];

  for (const prop of requiredOg) {
    const tag = $(`meta[property="${prop}"]`);
    if (tag.length === 0 || !tag.first().attr('content')?.trim()) {
      missing.push(prop);
    }
  }

  if (missing.length > 0) {
    const severity: AuditSeverity = missing.length >= 3 ? 'critical' : 'warning';
    issues.push(issue(page.url, 'og_tags', severity, `Missing Open Graph tags: ${missing.join(', ')}`, runId, page.crawledAt));
  }
  return issues;
};

const checkTwitterCards: CheckFn = (page, $, runId) => {
  const issues: AuditIssue[] = [];
  const cardType = $('meta[name="twitter:card"]');
  const twitterTitle = $('meta[name="twitter:title"]');
  const twitterDesc = $('meta[name="twitter:description"]');
  const missing: string[] = [];

  if (cardType.length === 0) missing.push('twitter:card');
  if (twitterTitle.length === 0) missing.push('twitter:title');
  if (twitterDesc.length === 0) missing.push('twitter:description');

  if (missing.length > 0) {
    issues.push(issue(page.url, 'twitter_cards', 'info', `Missing Twitter Card tags: ${missing.join(', ')}`, runId, page.crawledAt));
  }
  return issues;
};

const checkH1: CheckFn = (page, $, runId) => {
  const issues: AuditIssue[] = [];
  const h1s = $('h1');

  if (h1s.length === 0) {
    issues.push(issue(page.url, 'h1', 'critical', 'Missing H1 heading', runId, page.crawledAt));
  } else if (h1s.length > 1) {
    issues.push(issue(page.url, 'h1', 'warning', `Multiple H1 tags found (${h1s.length})`, runId, page.crawledAt));
  } else {
    const text = h1s.first().text().trim();
    if (!text) {
      issues.push(issue(page.url, 'h1', 'critical', 'Empty H1 heading', runId, page.crawledAt));
    }
  }
  return issues;
};

const checkSchemaMarkup: CheckFn = (page, $, runId) => {
  const issues: AuditIssue[] = [];
  const jsonLd = $('script[type="application/ld+json"]');
  const microdata = $('[itemscope]');

  if (jsonLd.length === 0 && microdata.length === 0) {
    issues.push(issue(page.url, 'schema_markup', 'warning', 'No structured data found (JSON-LD or Microdata)', runId, page.crawledAt));
  }

  // Validate JSON-LD is parseable
  jsonLd.each((_, el) => {
    const content = $(el).html();
    if (content) {
      try {
        const parsed = JSON.parse(content);
        if (!parsed['@type'] && !parsed['@graph']) {
          issues.push(issue(page.url, 'schema_markup', 'warning', 'JSON-LD missing @type', runId, page.crawledAt));
        }
      } catch {
        issues.push(issue(page.url, 'schema_markup', 'critical', 'Invalid JSON-LD syntax', runId, page.crawledAt, content.slice(0, 200)));
      }
    }
  });

  return issues;
};

const checkStatusCode: CheckFn = (page, _$, runId) => {
  const issues: AuditIssue[] = [];

  if (page.statusCode >= 400) {
    issues.push(issue(page.url, 'status_code', 'critical', `HTTP ${page.statusCode} error`, runId, page.crawledAt));
  } else if (page.statusCode >= 300) {
    issues.push(issue(page.url, 'redirect', 'info', `HTTP ${page.statusCode} redirect`, runId, page.crawledAt));
  }

  return issues;
};

const allChecks: CheckFn[] = [
  checkMetaTitle,
  checkMetaDescription,
  checkCanonical,
  checkOgTags,
  checkTwitterCards,
  checkH1,
  checkSchemaMarkup,
  checkStatusCode,
];

/**
 * Run all SEO audit checks on a crawled page.
 */
export function auditPage(page: CrawledPage, crawlRunId: string): AuditIssue[] {
  const $ = cheerio.load(page.html);
  const issues: AuditIssue[] = [];

  for (const check of allChecks) {
    issues.push(...check(page, $, crawlRunId));
  }

  return issues;
}
