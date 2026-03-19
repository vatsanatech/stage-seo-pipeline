import type { KeywordTrend, Dialect } from '../models/types.js';
import {
  sendSlackWebhook,
  buildAttachment,
  type Severity,
  type SlackPayload,
  type SlackSendResult,
  SEVERITY_COLORS,
} from './slack-client.js';

/** Alert thresholds for keyword drops */
export interface AlertThresholds {
  /** Clicks drop % to trigger critical alert (default: -50) */
  criticalDropPct: number;
  /** Clicks drop % to trigger high alert (default: -30) */
  highDropPct: number;
  /** Clicks drop % to trigger medium alert (default: -20) */
  mediumDropPct: number;
  /** Minimum clicks in previous period to be worth alerting (default: 50) */
  minPreviousClicks: number;
  /** Position drop to trigger alert (default: 3) */
  positionDropThreshold: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  criticalDropPct: -50,
  highDropPct: -30,
  mediumDropPct: -20,
  minPreviousClicks: 50,
  positionDropThreshold: 3,
};

/** An alert generated from keyword trend analysis */
export interface KeywordAlert {
  keyword: string;
  dialect: Dialect | null;
  severity: Severity;
  reason: string;
  clicksDelta: number;
  clicksDeltaPct: number;
  positionDelta: number;
  currentClicks: number;
  previousClicks: number;
  currentPosition: number;
  previousPosition: number;
}

/**
 * Evaluate keyword trends and generate alerts for significant drops.
 */
export function evaluateAlerts(
  trends: KeywordTrend[],
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS
): KeywordAlert[] {
  const alerts: KeywordAlert[] = [];

  for (const trend of trends) {
    // Skip keywords with too few previous clicks
    if (trend.previousClicks < thresholds.minPreviousClicks) continue;

    // Skip non-declining keywords
    if (trend.direction !== 'declining' && trend.direction !== 'lost') continue;

    const severity = classifySeverity(trend, thresholds);
    if (!severity) continue;

    const reason = buildAlertReason(trend, severity);

    alerts.push({
      keyword: trend.query,
      dialect: trend.dialect,
      severity,
      reason,
      clicksDelta: trend.clicksDelta,
      clicksDeltaPct: trend.clicksDeltaPct,
      positionDelta: trend.positionDelta,
      currentClicks: trend.currentClicks,
      previousClicks: trend.previousClicks,
      currentPosition: trend.currentPosition,
      previousPosition: trend.previousPosition,
    });
  }

  // Sort by severity (critical first) then by absolute drop
  return alerts.sort((a, b) => {
    const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return a.clicksDelta - b.clicksDelta; // Most negative first
  });
}

/**
 * Send keyword drop alerts to Slack.
 * Groups alerts into a summary message + individual critical/high alerts as thread replies.
 */
export async function sendKeywordAlerts(
  webhookUrl: string,
  alerts: KeywordAlert[],
  threadTs?: string
): Promise<SlackSendResult[]> {
  if (alerts.length === 0) return [];

  const results: SlackSendResult[] = [];

  // Build summary message
  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const highCount = alerts.filter((a) => a.severity === 'high').length;
  const mediumCount = alerts.filter((a) => a.severity === 'medium').length;

  const summaryEmoji = criticalCount > 0 ? ':rotating_light:' : highCount > 0 ? ':warning:' : ':chart_with_downwards_trend:';
  const summaryText = `${summaryEmoji} *Keyword Drop Alert* — ${alerts.length} keyword(s) declining`;

  const summaryAttachment = buildAttachment(
    criticalCount > 0 ? 'critical' : highCount > 0 ? 'high' : 'medium',
    `${alerts.length} Keywords Dropping`,
    [
      criticalCount > 0 ? `:red_circle: ${criticalCount} critical` : null,
      highCount > 0 ? `:orange_circle: ${highCount} high` : null,
      mediumCount > 0 ? `:yellow_circle: ${mediumCount} medium` : null,
    ].filter(Boolean).join('  |  '),
    buildSummaryFields(alerts)
  );

  const summaryPayload: SlackPayload = {
    text: summaryText,
    username: 'SEO Keyword Monitor',
    icon_emoji: ':mag:',
    thread_ts: threadTs,
    attachments: [summaryAttachment],
  };

  const summaryResult = await sendSlackWebhook(webhookUrl, summaryPayload);
  results.push(summaryResult);

  // Send individual detail messages for critical and high alerts as thread replies
  const detailAlerts = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high');
  for (const alert of detailAlerts.slice(0, 10)) { // Cap at 10 to avoid spam
    const detailPayload = buildDetailPayload(alert, threadTs || summaryResult.ts);
    const detailResult = await sendSlackWebhook(webhookUrl, detailPayload);
    results.push(detailResult);
  }

  return results;
}

