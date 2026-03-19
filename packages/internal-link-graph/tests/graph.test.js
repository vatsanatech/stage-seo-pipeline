import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LinkGraph } from '../dist/analysis/graph.js';

describe('LinkGraph', () => {
  function buildTestGraph() {
    const graph = new LinkGraph();
    // Simple triangle: A -> B -> C -> A, plus A -> C
    graph.buildFromEdges([
      { sourceUrl: 'https://example.com/', targetUrl: 'https://example.com/about', anchorText: 'About Us', crawledAt: '2026-03-18' },
      { sourceUrl: 'https://example.com/about', targetUrl: 'https://example.com/contact', anchorText: 'Contact', crawledAt: '2026-03-18' },
      { sourceUrl: 'https://example.com/contact', targetUrl: 'https://example.com/', anchorText: 'Home', crawledAt: '2026-03-18' },
      { sourceUrl: 'https://example.com/', targetUrl: 'https://example.com/contact', anchorText: 'Contact Us', crawledAt: '2026-03-18' },
      { sourceUrl: 'https://example.com/', targetUrl: 'https://example.com/blog', anchorText: 'Blog', crawledAt: '2026-03-18' },
    ]);
    return graph;
  }

  it('should build graph with correct node count', () => {
    const graph = buildTestGraph();
    assert.equal(graph.getNodes().length, 4);
  });

  it('should track inbound and outbound links correctly', () => {
    const graph = buildTestGraph();
    // Home page has 3 outbound links
    assert.equal(graph.getOutboundCount('https://example.com/'), 3);
    // Contact has 2 inbound links (from home and about)
    assert.equal(graph.getInboundCount('https://example.com/contact'), 2);
    // Blog has 1 inbound, 0 outbound
    assert.equal(graph.getInboundCount('https://example.com/blog'), 1);
    assert.equal(graph.getOutboundCount('https://example.com/blog'), 0);
  });

  it('should compute PageRank with values summing to ~1', () => {
    const graph = buildTestGraph();
    const pagerank = graph.computePageRank();

    let total = 0;
    for (const score of pagerank.values()) {
      total += score;
      assert.ok(score > 0, 'All PageRank values should be positive');
    }
    assert.ok(Math.abs(total - 1) < 0.01, `PageRank sum should be ~1, got ${total}`);
  });

  it('should give higher PageRank to well-linked pages', () => {
    const graph = buildTestGraph();
    const pagerank = graph.computePageRank();

    // Contact page has 2 inbound links, should rank higher than blog (1 inbound)
    assert.ok(
      pagerank.get('https://example.com/contact') > pagerank.get('https://example.com/blog'),
      'Contact should have higher PageRank than Blog'
    );
  });

  it('should compute HITS scores', () => {
    const graph = buildTestGraph();
    const { authority, hub } = graph.computeHITS();

    assert.equal(authority.size, 4);
    assert.equal(hub.size, 4);

    // Home page is the biggest hub (3 outbound links)
    const homeHub = hub.get('https://example.com/');
    const aboutHub = hub.get('https://example.com/about');
    assert.ok(homeHub > aboutHub, 'Home should have higher hub score than About');
  });

  it('should find orphan pages', () => {
    const graph = new LinkGraph();
    graph.buildFromEdges([
      { sourceUrl: 'https://example.com/', targetUrl: 'https://example.com/about', anchorText: 'About', crawledAt: '2026-03-18' },
      { sourceUrl: 'https://example.com/', targetUrl: 'https://example.com/contact', anchorText: 'Contact', crawledAt: '2026-03-18' },
    ]);

    // Home has 0 inbound links (orphan)
    const orphans = graph.findOrphanPages(0);
    assert.ok(orphans.includes('https://example.com/'), 'Home is orphaned (no inbound)');
    assert.ok(!orphans.includes('https://example.com/about'), 'About has inbound link');
  });

  it('should find dead-end pages', () => {
    const graph = buildTestGraph();
    const deadEnds = graph.findDeadEnds();
    assert.ok(deadEnds.includes('https://example.com/blog'), 'Blog is a dead end');
    assert.equal(deadEnds.length, 1);
  });

  it('should compute all scores consistently', () => {
    const graph = buildTestGraph();
    const scores = graph.computeAllScores();

    assert.equal(scores.length, 4);
    for (const score of scores) {
      assert.ok(score.pagerank >= 0);
      assert.ok(score.authorityScore >= 0);
      assert.ok(score.hubScore >= 0);
      assert.ok(score.inboundLinks >= 0);
      assert.ok(score.outboundLinks >= 0);
    }
  });
});

describe('LinkGraph - Edge Cases', () => {
  it('should handle empty graph', () => {
    const graph = new LinkGraph();
    const pagerank = graph.computePageRank();
    assert.equal(pagerank.size, 0);

    const { authority, hub } = graph.computeHITS();
    assert.equal(authority.size, 0);
    assert.equal(hub.size, 0);
  });

  it('should handle single-node self-loop', () => {
    const graph = new LinkGraph();
    graph.buildFromEdges([
      { sourceUrl: 'https://example.com/', targetUrl: 'https://example.com/', anchorText: 'Home', crawledAt: '2026-03-18' },
    ]);

    const pagerank = graph.computePageRank();
    assert.equal(pagerank.size, 1);
    assert.ok(Math.abs(pagerank.get('https://example.com/') - 1) < 0.01);
  });
});
