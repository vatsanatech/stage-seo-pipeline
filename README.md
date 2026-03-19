# Stage SEO Pipeline

Monorepo for the Stage.in autonomous SEO optimization pipeline.

## Packages

| Package | Description |
|---------|-------------|
| `site-crawler` | Playwright-based site crawler, Core Web Vitals, image SEO, mobile usability, JS rendering, duplicate content, sitemap generator |
| `internal-link-graph` | Internal link graph analysis with PageRank/HITS, anchor text extraction, link suggestions |
| `gsc-keyword-tracker` | Google Search Console keyword tracking, dialect detection, trend analysis, Slack alerts, SerpBear sync |
| `backlink-analyzer` | CommonCrawl backlink analysis, link opportunity finder |
| `competitor-gap-analyzer` | SERP tracking, competitor gap detection, brand mention monitoring |
| `auto-fix-pipeline` | Auto-fix pipeline with TypeScript validation, GitHub PR management, GEO/link deployers |
| `seo-pipeline-db` | Shared SQLite database schema (8 tables) and repository layer |
| `impact-tracker` | SEO fix impact tracking, before/after GSC metrics comparison, ROI reports |

## Architecture

```
Detect (site-crawler, gsc-keyword-tracker)
  → Analyze (competitor-gap-analyzer, backlink-analyzer, internal-link-graph)
    → Fix (auto-fix-pipeline)
      → Track (impact-tracker)
```

## Stack

- TypeScript / Node.js
- Playwright (crawling)
- SQLite via sql.js (data persistence)
- Google Search Console API
- Slack API (alerts)
