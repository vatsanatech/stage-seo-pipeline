/** Domains to analyze */
export const STAGE_DOMAINS = ['stage.in', 'www.stage.in', 'stageott.com'] as const;

export const COMPETITOR_DOMAINS = [
  'mxplayer.in',
  'jiocinema.com',
  'zee5.com',
  'sonyliv.com',
  'hotstar.com',
] as const;

/** A backlink record from CommonCrawl */
export interface Backlink {
  id?: number;
  targetDomain: string;
  targetUrl: string;
  sourceDomain: string;
  sourceUrl: string;
  anchorText: string;
  crawlDate: string;
  linkType: LinkType;
  status: LinkStatus;
  discoveredAt: string;
}

export type LinkType = 'dofollow' | 'nofollow' | 'ugc' | 'sponsored' | 'unknown';
export type LinkStatus = 'active' | 'lost' | 'new' | 'broken';

/** CommonCrawl Index API response record */
export interface CcIndexRecord {
  urlkey: string;
  timestamp: string;
  url: string;
  mime: string;
  'mime-detected': string;
  status: string;
  digest: string;
  length: string;
  offset: string;
  filename: string;
}

/** Backlink profile for a domain */
export interface BacklinkProfile {
  domain: string;
  totalBacklinks: number;
  uniqueSourceDomains: number;
  dofollowCount: number;
  nofollowCount: number;
  topSourceDomains: Array<{ domain: string; count: number }>;
  anchorTextDistribution: Array<{ text: string; count: number }>;
}

/** Link building opportunity */
export interface LinkOpportunity {
  id?: number;
  sourceDomain: string;
  sourceUrl: string;
  competitorDomain: string;
  competitorUrl: string;
  anchorText: string;
  opportunityType: OpportunityType;
  priority: 'high' | 'medium' | 'low';
  status: 'new' | 'outreached' | 'acquired' | 'rejected';
  notes: string;
  discoveredAt: string;
}

export type OpportunityType = 'competitor_link' | 'broken_link' | 'resource_page' | 'guest_post' | 'mention';

/** Backlink analysis run metadata */
export interface BacklinkRun {
  id?: number;
  runAt: string;
  domainsAnalyzed: number;
  totalBacklinksFound: number;
  newBacklinks: number;
  lostBacklinks: number;
  opportunitiesFound: number;
}
