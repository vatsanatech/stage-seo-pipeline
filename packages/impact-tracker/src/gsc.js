/**
 * Google Search Console data fetching module.
 *
 * Uses the GSC Search Analytics API to pull CTR, impressions, clicks,
 * and average position for specific pages within date ranges.
 *
 * When GSC_CREDENTIALS_PATH is not configured or credentials are missing,
 * returns null so the caller can handle gracefully.
 */

const fs = require('fs');
const https = require('https');
const config = require('./config');

/**
 * Load service account credentials and obtain an access token via JWT.
 * Returns the access token string, or null if credentials are unavailable.
 */
async function getAccessToken() {
  const { credentialsPath } = config.gsc;

  if (!credentialsPath || !fs.existsSync(credentialsPath)) {
    return null;
  }

  const creds = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);

  // Build JWT header + claim set
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claimSet = Buffer.from(JSON.stringify({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');

  const crypto = require('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${claimSet}`);
  const signature = sign.sign(creds.private_key, 'base64url');

  const jwt = `${header}.${claimSet}.${signature}`;

  // Exchange JWT for access token
  return new Promise((resolve, reject) => {
    const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.access_token || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.write(postData);
    req.end();
  });
}

/**
 * Query GSC Search Analytics for a specific page URL within a date range.
 *
 * @param {string} pageUrl - The full page URL to query
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Promise<{clicks: number, impressions: number, ctr: number, position: number} | null>}
 */
async function fetchPageMetrics(pageUrl, startDate, endDate) {
  const accessToken = await getAccessToken();
  if (!accessToken || !config.gsc.siteUrl) {
    return null;
  }

  const siteUrl = encodeURIComponent(config.gsc.siteUrl);
  const requestBody = JSON.stringify({
    startDate,
    endDate,
    dimensions: ['page'],
    dimensionFilterGroups: [{
      filters: [{
        dimension: 'page',
        operator: 'equals',
        expression: pageUrl,
      }],
    }],
    rowLimit: 1,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      `https://www.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.rows && data.rows.length > 0) {
              const row = data.rows[0];
              resolve({
                clicks: row.clicks || 0,
                impressions: row.impressions || 0,
                ctr: row.ctr || 0,
                position: row.position || 0,
              });
            } else {
              resolve({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
            }
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.write(requestBody);
    req.end();
  });
}

module.exports = { getAccessToken, fetchPageMetrics };
