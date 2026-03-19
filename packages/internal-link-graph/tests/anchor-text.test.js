import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeEdges } from '../dist/analysis/anchor-text.js';
import { getDatabase, closeDatabase } from '../dist/db/schema.js';
import { insertEdges } from '../dist/db/repository.js';
import { analyzeAnchorTexts, getAnchorsForUrl, getAnchorDistribution } from '../dist/analysis/anchor-text.js';

describe('Anchor Text Analysis (in-memory)', () => {
  it('should detect empty anchor text', () => {
    const report = analyzeEdges([
      { sourceUrl: 'https://site.com/', targetUrl: 'https://site.com/about', anchorText: '' },
    ]);
    assert.equal(report.emptyAnchorRate, 1);
    assert.ok(report.issues.some(i => i.type === 'empty'));
  });

  it('should detect generic anchor text', () => {
    const report = analyzeEdges([
      { sourceUrl: 'https://site.com/', targetUrl: 'https://site.com/page', anchorText: 'click here' },
      { sourceUrl: 'https://site.com/', targetUrl: 'https://site.com/other', anchorText: 'read more' },
      { sourceUrl: 'https://site.com/', targetUrl: 'https://site.com/blog', anchorText: 'SEO Guide' },
    ]);
    assert.ok(report.genericAnchorRate > 0.5);
    assert.equal(report.issues.filter(i => i.type === 'generic').length, 2);
  });

  it('should flag keyword stuffing', () => {
    const report = analyzeEdges([
      { sourceUrl: 'https://a.com/', targetUrl: 'https://a.com/buy', anchorText: 'buy shoes' },
      { sourceUrl: 'https://b.com/', targetUrl: 'https://a.com/buy', anchorText: 'buy shoes' },
      { sourceUrl: 'https://c.com/', targetUrl: 'https://a.com/buy', anchorText: 'buy shoes' },
      { sourceUrl: 'https://d.com/', targetUrl: 'https://a.com/buy', anchorText: 'buy shoes' },
    ]);
    assert.ok(report.issues.some(i => i.type === 'keyword_stuffing'));
  });

  it('should not flag diverse anchor text as keyword stuffing', () => {
    const report = analyzeEdges([
      { sourceUrl: 'https://a.com/', targetUrl: 'https://a.com/buy', anchorText: 'buy shoes' },
      { sourceUrl: 'https://b.com/', targetUrl: 'https://a.com/buy', anchorText: 'shoe store' },
      { sourceUrl: 'https://c.com/', targetUrl: 'https://a.com/buy', anchorText: 'footwear shop' },
      { sourceUrl: 'https://d.com/', targetUrl: 'https://a.com/buy', anchorText: 'shoes online' },
    ]);
    assert.ok(!report.issues.some(i => i.type === 'keyword_stuffing'));
  });

  it('should flag too-long anchor text', () => {
    const longText = 'A'.repeat(150);
    const report = analyzeEdges([
      { sourceUrl: 'https://site.com/', targetUrl: 'https://site.com/page', anchorText: longText },
    ]);
    assert.ok(report.issues.some(i => i.type === 'too_long'));
  });

  it('should build anchor profiles per target URL', () => {
    const report = analyzeEdges([
      { sourceUrl: 'https://site.com/', targetUrl: 'https://site.com/about', anchorText: 'About Us' },
      { sourceUrl: 'https://site.com/blog', targetUrl: 'https://site.com/about', anchorText: 'About' },
      { sourceUrl: 'https://site.com/', targetUrl: 'https://site.com/contact', anchorText: 'Contact' },
    ]);
    assert.equal(report.profiles.length, 2);

    const aboutProfile = report.profiles.find(p => p.targetUrl === 'https://site.com/about');
    assert.ok(aboutProfile);
    assert.equal(aboutProfile.totalLinks, 2);
    assert.equal(aboutProfile.uniqueAnchors, 2);
  });

  it('should count unique anchor texts correctly', () => {
    const report = analyzeEdges([
      { sourceUrl: 'https://a.com/', targetUrl: 'https://b.com/', anchorText: 'Home' },
      { sourceUrl: 'https://c.com/', targetUrl: 'https://b.com/', anchorText: 'home' },
      { sourceUrl: 'https://d.com/', targetUrl: 'https://b.com/', anchorText: 'Homepage' },
    ]);
    // "home" and "Home" normalize to same, "Homepage" is different
    assert.equal(report.uniqueAnchorTexts, 2);
  });

  it('should handle empty edge list', () => {
    const report = analyzeEdges([]);
    assert.equal(report.totalLinks, 0);
    assert.equal(report.genericAnchorRate, 0);
    assert.equal(report.emptyAnchorRate, 0);
    assert.equal(report.profiles.length, 0);
    assert.equal(report.issues.length, 0);
  });
});

describe('Anchor Text Analysis (database)', () => {
  let db;

  before(async () => {
    db = await getDatabase(':memory:');
    insertEdges(db, [
      { sourceUrl: 'https://site.com/', targetUrl: 'https://site.com/products', anchorText: 'Products', crawledAt: '2026-03-18' },
      { sourceUrl: 'https://site.com/', targetUrl: 'https://site.com/about', anchorText: 'About Us', crawledAt: '2026-03-18' },
      { sourceUrl: 'https://site.com/blog', targetUrl: 'https://site.com/products', anchorText: 'Our Products', crawledAt: '2026-03-18' },
      { sourceUrl: 'https://site.com/blog', targetUrl: 'https://site.com/about', anchorText: 'click here', crawledAt: '2026-03-18' },
    ]);
  });

  after(() => {
    closeDatabase();
  });

  it('should analyze anchor texts from database', () => {
    const report = analyzeAnchorTexts(db);
    assert.equal(report.totalLinks, 4);
    assert.ok(report.profiles.length > 0);
  });

  it('should get anchors for a specific URL', () => {
    const anchors = getAnchorsForUrl(db, 'https://site.com/products');
    assert.equal(anchors.length, 2);
    assert.ok(anchors.some(a => a.anchorText === 'Products'));
    assert.ok(anchors.some(a => a.anchorText === 'Our Products'));
  });

  it('should get anchor distribution for a URL', () => {
    const dist = getAnchorDistribution(db, 'https://site.com/products');
    assert.equal(dist.get('products'), 1);
    assert.equal(dist.get('our products'), 1);
  });

  it('should detect generic anchor in database data', () => {
    const report = analyzeAnchorTexts(db);
    assert.ok(report.issues.some(i => i.type === 'generic' && i.anchorText === 'click here'));
  });
});
