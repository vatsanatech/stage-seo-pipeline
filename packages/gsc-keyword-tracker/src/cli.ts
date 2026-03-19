import { runTracker, runTrackerWithData } from './index.js';
import { getDatabase } from './db/schema.js';
import { getTrends, getTrendCounts } from './db/repository.js';
import type { GscAuthConfig, KeywordRecord } from './models/types.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'track';

  switch (command) {
    case 'track': {
      const siteUrl = getArgValue(args, '--site') || process.env.GSC_SITE_URL;
      const dbPath = getArgValue(args, '--db') || 'gsc_keywords.db';
      const demo = args.includes('--demo');

      if (demo) {
        console.log('[Demo mode] Running with synthetic data...\n');
        const result = await runDemoTracker(dbPath);
        printResult(result);
        break;
      }

      if (!siteUrl) {
        console.error('Error: --site or GSC_SITE_URL env var required');
        process.exit(1);
      }

      const authConfig = resolveAuthConfig();
      const result = await runTracker({ siteUrl, authConfig, dbPath });
      printResult(result);
      break;
    }

    case 'trends': {
      const dbPath = getArgValue(args, '--db') || 'gsc_keywords.db';
      const direction = getArgValue(args, '--direction') || undefined;
      const dialect = getArgValue(args, '--dialect') || undefined;
      const limit = getArgValue(args, '--limit') ? parseInt(getArgValue(args, '--limit')!, 10) : 20;

      const db = await getDatabase(dbPath);
      const trends = getTrends(db, { direction, dialect, limit });
      const counts = getTrendCounts(db);

      console.log(`\n=== Keyword Trends ===`);
      console.log(`Distribution:`, JSON.stringify(counts, null, 2));
      console.log(`\nShowing ${trends.length} trends:\n`);

      for (const t of trends) {
        const arrow = t.direction === 'rising' ? '↑' : t.direction === 'declining' ? '↓' : t.direction === 'new' ? '★' : t.direction === 'lost' ? '✗' : '→';
        const dialectTag = t.dialect ? `[${t.dialect}]` : '';
        console.log(`${arrow} ${t.query} ${dialectTag}`);
        console.log(`  Clicks: ${t.previousClicks} → ${t.currentClicks} (${t.clicksDelta >= 0 ? '+' : ''}${t.clicksDelta}, ${t.clicksDeltaPct}%)`);
        console.log(`  Position: ${t.previousPosition.toFixed(1)} → ${t.currentPosition.toFixed(1)} (${t.positionDelta >= 0 ? '+' : ''}${t.positionDelta})`);
        console.log();
      }
      break;
    }

    case 'help':
    default:
      console.log(`
Usage: gsc-keyword-tracker <command> [options]

Commands:
  track     Fetch keywords from GSC and analyze trends (default)
  trends    Display stored keyword trends
  help      Show this help message

Options (track):
  --site <url>       GSC site URL (or set GSC_SITE_URL env var)
  --db <path>        Database file path (default: gsc_keywords.db)
  --demo             Run with synthetic demo data

Options (trends):
  --db <path>        Database file path
  --direction <dir>  Filter: rising, declining, stable, new, lost
  --dialect <name>   Filter: haryanvi, rajasthani, bhojpuri, gujarati
  --limit <n>        Max results (default: 20)

Environment Variables:
  GSC_SITE_URL             Site URL for GSC
  GSC_SERVICE_ACCOUNT_KEY  JSON service account key (inline)
  GSC_KEY_PATH             Path to service account key file
  GSC_CLIENT_ID            OAuth client ID
  GSC_CLIENT_SECRET        OAuth client secret
  GSC_REFRESH_TOKEN        OAuth refresh token
      `);
  }
}

function resolveAuthConfig(): GscAuthConfig {
  if (process.env.GSC_SERVICE_ACCOUNT_KEY || process.env.GSC_KEY_PATH) {
    return {
      type: 'service_account',
      serviceAccountKey: process.env.GSC_SERVICE_ACCOUNT_KEY,
      serviceAccountKeyPath: process.env.GSC_KEY_PATH,
    };
  }
  if (process.env.GSC_CLIENT_ID) {
    return {
      type: 'oauth',
      clientId: process.env.GSC_CLIENT_ID,
      clientSecret: process.env.GSC_CLIENT_SECRET,
      refreshToken: process.env.GSC_REFRESH_TOKEN,
    };
  }
  console.error('Error: No GSC auth configured. Set GSC_SERVICE_ACCOUNT_KEY, GSC_KEY_PATH, or GSC_CLIENT_ID');
  process.exit(1);
}

