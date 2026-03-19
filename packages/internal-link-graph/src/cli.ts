import { readFileSync } from 'node:fs';
import { getDatabase, saveDatabase, closeDatabase } from './db/schema.js';
import { analyzeGraph, importLinks } from './analysis/analyzer.js';
import { analyzeAnchorTexts, getAnchorDistribution } from './analysis/anchor-text.js';
import type { LinkGraphEdge } from './models/types.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help') {
    console.log(`
Internal Link Graph Analyzer

Usage:
  node cli.js import <json-file>    Import link edges from JSON file
  node cli.js analyze [db-path]     Run full analysis on the link graph
  node cli.js stats [db-path]       Show graph statistics
  node cli.js orphans [db-path]     List orphan pages
  node cli.js suggestions [db-path] List link suggestions
  node cli.js anchors [db-path]     Analyze anchor text distribution
  node cli.js anchors-for <url> [db-path]  Show anchor texts for a URL

JSON file format:
  [{ "sourceUrl": "...", "targetUrl": "...", "anchorText": "...", "crawledAt": "..." }, ...]
`);
    process.exit(0);
  }

  const dbPath = command === 'import' ? (args[2] || 'link_graph.db') : (args[1] || 'link_graph.db');
  const db = await getDatabase(dbPath);

  try {
    switch (command) {
      case 'import': {
        const filePath = args[1];
        if (!filePath) {
          console.error('Error: Please provide a JSON file path');
          process.exit(1);
        }
        const data = JSON.parse(readFileSync(filePath, 'utf-8')) as LinkGraphEdge[];
        const count = importLinks(db, data);
        saveDatabase(db, dbPath);
        console.log(`Imported ${count} link edges into ${dbPath}`);
        break;
      }

      case 'analyze': {
        const result = analyzeGraph(db);
        saveDatabase(db, dbPath);

        console.log('\n=== Link Graph Analysis ===\n');
        console.log(`Total Pages: ${result.stats.totalPages}`);
        console.log(`Total Links: ${result.stats.totalLinks}`);
        console.log(`Orphan Pages: ${result.stats.orphanPages}`);
        console.log(`Avg Inbound Links: ${result.stats.avgInboundLinks.toFixed(2)}`);
        console.log(`Avg Outbound Links: ${result.stats.avgOutboundLinks.toFixed(2)}`);

        if (result.stats.maxPagerank.url) {
          console.log(`\nHighest PageRank: ${result.stats.maxPagerank.url} (${result.stats.maxPagerank.score.toFixed(6)})`);
        }

        console.log('\n--- Top Authorities (HITS) ---');
        for (const page of result.stats.topAuthorities.slice(0, 5)) {
          console.log(`  ${page.url} — authority: ${page.authorityScore.toFixed(4)}, inbound: ${page.inboundLinks}`);
        }

        console.log('\n--- Top Hubs (HITS) ---');
        for (const page of result.stats.topHubs.slice(0, 5)) {
          console.log(`  ${page.url} — hub: ${page.hubScore.toFixed(4)}, outbound: ${page.outboundLinks}`);
        }

        if (result.orphanPages.length) {
          console.log(`\n--- Orphan Pages (${result.orphanPages.length}) ---`);
          for (const orphan of result.orphanPages.slice(0, 20)) {
            console.log(`  ${orphan.url} — ${orphan.reason}`);
          }
        }

        if (result.suggestions.length) {
          console.log(`\n--- Link Suggestions (${result.suggestions.length}) ---`);
          for (const s of result.suggestions.slice(0, 20)) {
            console.log(`  [${s.priority}] ${s.sourceUrl} → ${s.targetUrl}`);
            console.log(`    Anchor: "${s.suggestedAnchorText}" | ${s.reason}`);
          }
        }

        // Output JSON summary to stdout for programmatic use
        console.log('\n--- JSON Summary ---');
        console.log(JSON.stringify({
          stats: result.stats,
          orphanCount: result.orphanPages.length,
          suggestionCount: result.suggestions.length,
        }, null, 2));
        break;
      }

      case 'stats': {
        const result = analyzeGraph(db);
        console.log(JSON.stringify(result.stats, null, 2));
        break;
      }

      case 'orphans': {
        const result = analyzeGraph(db);
        console.log(JSON.stringify(result.orphanPages, null, 2));
        break;
      }

      case 'suggestions': {
        const result = analyzeGraph(db);
        saveDatabase(db, dbPath);
        console.log(JSON.stringify(result.suggestions, null, 2));
        break;
      }

      case 'anchors': {
        const report = analyzeAnchorTexts(db);

        console.log('\n=== Anchor Text Analysis ===\n');
        console.log(`Total Links: ${report.totalLinks}`);
        console.log(`Unique Anchor Texts: ${report.uniqueAnchorTexts}`);
        console.log(`Generic Anchor Rate: ${(report.genericAnchorRate * 100).toFixed(1)}%`);
        console.log(`Empty Anchor Rate: ${(report.emptyAnchorRate * 100).toFixed(1)}%`);

        if (report.issues.length) {
          console.log(`\n--- Anchor Text Issues (${report.issues.length}) ---`);
          for (const iss of report.issues.slice(0, 30)) {
            console.log(`  [${iss.severity}] ${iss.type}: ${iss.message}`);
          }
          if (report.issues.length > 30) {
            console.log(`  ... and ${report.issues.length - 30} more`);
          }
        }

        console.log('\n--- Top Anchor Text Profiles ---');
        for (const profile of report.profiles.slice(0, 15)) {
          console.log(`\n  ${profile.targetUrl}`);
          console.log(`    Total inbound: ${profile.totalLinks}, Unique anchors: ${profile.uniqueAnchors}`);
          console.log(`    Top anchor: "${profile.topAnchor}"`);
          if (profile.genericAnchors.length) {
            console.log(`    Generic anchors: ${profile.genericAnchors.join(', ')}`);
          }
        }

        console.log('\n--- JSON Summary ---');
        console.log(JSON.stringify({
          totalLinks: report.totalLinks,
          uniqueAnchorTexts: report.uniqueAnchorTexts,
          genericAnchorRate: report.genericAnchorRate,
          emptyAnchorRate: report.emptyAnchorRate,
          issueCount: report.issues.length,
          profileCount: report.profiles.length,
        }, null, 2));
        break;
      }

      case 'anchors-for': {
        const targetUrl = args[1];
        if (!targetUrl) {
          console.error('Error: Please provide a target URL');
          process.exit(1);
        }
        const dist = getAnchorDistribution(db, targetUrl);
        console.log(`\nAnchor text distribution for: ${targetUrl}\n`);
        for (const [text, count] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
          console.log(`  "${text}" × ${count}`);
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } finally {
    closeDatabase();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
