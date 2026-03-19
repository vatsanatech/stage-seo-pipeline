export interface CrawledPage {
  url: string;
  title: string;
  links: ParsedLink[];
  statusCode?: number;
  lastModified?: string;
}

export interface ParsedLink {
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  isInternal: boolean;
  context?: string; // surrounding text for relevance
}

export interface LinkGraphEdge {
  id?: number;
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  crawledAt: string;
}

export interface PageScore {
  url: string;
  pagerank: number;
  authorityScore: number; // HITS authority
  hubScore: number; // HITS hub
  inboundLinks: number;
  outboundLinks: number;
}

export interface OrphanPage {
  url: string;
  inboundLinks: number;
  reason: string;
}

export interface LinkSuggestion {
  id?: number;
  sourceUrl: string;
  targetUrl: string;
  suggestedAnchorText: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  createdAt: string;
}

export interface GraphStats {
  totalPages: number;
  totalLinks: number;
  orphanPages: number;
  avgInboundLinks: number;
  avgOutboundLinks: number;
  maxPagerank: { url: string; score: number };
  topAuthorities: PageScore[];
  topHubs: PageScore[];
}