async function runDemoTracker(dbPath: string) {
  const currentKeywords: KeywordRecord[] = [
    { query: 'haryanvi web series', dialect: 'haryanvi', clicks: 450, impressions: 12000, ctr: 0.0375, position: 3.2, date: '2026-03-15', device: 'all', country: 'ind', fetchedAt: '' },
    { query: 'rajasthani movies online', dialect: 'rajasthani', clicks: 280, impressions: 8500, ctr: 0.033, position: 4.1, date: '2026-03-15', device: 'all', country: 'ind', fetchedAt: '' },
    { query: 'bhojpuri comedy shows', dialect: 'bhojpuri', clicks: 180, impressions: 6200, ctr: 0.029, position: 5.7, date: '2026-03-15', device: 'all', country: 'ind', fetchedAt: '' },
    { query: 'gujarati drama series', dialect: 'gujarati', clicks: 120, impressions: 4800, ctr: 0.025, position: 6.3, date: '2026-03-15', device: 'all', country: 'ind', fetchedAt: '' },
    { query: 'stage app download', dialect: null, clicks: 890, impressions: 15000, ctr: 0.059, position: 1.5, date: '2026-03-15', device: 'all', country: 'ind', fetchedAt: '' },
    { query: 'desi web series free', dialect: null, clicks: 320, impressions: 9000, ctr: 0.036, position: 7.2, date: '2026-03-15', device: 'all', country: 'ind', fetchedAt: '' },
    { query: 'haryanvi action movies', dialect: 'haryanvi', clicks: 150, impressions: 5000, ctr: 0.03, position: 8.1, date: '2026-03-15', device: 'all', country: 'ind', fetchedAt: '' },
    { query: 'sapna choudhary new show', dialect: 'haryanvi', clicks: 200, impressions: 7500, ctr: 0.027, position: 4.5, date: '2026-03-15', device: 'all', country: 'ind', fetchedAt: '' },
  ];

  const previousKeywords: KeywordRecord[] = [
    { query: 'haryanvi web series', dialect: 'haryanvi', clicks: 320, impressions: 10000, ctr: 0.032, position: 4.1, date: '2026-03-01', device: 'all', country: 'ind', fetchedAt: '' },
    { query: 'rajasthani movies online', dialect: 'rajasthani', clicks: 310, impressions: 9000, ctr: 0.034, position: 3.8, date: '2026-03-01', device: 'all', country: 'ind', fetchedAt: '' },
    { query: 'bhojpuri comedy shows', dialect: 'bhojpuri', clicks: 150, impressions: 5500, ctr: 0.027, position: 6.2, date: '2026-03-01', device: 'all', country: 'ind', fetchedAt: '' },
    { query: 'gujarati drama series', dialect: 'gujarati', clicks: 130, impressions: 5000, ctr: 0.026, position: 6.0, date: '2026-03-01', device: 'all', country: 'ind', fetchedAt: '' },
    { query: 'stage app download', dialect: null, clicks: 750, impressions: 13000, ctr: 0.058, position: 1.6, date: '2026-03-01', device: 'all', country: 'ind', fetchedAt: '' },
    { query: 'desi web series free', dialect: null, clicks: 350, impressions: 9500, ctr: 0.037, position: 6.8, date: '2026-03-01', device: 'all', country: 'ind', fetchedAt: '' },
    { query: 'bhojpuri film new', dialect: 'bhojpuri', clicks: 90, impressions: 3000, ctr: 0.03, position: 9.0, date: '2026-03-01', device: 'all', country: 'ind', fetchedAt: '' },
  ];

  return runTrackerWithData(currentKeywords, previousKeywords, dbPath);
}

function printResult(result: ReturnType<typeof runDemoTracker> extends Promise<infer T> ? T : never) {
  console.log('\n=== Tracking Complete ===');
  console.log(`Period: ${result.periodStart} to ${result.periodEnd}`);
  console.log(`Previous: ${result.previousPeriodStart} to ${result.previousPeriodEnd}`);
  console.log(`Total keywords: ${result.totalKeywords}`);
  console.log(`Rising: ${result.rising} | Declining: ${result.declining} | Stable: ${result.stable}`);
  console.log(`New: ${result.new_} | Lost: ${result.lost}`);
  console.log(`\nDialect distribution:`, JSON.stringify(result.dialectDistribution, null, 2));

  if (result.topRising.length > 0) {
    console.log(`\nTop rising keywords:`);
    for (const t of result.topRising.slice(0, 5)) {
      console.log(`  ↑ "${t.query}" [${t.dialect || 'general'}]: +${t.clicksDelta} clicks (${t.clicksDeltaPct}%)`);
    }
  }
  if (result.topDeclining.length > 0) {
    console.log(`\nTop declining keywords:`);
    for (const t of result.topDeclining.slice(0, 5)) {
      console.log(`  ↓ "${t.query}" [${t.dialect || 'general'}]: ${t.clicksDelta} clicks (${t.clicksDeltaPct}%)`);
    }
  }
}

function getArgValue(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
