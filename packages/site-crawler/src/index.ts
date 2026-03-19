export { SiteCrawler, extractLinksFromHtml } from './crawl/crawler.js';
export { auditPage } from './audit/checks.js';
export { runAudit, buildReport } from './audit/runner.js';
export { compareRendering, fetchRawHtml } from './audit/js-rendering.js';
export { checkImageSeo, checkImageSizes } from './audit/image-seo.js';
export { fetchCoreWebVitals, parsePageSpeedResponse, analyzeCwv } from './audit/core-web-vitals.js';
export { generateSitemap, generateSitemapIndex, parseSitemap, validateSitemap } from './audit/sitemap-generator.js';
export { analyzeContentFreshness, analyzeFreshnessFromDates, categorizeAge } from './audit/content-freshness.js';
export { checkMobileUsability } from './audit/mobile-usability.js';
export { extractPageContent, detectDuplicates } from './audit/duplicate-content.js';
export { getDatabase, saveDatabase, closeDatabase } from './db/schema.js';
export { getAuditIssues, getCrawlRun } from './db/repository.js';
export type {
  CrawlConfig, CrawledPage, InternalLink, AuditIssue,
  AuditCategory, AuditSeverity, AuditReport, CrawlRun,
} from './models/types.js';
