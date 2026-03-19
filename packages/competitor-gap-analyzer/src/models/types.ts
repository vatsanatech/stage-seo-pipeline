/** OTT competitors tracked for Stage */
export const COMPETITORS = [
  'mxplayer.in',
  'jiocinema.com',
  'zee5.com',
  'sonyliv.com',
  'hotstar.com',
] as const;

export type Competitor = (typeof COMPETITORS)[number];

/** Dialects served by Stage OTT */
export const DIALECTS = [
  'haryanvi',
  'rajasthani',
  'bhojpuri',
  'gujarati',
] as const;

export type Dialect = (typeof DIALECTS)[number];

/** Content types on Stage */
export type ContentType = 'show' | 'movie' | 'micro_drama';

/** Priority levels for content suggestions */
export type Priority = 'critical' | 'high' | 'medium' | 'low';

/** Status of a content suggestion */
export type SuggestionStatus = 'new' | 'reviewed' | 'accepted' | 'rejected' | 'implemented';

/** Source of the gap detection */
export type GapSource = 'serp_gap' | 'keyword_gap' | 'content_type_gap' | 'dialect_gap' | 'trending_gap';

/** A SERP result from competitor analysis */
export interface SerpResult {
  query: string;
  position: number;
  url: string;
  title: string;
  snippet: string;
  domain: string;
  fetchedAt: string;
}

/** Competitor content presence for a keyword */
export interface CompetitorPresence {
  keyword: string;
  dialect: Dialect | null;
  competitorResults: SerpResult[];
  stagePresent: boolean;
  stagePosition: number | null;
}

/** A content suggestion derived from gap analysis */
export interface ContentSuggestion {
  id?: number;
  keyword: string;
  dialect: Dialect | null;
  suggestedContentType: ContentType;
  gapSource: GapSource;
  competitorUrls: string; // JSON array of competitor URLs covering this topic
  competitorDomains: string; // JSON array of competitor domains
  title: string;
  description: string;
  priority: Priority;
  status: SuggestionStatus;
  estimatedSearchVolume: number | null;
  stageCurrentPosition: number | null;
  bestCompetitorPosition: number;
  createdAt: string;
  updatedAt: string;
}

/** Summary stats from a gap analysis run */
export interface GapAnalysisRun {
  id?: number;
  runAt: string;
  keywordsAnalyzed: number;
  gapsFound: number;
  suggestionsCreated: number;
  dialectsCovered: string; // JSON array
  competitorsCovered: string; // JSON array
}

/** Competitor position record for time-series tracking */
export interface CompetitorPosition {
  id?: number;
  keyword: string;
  domain: string;
  position: number;
  url: string;
  title: string;
  isStage: boolean;
  isCompetitor: boolean;
  trackedAt: string;
}

/** Brand mention types */
export type MentionType = 'direct' | 'competitor_comparison' | 'review' | 'news' | 'forum';
export type Sentiment = 'positive' | 'negative' | 'neutral';

/** Brand mention detected in SERP */
export interface BrandMention {
  id?: number;
  query: string;
  domain: string;
  url: string;
  title: string;
  snippet: string;
  mentionType: MentionType;
  sentiment: Sentiment;
  detectedAt: string;
}

/** Position comparison between two tracking runs */
export interface PositionChange {
  keyword: string;
  domain: string;
  previousPosition: number | null;
  currentPosition: number;
  delta: number | null;
  direction: 'improved' | 'dropped' | 'stable' | 'new_entry' | 'lost';
}

/** Keyword seed for analysis */
export interface KeywordSeed {
  keyword: string;
  dialect: Dialect | null;
  category: string;
  searchIntent: 'informational' | 'navigational' | 'transactional';
}
