import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, closeDatabase } from '../db/schema.js';
import { upsertBacklink, getBacklinks, buildBacklinkProfile, getBacklinkCount, upsertOpportunity, getOpportunities, getOpportunityCount } from '../db/repository.js';
import { findCompetitorLinkOpportunities, analyzeBacklinkGap } from '../analyzers/opportunity-finder.js';
import { extractDomain } from '../analyzers/commoncrawl-client.js';
import type { Backlink } from '../models/types.js';

function makeBacklink(overrides: Partial<Backlink>): Omit<Backlink, 'id' | 'discoveredAt'> {
  return {
    targetDomain: 'stage.in',
    targetUrl: 'https://stage.in/',
    sourceDomain: 'example.com',
    sourceUrl: 'https://example.com/article',
    anchorText: 'Stage OTT',
    crawlDate: '20260318',
    linkType: 'dofollow',
    status: 'active',
    ...overrides,
  };
}

describe('Backlink Repository', () => {
  it('should persist and retrieve backlinks', async () => {
    const db = await getDatabase(':memory:');

    upsertBacklink(db, makeBacklink({ sourceDomain: 'news.com', sourceUrl: 'https://news.com/ott-review' }));
    upsertBacklink(db, makeBacklink({ sourceDomain: 'blog.com', sourceUrl: 'https://blog.com/streaming' }));

    const backlinks = getBacklinks(db, 'stage.in');
    assert.equal(backlinks.length, 2);

    const count = getBacklinkCount(db, 'stage.in');
    assert.equal(count, 2);

    closeDatabase();
  });

  it('should build backlink profile', async () => {
    const db = await getDatabase(':memory:');

    upsertBacklink(db, makeBacklink({ sourceDomain: 'news.com', sourceUrl: 'https://news.com/a', linkType: 'dofollow' }));
    upsertBacklink(db, makeBacklink({ sourceDomain: 'news.com', sourceUrl: 'https://news.com/b', linkType: 'dofollow' }));
    upsertBacklink(db, makeBacklink({ sourceDomain: 'blog.com', sourceUrl: 'https://blog.com/c', linkType: 'nofollow' }));

    const profile = buildBacklinkProfile(db, 'stage.in');
    assert.equal(profile.totalBacklinks, 3);
    assert.equal(profile.uniqueSourceDomains, 2);
    assert.equal(profile.dofollowCount, 2);
    assert.equal(profile.nofollowCount, 1);
    assert.equal(profile.topSourceDomains[0].domain, 'news.com');
    assert.equal(profile.topSourceDomains[0].count, 2);

    closeDatabase();
  });

  it('should upsert backlinks on conflict', async () => {
    const db = await getDatabase(':memory:');

    upsertBacklink(db, makeBacklink({ anchorText: 'old text' }));
    upsertBacklink(db, makeBacklink({ anchorText: 'new text' }));

    const count = getBacklinkCount(db, 'stage.in');
    assert.equal(count, 1); // Upserted, not duplicated

    const backlinks = getBacklinks(db, 'stage.in');
    assert.equal(backlinks[0].anchorText, 'new text');

    closeDatabase();
  });
});

describe('Opportunity Finder', () => {
  it('should find competitor link opportunities', async () => {
    const db = await getDatabase(':memory:');

    const competitorBacklinks: Backlink[] = [
      { ...makeBacklink({ targetDomain: 'mxplayer.in', targetUrl: 'https://mxplayer.in/', sourceDomain: 'techblog.com', sourceUrl: 'https://techblog.com/ott' }), id: 1, discoveredAt: '' },
      { ...makeBacklink({ targetDomain: 'mxplayer.in', targetUrl: 'https://mxplayer.in/', sourceDomain: 'ndtv.com', sourceUrl: 'https://ndtv.com/review' }), id: 2, discoveredAt: '' },
      { ...makeBacklink({ targetDomain: 'mxplayer.in', targetUrl: 'https://mxplayer.in/', sourceDomain: 'youtube.com', sourceUrl: 'https://youtube.com/vid' }), id: 3, discoveredAt: '' },
    ];

    // Stage already has a link from techblog.com
    const stageSourceDomains = new Set(['techblog.com']);

    const found = findCompetitorLinkOpportunities(db, competitorBacklinks, stageSourceDomains);

    // techblog.com skipped (Stage already has it), youtube.com skipped (low value)
    // Only ndtv.com should be an opportunity
    assert.equal(found, 1);

    const opps = getOpportunities(db);
    assert.equal(opps.length, 1);
    assert.equal(opps[0].sourceDomain, 'ndtv.com');
    assert.equal(opps[0].priority, 'high'); // News site = high priority
    assert.equal(opps[0].opportunityType, 'competitor_link');

    closeDatabase();
  });

  it('should analyze backlink gap', () => {
    const stageProfile = { totalBacklinks: 50, uniqueSourceDomains: 20 };
    const competitorProfiles = [
      { domain: 'mxplayer.in', totalBacklinks: 500, uniqueSourceDomains: 200 },
      { domain: 'zee5.com', totalBacklinks: 300, uniqueSourceDomains: 150 },
      { domain: 'jiocinema.com', totalBacklinks: 800, uniqueSourceDomains: 350 },
    ];

    const gap = analyzeBacklinkGap(stageProfile, competitorProfiles);
    assert.equal(gap.length, 3);
    assert.equal(gap[0].competitor, 'jiocinema.com'); // Largest gap first
    assert.equal(gap[0].backlinkGap, 750);
    assert.equal(gap[0].domainGap, 330);
  });
});

describe('CommonCrawl Client', () => {
  it('should extract domain from URL', () => {
    assert.equal(extractDomain('https://www.ndtv.com/tech/ott-review'), 'ndtv.com');
    assert.equal(extractDomain('https://blog.example.com/article'), 'blog.example.com');
    assert.equal(extractDomain('http://stage.in/shows'), 'stage.in');
  });
});

describe('Link Opportunities', () => {
  it('should persist and query opportunities', async () => {
    const db = await getDatabase(':memory:');

    upsertOpportunity(db, {
      sourceDomain: 'techblog.com',
      sourceUrl: 'https://techblog.com/ott',
      competitorDomain: 'mxplayer.in',
      competitorUrl: 'https://mxplayer.in/',
      anchorText: 'MX Player',
      opportunityType: 'competitor_link',
      priority: 'high',
      status: 'new',
      notes: 'Good opportunity',
    });

    upsertOpportunity(db, {
      sourceDomain: 'news.com',
      sourceUrl: 'https://news.com/article',
      competitorDomain: 'zee5.com',
      competitorUrl: 'https://zee5.com/',
      anchorText: 'Zee5',
      opportunityType: 'competitor_link',
      priority: 'medium',
      status: 'new',
      notes: '',
    });

    const allOpps = getOpportunities(db);
    assert.equal(allOpps.length, 2);

    const highOpps = getOpportunities(db, { priority: 'high' });
    assert.equal(highOpps.length, 1);
    assert.equal(highOpps[0].sourceDomain, 'techblog.com');

    const count = getOpportunityCount(db);
    assert.equal(count, 2);

    closeDatabase();
  });
});
