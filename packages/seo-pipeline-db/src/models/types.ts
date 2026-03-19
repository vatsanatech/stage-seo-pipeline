export interface Keyword {
  id: number;
  query: string;
  dialect: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  date: string;
  device: string;
  country: string;
  fetched_at: string;
}

export interface AuditIssue {
  id: number;
  url: string;
  issue_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  suggested_fix: string | null;
  fix_status: 'open' | 'in_progress' | 'fixed' | 'wont_fix';
  pr_url: string | null;
  detected_at: string;
  fixed_at: string | null;
}

export interface TrendSnapshot {
  id: number;
  query: string;
  direction: 'rising' | 'declining' | 'stable' | 'new' | 'lost';
  current_clicks: number;
  previous_clicks: number;
  clicks_delta: number;
  clicks_delta_pct: number;
  current_position: number;
  previous_position: number;
  position_delta: number;
  current_ctr: number;
  previous_ctr: number;
  snapshot_date: string;
}

export interface ContentSuggestion {
  id: number;
  url: string;
  suggestion_type: string;
  title: string;
  body: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'accepted' | 'rejected' | 'applied';
  created_at: string;
}

export interface LinkGraphEntry {
  id: number;
  source_url: string;
  target_url: string;
  anchor_text: string;
  crawled_at: string;
}

export interface LinkSuggestion {
  id: number;
  source_url: string;
  target_url: string;
  suggested_anchor_text: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

export interface GeoScore {
  id: number;
  url: string;
  score_type: string;
  score: number;
  details: string | null;
  measured_at: string;
}

export interface AgentRun {
  id: number;
  agent_name: string;
  run_type: string;
  status: 'running' | 'success' | 'failure';
  started_at: string;
  finished_at: string | null;
  items_processed: number;
  items_failed: number;
  summary: string | null;
}
