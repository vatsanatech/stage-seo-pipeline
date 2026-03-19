import { request } from 'node:https';

/** Slack Block Kit attachment colors */
export const SEVERITY_COLORS = {
  critical: '#FF0000', // Red
  high: '#FF6600',     // Orange
  medium: '#FFCC00',   // Yellow
  low: '#36A64F',      // Green
  info: '#2196F3',     // Blue
} as const;

export type Severity = keyof typeof SEVERITY_COLORS;

/** Slack message attachment */
export interface SlackAttachment {
  color: string;
  title: string;
  text: string;
  fields?: Array<{ title: string; value: string; short?: boolean }>;
  footer?: string;
  ts?: number;
}

/** Slack webhook payload */
export interface SlackPayload {
  text?: string;
  channel?: string;
  username?: string;
  icon_emoji?: string;
  thread_ts?: string;
  attachments?: SlackAttachment[];
  blocks?: unknown[];
}

/** Result from sending a Slack message */
export interface SlackSendResult {
  ok: boolean;
  ts?: string; // Thread timestamp for replies
  error?: string;
}

/**
 * Send a message to Slack via incoming webhook.
 */
export async function sendSlackWebhook(
  webhookUrl: string,
  payload: SlackPayload
): Promise<SlackSendResult> {
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const parsed = new URL(webhookUrl);

    const req = request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const responseText = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode === 200) {
            resolve({ ok: true, ts: undefined });
          } else {
            resolve({ ok: false, error: `HTTP ${res.statusCode}: ${responseText}` });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Request timeout' });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.write(body);
    req.end();
  });
}

/**
 * Build a severity-colored attachment for Slack.
 */
export function buildAttachment(
  severity: Severity,
  title: string,
  text: string,
  fields?: Array<{ title: string; value: string; short?: boolean }>
): SlackAttachment {
  return {
    color: SEVERITY_COLORS[severity],
    title,
    text,
    fields,
    footer: 'Stage SEO Keyword Monitor',
    ts: Math.floor(Date.now() / 1000),
  };
}
