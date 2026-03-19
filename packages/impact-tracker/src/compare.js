/**
 * Impact comparison engine.
 *
 * Compares 7-day pre-fix baseline vs 7-day post-fix metrics
 * and computes delta percentages and ROI score.
 */

const config = require('./config');
const gsc = require('./gsc');
const db = require('./db');

/**
 * Format a Date as YYYY-MM-DD.
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Compute date ranges for a fix.
 *
 * Pre-fix baseline: [fixDate - preFixBaselineDays, fixDate - 1]
 * Post-fix window:  [fixDate + postFixDays, fixDate + postFixDays + postFixDays - 1]
 *   (we start measuring after the settling period)
 *
 * Simplified: baseline = 7 days before fix, post = days 7-14 after fix
 */
function getDateRanges(fixDate) {
  const fix = new Date(fixDate);
  const preDays = config.tracking.preFixBaselineDays;
  const postDays = config.tracking.postFixDays;

  const baselineStart = new Date(fix);
  baselineStart.setDate(baselineStart.getDate() - preDays);

  const baselineEnd = new Date(fix);
  baselineEnd.setDate(baselineEnd.getDate() - 1);

  const postStart = new Date(fix);
  postStart.setDate(postStart.getDate() + postDays);

  const postEnd = new Date(fix);
  postEnd.setDate(postEnd.getDate() + (postDays * 2) - 1);

  return {
    baseline: { start: formatDate(baselineStart), end: formatDate(baselineEnd) },
    postFix: { start: formatDate(postStart), end: formatDate(postEnd) },
  };
}

/**
 * Compute deltas between baseline and post-fix metrics.
 */
function computeDeltas(baseline, postFix) {
  const safeDivide = (a, b) => b === 0 ? (a === 0 ? 0 : 100) : ((a - b) / b) * 100;

  return {
    clicksDelta: postFix.clicks - baseline.clicks,
    impressionsDelta: postFix.impressions - baseline.impressions,
    ctrDeltaPercent: safeDivide(postFix.ctr, baseline.ctr),
    positionDeltaPercent: safeDivide(postFix.position, baseline.position),
  };
}

/**
 * Compute a simple ROI score from -100 to +100.
 * Positive = improvement, negative = regression.
 *
 * Weighted: CTR change (40%), clicks change (30%), position change (30%).
 * Position improvement is negative delta (lower position = better).
 */
function computeRoiScore(delta) {
  const ctrComponent = Math.max(-100, Math.min(100, delta.ctrDeltaPercent)) * 0.4;
  const clicksComponent = Math.max(-100, Math.min(100,
    delta.clicksDelta === 0 ? 0 : (delta.clicksDelta > 0 ? Math.min(delta.clicksDelta * 5, 100) : Math.max(delta.clicksDelta * 5, -100))
  )) * 0.3;
  // Position: lower is better, so negative delta = improvement
  const posComponent = Math.max(-100, Math.min(100, -delta.positionDeltaPercent)) * 0.3;

  return Math.round((ctrComponent + clicksComponent + posComponent) * 100) / 100;
}

/**
 * Classify the impact result for alerting.
 */
function classifyImpact(delta) {
  const alerts = [];

  if (delta.ctrDeltaPercent >= config.thresholds.ctrLiftPercent) {
    alerts.push({ type: 'improvement', metric: 'CTR', change: `+${delta.ctrDeltaPercent.toFixed(1)}%` });
  }
  // Position: positive delta means position number increased (worse ranking)
  if (delta.positionDeltaPercent > config.thresholds.positionDropPercent) {
    alerts.push({ type: 'regression', metric: 'position', change: `+${delta.positionDeltaPercent.toFixed(1)}% (dropped)` });
  }

  return alerts;
}

/**
 * Track impact for a single fix. Fetches GSC data and records results.
 *
 * @param {object} fix - Fix record from the database
 * @returns {Promise<object|null>} Impact entry or null if GSC unavailable
 */
async function trackFix(fix) {
  const ranges = getDateRanges(fix.fixDate);

  const baseline = await gsc.fetchPageMetrics(fix.pageUrl, ranges.baseline.start, ranges.baseline.end);
  const postFix = await gsc.fetchPageMetrics(fix.pageUrl, ranges.postFix.start, ranges.postFix.end);

  if (!baseline || !postFix) {
    // GSC not configured - create a simulated entry for demo/dry-run
    console.log(`  [GSC unavailable] Using placeholder metrics for ${fix.pageUrl}`);
    const placeholderBaseline = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const placeholderPost = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const delta = computeDeltas(placeholderBaseline, placeholderPost);
    const roiScore = computeRoiScore(delta);
    const alerts = classifyImpact(delta);

    const entry = {
      fixId: fix.id,
      pageUrl: fix.pageUrl,
      fixDate: fix.fixDate,
      fixDescription: fix.fixDescription,
      trackedAt: new Date().toISOString(),
      baseline: placeholderBaseline,
      postFix: placeholderPost,
      delta,
      roiScore,
      alerts,
      gscAvailable: false,
    };

    db.recordImpact(entry);
    db.updateFixStatus(fix.id, 'tracked');
    return entry;
  }

  const delta = computeDeltas(baseline, postFix);
  const roiScore = computeRoiScore(delta);
  const alerts = classifyImpact(delta);

  const entry = {
    fixId: fix.id,
    pageUrl: fix.pageUrl,
    fixDate: fix.fixDate,
    fixDescription: fix.fixDescription,
    trackedAt: new Date().toISOString(),
    baseline,
    postFix,
    delta,
    roiScore,
    alerts,
    gscAvailable: true,
  };

  db.recordImpact(entry);
  db.updateFixStatus(fix.id, 'tracked');
  return entry;
}

/**
 * Track all fixes that are ready (past the post-fix window).
 */
async function trackAllReady() {
  const ready = db.getFixesReadyForTracking();
  if (ready.length === 0) {
    console.log('No fixes ready for tracking yet.');
    return [];
  }

  console.log(`Found ${ready.length} fix(es) ready for impact tracking.`);
  const results = [];

  for (const fix of ready) {
    console.log(`\nTracking: ${fix.pageUrl} (fixed ${fix.fixDate})`);
    try {
      const result = await trackFix(fix);
      if (result) results.push(result);
    } catch (err) {
      console.error(`  Error tracking ${fix.pageUrl}: ${err.message}`);
      db.updateFixStatus(fix.id, 'error');
    }
  }

  return results;
}

module.exports = {
  getDateRanges,
  computeDeltas,
  computeRoiScore,
  classifyImpact,
  trackFix,
  trackAllReady,
};
