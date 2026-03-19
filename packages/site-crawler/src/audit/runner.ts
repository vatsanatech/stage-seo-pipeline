import { randomUUID } from 'node:crypto';
import type { Database } from 'sql.js';
import type { CrawlConfig, AuditIssue, AuditReport, CrawlRun, AuditCategory, AuditSeverity } from '../models/types.js';
import { SiteCrawler } from '../crawl/crawler.js';
import { auditPage } from './checks.js';
import { createCrawlRun, updateCrawlRun, insertAuditIssue, insertCrawledPage, getAuditIssues, getCrawlRun } from '../db/repository.js';

export async function runAudit(
  db: Database,
  config: CrawlConfig,
  options: { verbose?: boolean } = {}
): Promise<AuditReport> {
  const runId = randomUUID();
  const now = new Date().toISOString();

  const crawlRun: CrawlRun = {
    id: runId,
    startUrl: config.startUrl,
    startedAt: now,
    pagesCrawled: 0,
    issuesFound: 0,
    status: 'running',
  };

  createCrawlRun(db, crawlRun);

  const allIssues: AuditIssue[] = [];
  let pagesCrawled = 0;

  try {
    const crawler = new SiteCrawler(config);
    await crawler.crawl({
      onPageCrawled: (page, links) => {
        pagesCrawled++;
        insertCrawledPage(db, page, runId);

        const issues = auditPage(page, runId);
        for (const iss of issues) {
          insertAuditIssue(db, iss);
          allIssues.push(iss);
        }

        if (options.verbose) {
          const issueCount = issues.length;
          console.log(`[${pagesCrawled}] ${page.url} — ${page.statusCode} (${page.loadTimeMs}ms) — ${issueCount} issues`);
        }
      },
      onError: (url, error) => {
        if (options.verbose) {
          console.error(`[ERROR] ${url}: ${error.message}`);
        }
      },
      onProgress: (crawled, queued) => {
        if (options.verbose && crawled % 10 === 0) {
          console.log(`Progress: ${crawled} crawled, ${queued} queued`);
        }
      },
    });

    updateCrawlRun(db, runId, {
      completedAt: new Date().toISOString(),
      pagesCrawled,
      issuesFound: allIssues.length,
      status: 'completed',
    });
  } catch (err) {
    updateCrawlRun(db, runId, {
      completedAt: new Date().toISOString(),
      pagesCrawled,
      issuesFound: allIssues.length,
      status: 'failed',
    });
    throw err;
  }

  return buildReport(db, runId);
}

export function buildReport(db: Database, crawlRunId: string): AuditReport {
  const crawlRun = getCrawlRun(db, crawlRunId);
  if (!crawlRun) throw new Error(`Crawl run ${crawlRunId} not found`);

  const issues = getAuditIssues(db, crawlRunId);

  const issuesByCategory: Record<string, AuditIssue[]> = {};
  const issuesBySeverity: Record<string, AuditIssue[]> = {};

  for (const iss of issues) {
    (issuesByCategory[iss.category] ??= []).push(iss);
    (issuesBySeverity[iss.severity] ??= []).push(iss);
  }

  return {
    crawlRun,
    issuesByCategory: issuesByCategory as Record<AuditCategory, AuditIssue[]>,
    issuesBySeverity: issuesBySeverity as Record<AuditSeverity, AuditIssue[]>,
    summary: {
      totalPages: crawlRun.pagesCrawled,
      totalIssues: issues.length,
      critical: (issuesBySeverity['critical'] ?? []).length,
      warning: (issuesBySeverity['warning'] ?? []).length,
      info: (issuesBySeverity['info'] ?? []).length,
    },
  };
}
