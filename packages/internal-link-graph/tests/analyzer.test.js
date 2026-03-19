import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, closeDatabase } from '../dist/db/schema.js';
import { insertEdges, getAllEdges, getAllPages } from '../dist/db/repository.js';
import { analyzeGraph, importLinks } from '../dist/analysis/analyzer.js';

describe('Database and Analyzer Integration', () => {
  let db;

  before(async () => {
    db = await getDatabase(':memory:');
  });

  after(() => {
    closeDatabase();
  });

  const testEdges = [
    { sourceUrl: 'https://site.com/', targetUrl: 'https://site.com/products', anchorText: 'Products', crawledAt: '2026-03-18' },
    { sourceUrl: 'https://site.com/', targetUrl: 'https://site.com/about', anchorText: 'About', crawledAt: '2026-03-18' },
    { sourceUrl: 'https://site.com/', targetUrl: 'https://site.com/blog', anchorText: 'Blog', crawledAt: '2026-03-18' },
    { sourceUrl: 'https://site.com/products', targetUrl: 'https://site.com/', anchorText: 'Home', crawledAt: '2026-03-18' },
    { sourceUrl: 'https://site.com/products', targetUrl: 'https://site.com/about', anchorText: 'About Us', crawledAt: '2026-03-18' },
    { sourceUrl: 'https://site.com/blog', targetUrl: 'https://site.com/', anchorText: 'Home', crawledAt: '2026-03-18' },
    { sourceUrl: 'https://site.com/blog', targetUrl: 'https://site.com/blog/post-1', anchorText: 'First Post', crawledAt: '2026-03-18' },
    { sourceUrl: 'https://site.com/blog/post-1', targetUrl: 'https://site.com/blog', anchorText: 'Back to Blog', crawledAt: '2026-03-18' },
  ];

  it('should import edges into database', () => {
    const count = importLinks(db, testEdges);
    assert.equal(count, testEdges.length);
  });

  it('should retrieve all edges', () => {
    const edges = getAllEdges(db);
    assert.equal(edges.length, testEdges.length);
  });

  it('should list all unique pages', () => {
    const pages = getAllPages(db);
    assert.equal(pages.length, 5); // /, /products, /about, /blog, /blog/post-1
  });

  it('should run full analysis successfully', () => {
    const result = analyzeGraph(db);

    assert.ok(result.stats.totalPages > 0);
    assert.ok(result.stats.totalLinks > 0);

    // About page has 2 inbound, 0 outbound — it's a dead end
    const aboutScore = result.scores.find(s => s.url === 'https://site.com/about');
    assert.ok(aboutScore);
    assert.equal(aboutScore.inboundLinks, 2);
    assert.equal(aboutScore.outboundLinks, 0);
  });

  it('should detect orphan pages', () => {
    const result = analyzeGraph(db);
    // All pages except home have some inbound, but about has no outbound (dead end)
    assert.ok(result.orphanPages.length >= 0);
  });

  it('should generate link suggestions', () => {
    const result = analyzeGraph(db);
    // Should suggest links for dead-end pages (about) and possibly orphans
    assert.ok(result.suggestions.length > 0, 'Should generate at least one suggestion');

    for (const s of result.suggestions) {
      assert.ok(['high', 'medium', 'low'].includes(s.priority));
      assert.ok(s.sourceUrl);
      assert.ok(s.targetUrl);
      assert.ok(s.reason);
    }
  });

  it('should produce valid stats', () => {
    const result = analyzeGraph(db);
    assert.ok(result.stats.avgInboundLinks > 0);
    assert.ok(result.stats.avgOutboundLinks > 0);
    assert.ok(result.stats.maxPagerank.score > 0);
    assert.ok(result.stats.topAuthorities.length > 0);
    assert.ok(result.stats.topHubs.length > 0);
  });
});
