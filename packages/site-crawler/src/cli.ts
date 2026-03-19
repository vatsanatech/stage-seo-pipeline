import { getDatabase, saveDatabase, closeDatabase } from './db/schema.js';
import { runAudit } from './audit/runner.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help') {
    console.log(`
Site Crawler — Technical SEO Audit

Usage:
  node cli.js crawl <url> [options]

Options:
  --max-pages <n>    Maximum pages to crawl (default: 500)
  --max-depth <n>    Maximum link depth (default: 10)
  --concurrency <n>  Concurrent page loads (default: 3)
  --db <path>        Database file path (default: seo_audit.db)
  --verbose          Print progress during crawl
`);
    process.exit(0);
  }

  if (command === 'crawl') {
    const url = args[1];
    if (!url) {
      console.error('Error: Please provide a URL to crawl');
      process.exit(1);
    }

    const getArg = (flag: string): string | undefined => {
      const idx = args.indexOf(flag);
      return idx >= 0 ? args[idx + 1] : undefined;
    };

    const dbPath = getArg('--db') || 'seo_audit.db';
    const maxPages = parseInt(getArg('--max-pages') || '500', 10);
    const maxDepth = parseInt(getArg('--max-depth') || '10', 10);
    const concurrency = parseInt(getArg('--concurrency') || '3', 10);
    const verbose = args.includes('--verbose');

    const db = await getDatabase(dbPath);

    try {
      console.log(`\nCrawling ${url} (max ${maxPages} pages, depth ${maxDepth})...\n`);

      const report = await runAudit(db, {
        startUrl: url,
        maxPages,
        maxDepth,
        concurrency,
      }, { verbose });

      saveDatabase(db, dbPath);

      console.log('\n=== SEO Audit Report ===\n');
      console.log(`Pages Crawled: ${report.summary.totalPages}`);
      console.log(`Total Issues: ${report.summary.totalIssues}`);
      console.log(`  Critical: ${report.summary.critical}`);
      console.log(`  Warning: ${report.summary.warning}`);
      console.log(`  Info: ${report.summary.info}`);

      console.log('\n--- Issues by Category ---');
      for (const [category, issues] of Object.entries(report.issuesByCategory)) {
        console.log(`\n  ${category} (${issues.length}):`);
        for (const iss of issues.slice(0, 10)) {
          console.log(`    [${iss.severity}] ${iss.url}`);
          console.log(`      ${iss.message}`);
        }
        if (issues.length > 10) {
          console.log(`    ... and ${issues.length - 10} more`);
        }
      }

      console.log('\n--- JSON Summary ---');
      console.log(JSON.stringify(report.summary, null, 2));
    } finally {
      closeDatabase();
    }
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
