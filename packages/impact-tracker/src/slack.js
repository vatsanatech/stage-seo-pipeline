/**
 * Slack notification module.
 *
 * Sends ROI summary reports and alert notifications via Slack webhook.
 */

const https = require('https');
const http = require('http');
const config = require('./config');

/**
 * Send a message to Slack via webhook.
 *
 * @param {object} payload - Slack message payload (blocks or text)
 * @returns {Promise<boolean>} true if sent successfully
 */
async function sendSlackMessage(payload) {
  const webhookUrl = config.slack.webhookUrl;
  if (!webhookUrl) {
    console.log('[Slack] No webhook URL configured - printing message locally:');
    console.log(JSON.stringify(payload, null, 2));
    return false;
  }

  const url = new URL(webhookUrl);
  const transport = url.protocol === 'https:' ? https : http;
  const body = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = transport.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

/**
 * Format a single impact result for Slack display.
 */
function formatImpactBlock(impact) {
  const emoji = impact.roiScore > 0 ? ':chart_with_upwards_trend:' : impact.roiScore < 0 ? ':chart_with_downwards_trend:' : ':minus:';
  const alertEmoji = impact.alerts.some(a => a.type === 'regression') ? ':warning:' : '';

  let text = `${emoji} *${impact.pageUrl}*\n`;
  text += `> Fix: ${impact.fixDescription || 'N/A'} (${impact.fixDate.split('T')[0]})\n`;
  text += `> ROI Score: *${impact.roiScore}*\n`;

  if (impact.gscAvailable) {
    text += `> CTR: ${(impact.baseline.ctr * 100).toFixed(2)}% → ${(impact.postFix.ctr * 100).toFixed(2)}% (${impact.delta.ctrDeltaPercent >= 0 ? '+' : ''}${impact.delta.ctrDeltaPercent.toFixed(1)}%)\n`;
    text += `> Clicks: ${impact.baseline.clicks} → ${impact.postFix.clicks} (${impact.delta.clicksDelta >= 0 ? '+' : ''}${impact.delta.clicksDelta})\n`;
    text += `> Position: ${impact.baseline.position.toFixed(1)} → ${impact.postFix.position.toFixed(1)}\n`;
  } else {
    text += `> _GSC data unavailable - metrics pending_\n`;
  }

  if (impact.alerts.length > 0) {
    text += `> ${alertEmoji} Alerts: ${impact.alerts.map(a => `${a.type}: ${a.metric} ${a.change}`).join(', ')}\n`;
  }

  return text;
}

/**
 * Send a weekly ROI summary report to Slack.
 *
 * @param {object[]} impacts - Array of impact entries to summarize
 */
async function sendRoiSummary(impacts) {
  if (impacts.length === 0) {
    console.log('[Slack] No impacts to report.');
    return false;
  }

  const improvements = impacts.filter(i => i.roiScore > 0);
  const regressions = impacts.filter(i => i.roiScore < 0);
  const avgRoi = impacts.reduce((sum, i) => sum + i.roiScore, 0) / impacts.length;

  let summaryText = `:bar_chart: *SEO Fix Impact Report*\n\n`;
  summaryText += `*${impacts.length}* fixes tracked | *${improvements.length}* improved | *${regressions.length}* regressed\n`;
  summaryText += `Average ROI Score: *${avgRoi.toFixed(1)}*\n\n`;
  summaryText += `---\n\n`;

  for (const impact of impacts) {
    summaryText += formatImpactBlock(impact) + '\n';
  }

  const payload = {
    channel: config.slack.channel,
    text: summaryText,
    unfurl_links: false,
  };

  return sendSlackMessage(payload);
}

/**
 * Send an alert for significant changes (>10% CTR lift or >5% position drop).
 *
 * @param {object} impact - Single impact entry with alerts
 */
async function sendAlert(impact) {
  if (!impact.alerts || impact.alerts.length === 0) return false;

  const isRegression = impact.alerts.some(a => a.type === 'regression');
  const emoji = isRegression ? ':rotating_light:' : ':tada:';

  let text = `${emoji} *SEO Impact Alert*\n\n`;
  text += formatImpactBlock(impact);

  return sendSlackMessage({
    channel: config.slack.channel,
    text,
    unfurl_links: false,
  });
}

module.exports = { sendSlackMessage, sendRoiSummary, sendAlert, formatImpactBlock };
