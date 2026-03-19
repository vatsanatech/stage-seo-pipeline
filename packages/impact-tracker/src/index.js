#!/usr/bin/env node

/**
 * SEO Impact Tracker - Main entry point & CLI.
 *
 * Commands:
 *   register  - Register a new fix for tracking
 *   check-ready - List fixes ready for impact measurement
 *   track     - Run impact tracking on all ready fixes
 *   report    - Generate and send ROI summary report
 */

const db = require('./db');
const compare = require('./compare');
const slack = require('./slack');

const command = process.argv[2] || 'help';

async function main() {
  switch (command) {
    case 'register': {
      const pageUrl = process.argv[3] || process.env.FIX_PAGE_URL;
      const fixDescription = process.argv[4] || process.env.FIX_DESCRIPTION || '';
      const fixDate = process.argv[5] || process.env.FIX_DATE || new Date().toISOString();
      const deployAgent = process.argv[6] || process.env.DEPLOY_AGENT || 'unknown';

      if (!pageUrl) {
        console.error('Usage: node src/index.js register <pageUrl> [description] [fixDate] [deployAgent]');
        process.exit(1);
      }

      const fix = db.registerFix({ pageUrl, fixDescription, fixDate, deployAgent });
      console.log(`Registered fix: ${fix.id}`);
      console.log(`  Page: ${fix.pageUrl}`);
      console.log(`  Fix date: ${fix.fixDate}`);
      console.log(`  Status: ${fix.status}`);
      console.log(`  Will be ready for tracking in ${require('./config').tracking.readyCheckDays} days.`);
      break;
    }

    case 'check-ready': {
      const ready = db.getFixesReadyForTracking();
      if (ready.length === 0) {
        console.log('No fixes are ready for tracking yet.');
        const pending = db.getPendingFixes();
        if (pending.length > 0) {
          console.log(`\n${pending.length} fix(es) still in waiting period:`);
          for (const f of pending) {
            const daysLeft = Math.ceil(
              (new Date(f.fixDate).getTime() + require('./config').tracking.readyCheckDays * 86400000 - Date.now()) / 86400000
            );
            console.log(`  - ${f.pageUrl} (${Math.max(0, daysLeft)} days remaining)`);
          }
        }
      } else {
        console.log(`${ready.length} fix(es) ready for impact tracking:`);
        for (const f of ready) {
          console.log(`  - ${f.pageUrl} (fixed ${f.fixDate.split('T')[0]})`);
        }
      }
      break;
    }

    case 'track': {
      console.log('Starting impact tracking run...\n');
      const results = await compare.trackAllReady();

      if (results.length > 0) {
        console.log(`\n--- Tracking Complete ---`);
        console.log(`Tracked ${results.length} fix(es).`);

        // Send alerts for significant changes
        for (const result of results) {
          if (result.alerts && result.alerts.length > 0) {
            await slack.sendAlert(result);
          }
        }

        // Send summary
        await slack.sendRoiSummary(results);
      }
      break;
    }

    case 'report': {
      const impacts = db.getAllImpact();
      if (impacts.length === 0) {
        console.log('No impact data recorded yet. Run "track" first.');
        break;
      }

      // Default: report on last 7 days of tracked impacts
      const since = new Date();
      since.setDate(since.getDate() - 7);
      const recent = impacts.filter(i => new Date(i.trackedAt) >= since);

      if (recent.length === 0) {
        console.log('No recent impact data (last 7 days). Showing all-time summary.\n');
        await slack.sendRoiSummary(impacts);
      } else {
        console.log(`Generating report for ${recent.length} recent impact(s)...\n`);
        await slack.sendRoiSummary(recent);
      }
      break;
    }

    case 'status': {
      const fixes = db.getAllFixes();
      const impacts = db.getAllImpact();
      console.log('=== SEO Impact Tracker Status ===');
      console.log(`Total fixes registered: ${fixes.length}`);
      console.log(`  Pending: ${fixes.filter(f => f.status === 'pending').length}`);
      console.log(`  Tracked: ${fixes.filter(f => f.status === 'tracked').length}`);
      console.log(`  Errors: ${fixes.filter(f => f.status === 'error').length}`);
      console.log(`Total impact records: ${impacts.length}`);
      if (impacts.length > 0) {
        const avgRoi = impacts.reduce((s, i) => s + i.roiScore, 0) / impacts.length;
        console.log(`  Average ROI score: ${avgRoi.toFixed(1)}`);
      }
      break;
    }

    case 'help':
    default:
      console.log(`SEO Impact Tracker - Track and measure SEO fix ROI

Usage: node src/index.js <command> [options]

Commands:
  register <url> [desc] [date] [agent]  Register a fix for tracking
  check-ready                           List fixes ready for measurement
  track                                 Run impact tracking on ready fixes
  report                                Generate and send ROI summary
  status                                Show tracker status summary
  help                                  Show this help message

Environment Variables:
  GSC_CREDENTIALS_PATH  Path to Google Search Console service account JSON
  GSC_SITE_URL          Site URL in GSC (e.g. https://example.com)
  SLACK_WEBHOOK_URL     Slack incoming webhook URL
  SLACK_CHANNEL         Slack channel (default: #seo-alerts)
  POST_FIX_DAYS         Days to wait before measuring (default: 7)
  PRE_FIX_BASELINE_DAYS Baseline comparison window (default: 7)
`);
      break;
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
