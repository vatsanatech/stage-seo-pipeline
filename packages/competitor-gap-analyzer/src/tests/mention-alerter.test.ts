import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, closeDatabase } from '../db/schema.js';
import { findUnlinkedMentions, createMentionAlert, buildMentionAlertPayload } from '../analyzers/mention-alerter.js';
import { detectBrandMentions } from '../analyzers/brand-monitor.js';
import type { BrandMention, SerpResult } from '../models/types.js';

function makeMention(overrides: Partial<BrandMention>): BrandMention {
  return {
    id: 1,
    query: 'stage app',
    domain: 'techblog.com',
    url: 'https://techblog.com/article',
    title: 'Stage OTT Review',
    snippet: 'Stage is a great app for regional content.',
    mentionType: 'review',
    sentiment: 'positive',
    detectedAt: '2026-03-18T00:00:00Z',
    ...overrides,
  };
}

describe('Unlinked Mention Finder', () => {
  it('should find unlinked mentions as link opportunities', () => {
    const mentions = [
      makeMention({ domain: 'ottplay.com', mentionType: 'review', sentiment: 'positive' }),
      makeMention({ domain: 'ndtv.com', mentionType: 'news', sentiment: 'neutral' }),
    ];

    const opportunities = findUnlinkedMentions(mentions);
    assert.equal(opportunities.length, 2);
    assert.ok(opportunities[0].opportunityScore > 0);
    assert.ok(opportunities[0].reason.length > 0);
  });

  it('should skip Stage own domain mentions', () => {
    const mentions = [
      makeMention({ domain: 'stage.in' }),
      makeMention({ domain: 'ottplay.com' }),
    ];

    const opportunities = findUnlinkedMentions(mentions);
    assert.equal(opportunities.length, 1);
    assert.equal(opportunities[0].mention.domain, 'ottplay.com');
  });

  it('should skip low-value app store domains', () => {
    const mentions = [
      makeMention({ domain: 'play.google.com' }),
      makeMention({ domain: 'apps.apple.com' }),
      makeMention({ domain: 'apkpure.com' }),
      makeMention({ domain: 'techblog.com' }),
    ];

    const opportunities = findUnlinkedMentions(mentions);
    assert.equal(opportunities.length, 1);
    assert.equal(opportunities[0].mention.domain, 'techblog.com');
  });

  it('should score competitor comparison mentions highest', () => {
    const mentions = [
      makeMention({ domain: 'blog1.com', mentionType: 'competitor_comparison', sentiment: 'positive' }),
      makeMention({ domain: 'blog2.com', mentionType: 'forum', sentiment: 'neutral', url: 'https://blog2.com/x' }),
    ];

    const opportunities = findUnlinkedMentions(mentions);
    assert.equal(opportunities[0].mention.mentionType, 'competitor_comparison');
    assert.ok(opportunities[0].opportunityScore > opportunities[1].opportunityScore);
  });

  it('should boost high-authority domains', () => {
    const mentions = [
      makeMention({ domain: 'ndtv.com', mentionType: 'news' }),
      makeMention({ domain: 'smallblog.com', mentionType: 'news', url: 'https://smallblog.com/x' }),
    ];

    const opportunities = findUnlinkedMentions(mentions);
    const ndtvOpp = opportunities.find((o) => o.mention.domain === 'ndtv.com');
    const blogOpp = opportunities.find((o) => o.mention.domain === 'smallblog.com');
    assert.ok(ndtvOpp!.opportunityScore > blogOpp!.opportunityScore);
  });
});

describe('Mention Alert Builder', () => {
  it('should create mention alert from database', async () => {
    const db = await getDatabase(':memory:');

    // Seed some brand mentions
    const results: SerpResult[] = [
      {
        query: 'stage app review',
        position: 1,
        url: 'https://ottplay.com/review',
        title: 'Stage App Review',
        snippet: 'Stage is the best regional OTT app.',
        domain: 'ottplay.com',
        fetchedAt: '2026-03-18T00:00:00Z',
      },
      {
        query: 'stage vs mx player',
        position: 2,
        url: 'https://techradar.com/compare',
        title: 'Stage vs MX Player comparison',
        snippet: 'We compare Stage vs MX Player for regional content.',
        domain: 'techradar.com',
        fetchedAt: '2026-03-18T00:00:00Z',
      },
    ];

    detectBrandMentions(db, 'stage app review', [results[0]]);
    detectBrandMentions(db, 'stage vs mx player', [results[1]]);

    const newMentions = [
      makeMention({ domain: 'ottplay.com' }),
      makeMention({ domain: 'techradar.com', mentionType: 'competitor_comparison' }),
    ];

    const alert = createMentionAlert(db, newMentions);
    assert.equal(alert.totalMentions, 2);
    assert.equal(alert.newMentions.length, 2);
    assert.ok(alert.unlinkedOpportunities.length > 0);
    assert.ok(alert.summary.includes('mention'));

    closeDatabase();
  });

  it('should build Slack payload from alert', () => {
    const alert: import('../analyzers/mention-alerter.js').MentionAlert = {
      totalMentions: 5,
      newMentions: [makeMention({ domain: 'news.com', mentionType: 'news' })],
      unlinkedOpportunities: [{
        mention: makeMention({ domain: 'ottplay.com' }),
        opportunityScore: 85,
        reason: 'Review site — request backlink addition.',
      }],
      byType: { review: 3, news: 2 },
      summary: 'Found 5 mentions, 1 new. 1 unlinked opportunity.',
    };

    const payload = buildMentionAlertPayload(alert);
    assert.ok(payload.text.includes('Brand Mention Report'));
    assert.ok(payload.text.includes('Link Building Opportunities'));
    assert.ok(payload.text.includes('Score: 85'));
    assert.equal(payload.username, 'Stage Brand Monitor');
  });
});
