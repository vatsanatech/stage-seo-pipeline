import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateLlmsTxt } from '../deployers/geo-deployer.js';
import { generateLinkManifest } from '../deployers/link-deployer.js';

describe('GEO deployer', () => {
  it('should generate valid llms.txt content', () => {
    const content = generateLlmsTxt('Stage OTT', 'https://stage.in', [
      { url: '/movies', title: 'Movies', description: 'Browse all movies' },
      { url: '/shows', title: 'TV Shows', description: 'Browse all shows' },
    ]);

    assert.ok(content.includes('# Stage OTT'));
    assert.ok(content.includes('[Movies](https://stage.in/movies)'));
    assert.ok(content.includes('[TV Shows](https://stage.in/shows)'));
  });
});

describe('Link deployer', () => {
  it('should generate valid link suggestion manifest', () => {
    const manifest = generateLinkManifest([
      {
        id: 1,
        source_url: '/blog/post-1',
        target_url: '/movies/abc',
        suggested_anchor_text: 'Watch ABC',
        reason: 'Related content',
        priority: 'high',
      },
    ]);

    const parsed = JSON.parse(manifest);
    assert.equal(parsed.totalSuggestions, 1);
    assert.equal(parsed.suggestions[0].sourceUrl, '/blog/post-1');
    assert.equal(parsed.suggestions[0].priority, 'high');
  });
});
