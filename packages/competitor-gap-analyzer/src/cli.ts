import { runAnalysis, getSuggestions } from './index.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'analyze';

  switch (command) {
    case 'analyze': {
      const maxKeywords = args.includes('--max') ? parseInt(args[args.indexOf('--max') + 1], 10) : undefined;
      const dryRun = args.includes('--dry-run');
      const dbPath = getArgValue(args, '--db') || 'competitor_gaps.db';

      const result = await runAnalysis({ dbPath, maxKeywords, dryRun });
      console.log('\n=== Analysis Complete ===');
      console.log(`Keywords analyzed: ${result.keywordsAnalyzed}`);
      console.log(`Gaps found: ${result.gapsFound}`);
      console.log(`Suggestions created: ${result.suggestionsCreated}`);
      console.log(`Total suggestions in DB: ${result.totalSuggestions}`);
      console.log('By priority:', JSON.stringify(result.byPriority, null, 2));
      break;
    }

    case 'list': {
      const dbPath = getArgValue(args, '--db') || 'competitor_gaps.db';
      const dialect = getArgValue(args, '--dialect') || undefined;
      const priority = getArgValue(args, '--priority') || undefined;
      const status = getArgValue(args, '--status') || undefined;

      const suggestions = await getSuggestions(dbPath, { dialect, priority, status });
      console.log(`\n=== Content Suggestions (${suggestions.length}) ===\n`);

      for (const s of suggestions) {
        console.log(`[${s.priority.toUpperCase()}] ${s.title}`);
        console.log(`  Keyword: ${s.keyword} | Type: ${s.suggestedContentType} | Gap: ${s.gapSource}`);
        console.log(`  Competitors: ${s.competitorDomains}`);
        console.log(`  Stage position: ${s.stageCurrentPosition ?? 'NOT RANKING'} | Best competitor: #${s.bestCompetitorPosition}`);
        console.log(`  ${s.description}`);
        console.log();
      }
      break;
    }

    case 'help':
    default:
      console.log(`
Usage: competitor-gap-analyzer <command> [options]

Commands:
  analyze   Run competitor gap analysis (default)
  list      List existing content suggestions
  help      Show this help message

Options:
  --db <path>        Database file path (default: competitor_gaps.db)
  --max <n>          Max keywords to analyze
  --dry-run          Skip SERP scraping, just seed keywords
  --dialect <name>   Filter by dialect (haryanvi, rajasthani, bhojpuri, gujarati)
  --priority <level> Filter by priority (critical, high, medium, low)
  --status <status>  Filter by status (new, reviewed, accepted, rejected, implemented)
      `);
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
