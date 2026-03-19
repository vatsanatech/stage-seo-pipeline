/**
 * Basic test suite for SEO Impact Tracker.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Use a temp data dir for tests
const testDataDir = path.join(__dirname, 'tmp-test-data');
process.env.DATA_DIR = testDataDir;

// Clean up before tests
if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true });
}

const db = require('../src/db');
const compare = require('../src/compare');
const slack = require('../src/slack');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

console.log('\n=== DB Tests ===\n');

test('registerFix creates a fix with correct fields', () => {
  const fix = db.registerFix({
    pageUrl: 'https://example.com/page1',
    fixDescription: 'Added schema markup',
    fixDate: '2026-03-01T00:00:00Z',
    deployAgent: 'autofix-deploy',
  });
  assert.ok(fix.id);
  assert.strictEqual(fix.pageUrl, 'https://example.com/page1');
  assert.strictEqual(fix.status, 'pending');
  assert.strictEqual(fix.deployAgent, 'autofix-deploy');
});

test('getAllFixes returns registered fixes', () => {
  const fixes = db.getAllFixes();
  assert.strictEqual(fixes.length, 1);
  assert.strictEqual(fixes[0].pageUrl, 'https://example.com/page1');
});

test('getPendingFixes returns only pending fixes', () => {
  const pending = db.getPendingFixes();
  assert.strictEqual(pending.length, 1);
});

test('updateFixStatus changes status', () => {
  const fixes = db.getAllFixes();
  db.updateFixStatus(fixes[0].id, 'tracked');
  const updated = db.getAllFixes();
  assert.strictEqual(updated[0].status, 'tracked');
  // Reset for other tests
  db.updateFixStatus(fixes[0].id, 'pending');
});

test('getFixesReadyForTracking returns fixes past the waiting period', () => {
  // Fix date is 2026-03-01, which is >7 days ago from 2026-03-18
  const ready = db.getFixesReadyForTracking();
  assert.strictEqual(ready.length, 1);
});

test('recordImpact stores impact entry', () => {
  db.recordImpact({
    fixId: 'test-id',
    pageUrl: 'https://example.com/page1',
    roiScore: 25.5,
  });
  const impacts = db.getAllImpact();
  assert.strictEqual(impacts.length, 1);
  assert.strictEqual(impacts[0].roiScore, 25.5);
});

console.log('\n=== Compare Tests ===\n');

test('getDateRanges computes correct baseline and post-fix windows', () => {
  const ranges = compare.getDateRanges('2026-03-10T00:00:00Z');
  assert.strictEqual(ranges.baseline.start, '2026-03-03');
  assert.strictEqual(ranges.baseline.end, '2026-03-09');
  assert.strictEqual(ranges.postFix.start, '2026-03-17');
  assert.strictEqual(ranges.postFix.end, '2026-03-23');
});

test('computeDeltas calculates correct percentage changes', () => {
  const baseline = { clicks: 100, impressions: 1000, ctr: 0.10, position: 5.0 };
  const postFix = { clicks: 120, impressions: 1100, ctr: 0.12, position: 4.0 };
  const delta = compare.computeDeltas(baseline, postFix);

  assert.strictEqual(delta.clicksDelta, 20);
  assert.strictEqual(delta.impressionsDelta, 100);
  assert.ok(Math.abs(delta.ctrDeltaPercent - 20.0) < 0.1);
  assert.ok(Math.abs(delta.positionDeltaPercent - (-20.0)) < 0.1);
});

test('computeDeltas handles zero baseline', () => {
  const baseline = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const postFix = { clicks: 10, impressions: 100, ctr: 0.10, position: 3.0 };
  const delta = compare.computeDeltas(baseline, postFix);

  assert.strictEqual(delta.clicksDelta, 10);
  assert.strictEqual(delta.ctrDeltaPercent, 100);
});

test('computeRoiScore returns positive for improvements', () => {
  const delta = { clicksDelta: 20, impressionsDelta: 100, ctrDeltaPercent: 20, positionDeltaPercent: -20 };
  const score = compare.computeRoiScore(delta);
  assert.ok(score > 0, `Expected positive ROI score, got ${score}`);
});

test('computeRoiScore returns negative for regressions', () => {
  const delta = { clicksDelta: -20, impressionsDelta: -100, ctrDeltaPercent: -20, positionDeltaPercent: 20 };
  const score = compare.computeRoiScore(delta);
  assert.ok(score < 0, `Expected negative ROI score, got ${score}`);
});

test('classifyImpact detects CTR improvement', () => {
  const delta = { ctrDeltaPercent: 15, positionDeltaPercent: -5 };
  const alerts = compare.classifyImpact(delta);
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].type, 'improvement');
  assert.strictEqual(alerts[0].metric, 'CTR');
});

test('classifyImpact detects position regression', () => {
  const delta = { ctrDeltaPercent: 2, positionDeltaPercent: 8 };
  const alerts = compare.classifyImpact(delta);
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].type, 'regression');
  assert.strictEqual(alerts[0].metric, 'position');
});

console.log('\n=== Slack Tests ===\n');

test('formatImpactBlock produces readable output', () => {
  const impact = {
    pageUrl: 'https://example.com/page1',
    fixDescription: 'Added schema',
    fixDate: '2026-03-01T00:00:00Z',
    roiScore: 30,
    gscAvailable: true,
    baseline: { clicks: 100, impressions: 1000, ctr: 0.10, position: 5.0 },
    postFix: { clicks: 120, impressions: 1100, ctr: 0.12, position: 4.0 },
    delta: { clicksDelta: 20, impressionsDelta: 100, ctrDeltaPercent: 20, positionDeltaPercent: -20 },
    alerts: [],
  };
  const block = slack.formatImpactBlock(impact);
  assert.ok(block.includes('example.com/page1'));
  assert.ok(block.includes('ROI Score'));
  assert.ok(block.includes('CTR'));
});

// Cleanup
if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true });
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
