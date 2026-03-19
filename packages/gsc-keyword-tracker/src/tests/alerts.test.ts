import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlerts, DEFAULT_THRESHOLDS } from '../alerts/keyword-alerter.js';
import { buildAttachment, SEVERITY_COLORS } from '../alerts/slack-client.js';
import type { KeywordTrend } from '../models/types.js';

function makeTrend(overrides: Partial<KeywordTrend> & { query: string }): KeywordTrend {
  return {
    dialect: null,
    direction: 'declining',
    currentClicks: 50,
    previousClicks: 100,
    clicksDelta: -50,
    clicksDeltaPct: -50,
    currentImpressions: 500,
    previousImpressions: 1000,
    impressionsDelta: -500,
    currentPosition: 8,
    previousPosition: 5,
    positionDelta: -3,
    currentCtr: 0.1,
    previousCtr: 0.1,
    ...overrides,
  };
}

describe('Keyword Alerter', () => {
  it('should generate critical alert for >50% drop', () => {
    const trends = [
      makeTrend({ query: 'haryanvi web series', dialect: 'haryanvi', clicksDeltaPct: -60, previousClicks: 200 }),
    ];

    const alerts = evaluateAlerts(trends);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, 'critical');
    assert.equal(alerts[0].keyword, 'haryanvi web series');
    assert.equal(alerts[0].dialect, 'haryanvi');
  });

  it('should generate high alert for 30-50% drop', () => {
    const trends = [
      makeTrend({ query: 'rajasthani movies', clicksDeltaPct: -35, previousClicks: 100 }),
    ];

    const alerts = evaluateAlerts(trends);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, 'high');
  });

  it('should generate medium alert for 20-30% drop', () => {
    const trends = [
      makeTrend({ query: 'bhojpuri comedy', clicksDeltaPct: -22, previousClicks: 80 }),
    ];

    const alerts = evaluateAlerts(trends);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, 'medium');
  });

  it('should NOT alert for small drops below threshold', () => {
    const trends = [
      makeTrend({ query: 'minor keyword', clicksDeltaPct: -10, positionDelta: 0, previousClicks: 80 }),
    ];

    const alerts = evaluateAlerts(trends);
    assert.equal(alerts.length, 0);
  });

  it('should NOT alert for keywords with too few previous clicks', () => {
    const trends = [
      makeTrend({ query: 'low traffic kw', clicksDeltaPct: -80, previousClicks: 10 }),
    ];

    const alerts = evaluateAlerts(trends);
    assert.equal(alerts.length, 0); // Below minPreviousClicks threshold
  });

  it('should generate critical alert for lost keywords with significant traffic', () => {
    const trends = [
      makeTrend({
        query: 'lost keyword',
        direction: 'lost',
        currentClicks: 0,
        previousClicks: 200,
        clicksDelta: -200,
        clicksDeltaPct: -100,
      }),
    ];

    const alerts = evaluateAlerts(trends);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, 'critical');
    assert.ok(alerts[0].reason.includes('completely lost'));
  });

  it('should alert on position drops even with moderate clicks decline', () => {
    const trends = [
      makeTrend({
        query: 'position drop kw',
        clicksDeltaPct: -15, // Below medium threshold
        positionDelta: -5,   // Significant position drop
        previousClicks: 100,
      }),
    ];

    const alerts = evaluateAlerts(trends);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, 'medium');
  });

  it('should sort alerts by severity then by drop magnitude', () => {
    const trends = [
      makeTrend({ query: 'medium1', clicksDeltaPct: -25, previousClicks: 80 }),
      makeTrend({ query: 'critical1', clicksDeltaPct: -70, previousClicks: 200 }),
      makeTrend({ query: 'high1', clicksDeltaPct: -40, previousClicks: 150, clicksDelta: -60 }),
      makeTrend({ query: 'critical2', clicksDeltaPct: -55, previousClicks: 300, clicksDelta: -165 }),
    ];

    const alerts = evaluateAlerts(trends);
    assert.equal(alerts.length, 4);
    assert.equal(alerts[0].severity, 'critical');
    assert.equal(alerts[1].severity, 'critical');
    assert.equal(alerts[2].severity, 'high');
    assert.equal(alerts[3].severity, 'medium');
  });

  it('should skip rising and stable keywords', () => {
    const trends = [
      makeTrend({ query: 'rising', direction: 'rising', clicksDeltaPct: 50, previousClicks: 100 }),
      makeTrend({ query: 'stable', direction: 'stable', clicksDeltaPct: -5, previousClicks: 100 }),
      makeTrend({ query: 'new', direction: 'new', clicksDeltaPct: 100, previousClicks: 0 }),
    ];

    const alerts = evaluateAlerts(trends);
    assert.equal(alerts.length, 0);
  });

  it('should accept custom thresholds', () => {
    const trends = [
      makeTrend({ query: 'custom kw', clicksDeltaPct: -15, previousClicks: 20 }),
    ];

    // Default thresholds: won't alert (below medium -20% and below minPreviousClicks 50)
    assert.equal(evaluateAlerts(trends).length, 0);

    // Custom thresholds: lower bar
    const customThresholds = { ...DEFAULT_THRESHOLDS, mediumDropPct: -10, minPreviousClicks: 10 };
    const alerts = evaluateAlerts(trends, customThresholds);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, 'medium');
  });
});

describe('Slack Client', () => {
  it('should build attachment with correct severity color', () => {
    const attachment = buildAttachment('critical', 'Test Alert', 'Something dropped');
    assert.equal(attachment.color, SEVERITY_COLORS.critical);
    assert.equal(attachment.color, '#FF0000');
    assert.equal(attachment.title, 'Test Alert');
    assert.ok(attachment.ts);
  });

  it('should build attachment with fields', () => {
    const attachment = buildAttachment('high', 'Alert', 'Drop', [
      { title: 'Clicks', value: '100 → 50', short: true },
      { title: 'Position', value: '3 → 8', short: true },
    ]);
    assert.equal(attachment.fields?.length, 2);
    assert.equal(attachment.fields?.[0].title, 'Clicks');
  });

  it('should have all severity colors defined', () => {
    assert.ok(SEVERITY_COLORS.critical);
    assert.ok(SEVERITY_COLORS.high);
    assert.ok(SEVERITY_COLORS.medium);
    assert.ok(SEVERITY_COLORS.low);
    assert.ok(SEVERITY_COLORS.info);
  });
});
