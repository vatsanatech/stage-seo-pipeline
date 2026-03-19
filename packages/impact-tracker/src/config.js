/**
 * Configuration for the SEO Impact Tracker.
 * All settings can be overridden via environment variables.
 */

const path = require('path');

const config = {
  // Google Search Console
  gsc: {
    credentialsPath: process.env.GSC_CREDENTIALS_PATH || path.join(__dirname, '..', 'credentials', 'gsc-service-account.json'),
    siteUrl: process.env.GSC_SITE_URL || '', // e.g. 'https://example.com'
  },

  // Comparison windows
  tracking: {
    postFixDays: parseInt(process.env.POST_FIX_DAYS, 10) || 7,
    preFixBaselineDays: parseInt(process.env.PRE_FIX_BASELINE_DAYS, 10) || 7,
    readyCheckDays: parseInt(process.env.READY_CHECK_DAYS, 10) || 7,
  },

  // Thresholds for alerts
  thresholds: {
    ctrLiftPercent: parseFloat(process.env.CTR_LIFT_THRESHOLD) || 10,
    positionDropPercent: parseFloat(process.env.POSITION_DROP_THRESHOLD) || 5,
  },

  // Slack
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
    channel: process.env.SLACK_CHANNEL || '#seo-alerts',
  },

  // Data storage
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  fixesDbFile: process.env.FIXES_DB_FILE || 'fixes.json',
  impactDbFile: process.env.IMPACT_DB_FILE || 'impact-history.json',
};

module.exports = config;
