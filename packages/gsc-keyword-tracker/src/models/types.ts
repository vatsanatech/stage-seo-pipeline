/** Dialects served by Stage OTT */
export const DIALECTS = [
  'haryanvi',
  'rajasthani',
  'bhojpuri',
  'gujarati',
] as const;

export type Dialect = (typeof DIALECTS)[number];

/** Trend direction for a keyword */
export type TrendDirection = 'rising' | 'declining' | 'stable' | 'new' | 'lost';

/** A keyword record from GSC */
export interface KeywordRecord {
  id?: number;
  query: string;
  dialect: Dialect | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  date: string; // YYYY-MM-DD
  device: string; // 'mobile' | 'desktop' | 'tablet'
  country: string;
  fetchedAt: string;
}

/** Keyword with trend analysis */
export interface KeywordTrend {
  query: string;
  dialect: Dialect | null;
  direction: TrendDirection;
  currentClicks: number;
  previousClicks: number;
  clicksDelta: number;
  clicksDeltaPct: number;
  currentImpressions: number;
  previousImpressions: number;
  impressionsDelta: number;
  currentPosition: number;
  previousPosition: number;
  positionDelta: number;
  currentCtr: number;
  previousCtr: number;
}

/** GSC API query request */
export interface GscQueryRequest {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowLimit?: number;
  startRow?: number;
  dimensionFilterGroups?: DimensionFilterGroup[];
}

export interface DimensionFilterGroup {
  filters: DimensionFilter[];
}

export interface DimensionFilter {
  dimension: string;
  operator: string;
  expression: string;
}

/** GSC API response row */
export interface GscResponseRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Tracker run metadata */
export interface TrackerRun {
  id?: number;
  runAt: string;
  periodStart: string;
  periodEnd: string;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  totalKeywords: number;
  risingKeywords: number;
  decliningKeywords: number;
  newKeywords: number;
  lostKeywords: number;
  dialectsCovered: string; // JSON array
}

/** Source of trend data */
export type TrendSource = 'gsc' | 'google_trends' | 'manual';

/** A single trend snapshot for keyword trajectory tracking */
export interface TrendSnapshot {
  id?: number;
  query: string;
  dialect: Dialect | null;
  source: TrendSource;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  trendIndex: number; // Normalized 0-100 interest score
  periodStart: string;
  periodEnd: string;
  snapshotAt: string;
}

/** Keyword trajectory over multiple snapshots */
export interface KeywordTrajectory {
  query: string;
  dialect: Dialect | null;
  snapshots: TrendSnapshot[];
  overallDirection: TrendDirection;
  velocityPct: number; // Rate of change
}

/** GSC auth config */
export interface GscAuthConfig {
  type: 'service_account' | 'oauth';
  serviceAccountKeyPath?: string;
  serviceAccountKey?: string; // JSON string
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
}
