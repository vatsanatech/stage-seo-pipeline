export { getDatabase, saveDatabase, closeDatabase } from './db/schema.js';
export {
  getOpenAuditIssues,
  insertAuditIssue,
  updateAuditIssueStatus,
  startAgentRun,
  finishAgentRun,
  getPendingContentSuggestions,
  insertContentSuggestion,
  getPendingLinkSuggestions,
  getLatestGeoScores,
  insertGeoScore,
} from './db/repository.js';
export type {
  Keyword,
  AuditIssue,
  TrendSnapshot,
  ContentSuggestion,
  LinkGraphEntry,
  LinkSuggestion,
  GeoScore,
  AgentRun,
} from './models/types.js';
