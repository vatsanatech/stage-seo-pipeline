export interface CrawlConfig {
  startUrl: string;
  maxPages?: number;
  maxDepth?: number;
  concurrency?: number;
  respectRobotsTxt?: boolean;
  userAgent?: string;
  timeout?: number;
  includePatterns?: RegExp[];
  excludePatterns?: RegExp[];
}

export interface CrawledPage {
  url: string;
  statusCode: number;
  title: string;
  html: string;
  renderedHtml?: string;
  headers: Record<string, string>;
  depth: number;
  crawledAt: string;
  loadTimeMs: number;
}

export interface InternalLink {
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
}

export type AuditSeverity = 'critical' | 'warning' | 'info';

export type AuditCategory =
  | 'meta_title'
  | 'meta_description'
  | 'canonical'
  | 'og_tags'
  | 'twitter_cards'
  | 'h1'
  | 'schema_markup'
  | 'status_code'
  | 'redirect';

export interface AuditIssue {
  id?: number;
  url: string;
  category: AuditCategory;
  severity: AuditSeverity;
  message: string;
  details?: string;
  crawlRunId: string;
  crawledAt: string;
}

export interface CrawlRun {
  id: string;
  startUrl: string;
  startedAt: string;
  completedAt?: string;
  pagesCrawled: number;
  issuesFound: number;
  status: 'running' | 'completed' | 'failed';
}

export interface AuditReport {
  crawlRun: CrawlRun;
  issuesByCategory: Record<AuditCategory, AuditIssue[]>;
  issuesBySeverity: Record<AuditSeverity, AuditIssue[]>;
  summary: {
    totalPages: number;
    totalIssues: number;
    critical: number;
    warning: number;
    info: number;
  };
}