function classifySeverity(trend: KeywordTrend, thresholds: AlertThresholds): Severity | null {
  // Lost keywords are always critical if they had significant traffic
  if (trend.direction === 'lost' && trend.previousClicks >= thresholds.minPreviousClicks * 2) {
    return 'critical';
  }

  // Classify by clicks drop percentage
  if (trend.clicksDeltaPct <= thresholds.criticalDropPct) return 'critical';
  if (trend.clicksDeltaPct <= thresholds.highDropPct) return 'high';
  if (trend.clicksDeltaPct <= thresholds.mediumDropPct) return 'medium';

  // Also alert on significant position drops
  if (trend.positionDelta <= -thresholds.positionDropThreshold && trend.previousClicks >= thresholds.minPreviousClicks) {
    return 'medium';
  }

  return null;
}

function buildAlertReason(trend: KeywordTrend, severity: Severity): string {
  if (trend.direction === 'lost') {
    return `Keyword completely lost — was getting ${trend.previousClicks} clicks, now 0`;
  }

  const parts: string[] = [];
  if (trend.clicksDeltaPct < 0) {
    parts.push(`clicks dropped ${Math.abs(trend.clicksDeltaPct)}%`);
  }
  if (trend.positionDelta < -2) {
    parts.push(`position dropped ${Math.abs(trend.positionDelta)} places`);
  }

  return parts.join(', ') || `${severity} keyword decline detected`;
}

function buildSummaryFields(alerts: KeywordAlert[]): Array<{ title: string; value: string; short: boolean }> {
  const fields: Array<{ title: string; value: string; short: boolean }> = [];

  // Top declining keywords
  const topDrops = alerts.slice(0, 5);
  fields.push({
    title: 'Top Drops',
    value: topDrops.map((a) => {
      const dialectTag = a.dialect ? ` [${a.dialect}]` : '';
      return `• "${a.keyword}"${dialectTag}: ${a.clicksDelta} clicks (${a.clicksDeltaPct}%)`;
    }).join('\n'),
    short: false,
  });

  // Dialect breakdown
  const dialectCounts: Record<string, number> = {};
  for (const alert of alerts) {
    const key = alert.dialect || 'general';
    dialectCounts[key] = (dialectCounts[key] || 0) + 1;
  }
  fields.push({
    title: 'By Dialect',
    value: Object.entries(dialectCounts).map(([d, c]) => `${d}: ${c}`).join(', '),
    short: true,
  });

  return fields;
}

function buildDetailPayload(alert: KeywordAlert, threadTs?: string): SlackPayload {
  const dialectTag = alert.dialect ? ` [${alert.dialect}]` : '';

  return {
    username: 'SEO Keyword Monitor',
    icon_emoji: ':mag:',
    thread_ts: threadTs,
    attachments: [
      buildAttachment(
        alert.severity,
        `${alert.severity === 'critical' ? ':red_circle:' : ':orange_circle:'} "${alert.keyword}"${dialectTag}`,
        alert.reason,
        [
          { title: 'Clicks', value: `${alert.previousClicks} → ${alert.currentClicks} (${alert.clicksDelta >= 0 ? '+' : ''}${alert.clicksDelta})`, short: true },
          { title: 'Position', value: `${alert.previousPosition.toFixed(1)} → ${alert.currentPosition.toFixed(1)} (${alert.positionDelta >= 0 ? '+' : ''}${alert.positionDelta.toFixed(1)})`, short: true },
          { title: 'Drop %', value: `${alert.clicksDeltaPct}%`, short: true },
          { title: 'Severity', value: alert.severity.toUpperCase(), short: true },
        ]
      ),
    ],
  };
}
