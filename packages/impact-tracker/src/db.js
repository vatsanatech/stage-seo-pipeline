/**
 * JSON-file-based database for tracking registered fixes and their impact results.
 *
 * Fixes DB schema (fixes.json):
 * [
 *   {
 *     "id": "uuid",
 *     "pageUrl": "https://example.com/page",
 *     "fixDescription": "Added schema markup",
 *     "fixDate": "2026-03-10T00:00:00Z",
 *     "registeredAt": "2026-03-10T12:00:00Z",
 *     "status": "pending" | "tracked" | "error",
 *     "deployAgent": "autofix-deploy-engineer"
 *   }
 * ]
 *
 * Impact DB schema (impact-history.json):
 * [
 *   {
 *     "fixId": "uuid",
 *     "pageUrl": "https://example.com/page",
 *     "fixDate": "2026-03-10T00:00:00Z",
 *     "trackedAt": "2026-03-18T06:00:00Z",
 *     "baseline": { "clicks": N, "impressions": N, "ctr": N, "position": N },
 *     "postFix": { "clicks": N, "impressions": N, "ctr": N, "position": N },
 *     "delta": { "clicksDelta": N, "impressionsDelta": N, "ctrDeltaPercent": N, "positionDeltaPercent": N },
 *     "roiScore": N
 *   }
 * ]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

function ensureDir() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

function readJson(filename) {
  ensureDir();
  const filePath = path.join(config.dataDir, filename);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]', 'utf8');
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filename, data) {
  ensureDir();
  const filePath = path.join(config.dataDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// --- Fixes DB ---

function getAllFixes() {
  return readJson(config.fixesDbFile);
}

function getPendingFixes() {
  return getAllFixes().filter(f => f.status === 'pending');
}

function registerFix({ pageUrl, fixDescription, fixDate, deployAgent }) {
  const fixes = getAllFixes();
  const fix = {
    id: crypto.randomUUID(),
    pageUrl,
    fixDescription: fixDescription || '',
    fixDate: fixDate || new Date().toISOString(),
    registeredAt: new Date().toISOString(),
    status: 'pending',
    deployAgent: deployAgent || 'unknown',
  };
  fixes.push(fix);
  writeJson(config.fixesDbFile, fixes);
  return fix;
}

function updateFixStatus(fixId, status) {
  const fixes = getAllFixes();
  const fix = fixes.find(f => f.id === fixId);
  if (fix) {
    fix.status = status;
    writeJson(config.fixesDbFile, fixes);
  }
  return fix;
}

// --- Impact DB ---

function getAllImpact() {
  return readJson(config.impactDbFile);
}

function recordImpact(entry) {
  const impacts = getAllImpact();
  impacts.push(entry);
  writeJson(config.impactDbFile, impacts);
  return entry;
}

// --- Ready check ---

function getFixesReadyForTracking() {
  const now = new Date();
  const readyDays = config.tracking.readyCheckDays;
  return getPendingFixes().filter(f => {
    const fixDate = new Date(f.fixDate);
    const daysSinceFix = (now - fixDate) / (1000 * 60 * 60 * 24);
    return daysSinceFix >= readyDays;
  });
}

module.exports = {
  getAllFixes,
  getPendingFixes,
  registerFix,
  updateFixStatus,
  getAllImpact,
  recordImpact,
  getFixesReadyForTracking,
};
