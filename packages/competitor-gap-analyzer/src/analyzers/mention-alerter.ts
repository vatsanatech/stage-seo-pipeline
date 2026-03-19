import type { Database } from 'sql.js';
import type { BrandMention } from '../models/types.js';
import { getBrandMentions, getBrandMentionCounts } from '../db/repository.js';

/** A link opportunity from an unlinked brand mention */
export interface UnlinkedMention {
  mention: BrandMention;
  opportunityScore: number; // 0-100
  reason: string;
}

/** Brand mention alert for Slack */
export interface MentionAlert {
  totalMentions: number;
  newMentions: BrandMention[];
  unlinkedOpportunities: UnlinkedMention[];
  byType: Record<string, number>;
  summary: string;
}

/**
 * Identify unlinked brand mentions — pages that mention Stage but don't link to it.
 * These are link building opportunities (outreach targets).
 */
export function findUnlinkedMentions(mentions: BrandMention[]): UnlinkedMention[] {
  const opportunities: UnlinkedMention[] = [];

  for (const mention of mentions) {
    // Skip if the mention IS on Stage's own domain
    if (isStageDomain(mention.domain)) continue;

    // Skip low-value domains
    if (isLowValueForOutreach(mention.domain)) continue;

    const score = computeOpportunityScore(mention);
    if (score < 20) continue;

    opportunities.push({
      mention,
      opportunityScore: score,
      reason: buildOpportunityReason(mention, score),
    });
  }

  return opportunities.sort((a, b) => b.opportunityScore - a.opportunityScore);
}

/**
 * Build a Slack-formatted alert payload for brand mentions.
 */
export function buildMentionAlertPayload(alert: MentionAlert): SlackMentionPayload {
  const hasOpportunities = alert.unlinkedOpportunities.length > 0;
  const emoji = hasOpportunities ? ':link:' : ':newspaper:';

  const blocks: string[] = [
    `${emoji} *Brand Mention Report* — ${alert.totalMentions} mention(s) found`,
    '',
    alert.summary,
  ];

  if (alert.unlinkedOpportunities.length > 0) {
    blocks.push('', '*Link Building Opportunities:*');
    for (const opp of alert.unlinkedOpportunities.slice(0, 5)) {
      blocks.push(`• [Score: ${opp.opportunityScore}] ${opp.mention.domain} — ${opp.mention.title}`);
      blocks.push(`  ${opp.reason}`);
    }
  }

  if (alert.newMentions.length > 0) {
    blocks.push('', '*Recent Mentions:*');
    for (const m of alert.newMentions.slice(0, 5)) {
      const sentimentEmoji = m.sentiment === 'positive' ? ':white_check_mark:' : m.sentiment === 'negative' ? ':x:' : ':large_blue_circle:';
      blocks.push(`${sentimentEmoji} [${m.mentionType}] ${m.domain}: ${m.title}`);
    }
  }

  const typeBreakdown = Object.entries(alert.byType)
    .map(([type, count]) => `${type}: ${count}`)
    .join(' | ');
  blocks.push('', `_Types: ${typeBreakdown}_`);

  return {
    text: blocks.join('\n'),
    username: 'Stage Brand Monitor',
    icon_emoji: ':mag:',
  };
}

/**
 * Create a full mention alert from database state.
 */
export function createMentionAlert(db: Database, newMentions: BrandMention[]): MentionAlert {
  const allMentions = getBrandMentions(db);
  const byType = getBrandMentionCounts(db);
  const unlinkedOpportunities = findUnlinkedMentions(allMentions);

  const oppCount = unlinkedOpportunities.length;
  const summary = `Found ${allMentions.length} total mention(s), ${newMentions.length} new. ${oppCount} unlinked mention(s) identified as link building opportunities.`;

  return {
    totalMentions: allMentions.length,
    newMentions,
    unlinkedOpportunities,
    byType,
    summary,
  };
}

// --- Helpers ---

export interface SlackMentionPayload {
  text: string;
  username: string;
  icon_emoji: string;
}

function isStageDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return d.includes('stage.in') || d.includes('stageott') || d.includes('stage');
}

function isLowValueForOutreach(domain: string): boolean {
  const skip = [
    'play.google.com', 'apps.apple.com', 'apkpure', 'apkgk', 'appbrain',
    'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
    'web.archive.org', 'archive.org',
  ];
  return skip.some((s) => domain.includes(s));
}

function computeOpportunityScore(mention: BrandMention): number {
  let score = 30; // Base score

  // Mention type boost
  if (mention.mentionType === 'review') score += 25;
  if (mention.mentionType === 'news') score += 20;
  if (mention.mentionType === 'competitor_comparison') score += 30;
  if (mention.mentionType === 'forum') score += 10;

  // Positive sentiment boost
  if (mention.sentiment === 'positive') score += 15;
  if (mention.sentiment === 'negative') score -= 10;

  // High-authority domain patterns
  const highAuth = [/news/i, /times/i, /ndtv/i, /\.edu/i, /techcrunch/i, /ottplay/i, /gadgets360/i];
  if (highAuth.some((p) => p.test(mention.domain))) score += 20;

  return Math.min(Math.max(score, 0), 100);
}

function buildOpportunityReason(mention: BrandMention, score: number): string {
  const parts: string[] = [];

  if (mention.mentionType === 'competitor_comparison') {
    parts.push('Comparison article — request inclusion/correction');
  } else if (mention.mentionType === 'review') {
    parts.push('Review site — request backlink addition');
  } else if (mention.mentionType === 'news') {
    parts.push('News article — request attribution link');
  } else {
    parts.push('Unlinked mention — outreach for backlink');
  }

  if (mention.sentiment === 'positive') {
    parts.push('Positive sentiment increases likelihood of link');
  }

  return parts.join('. ') + '.';
}
