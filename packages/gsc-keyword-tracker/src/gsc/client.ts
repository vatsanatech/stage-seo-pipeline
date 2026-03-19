import { request } from 'node:https';
import { readFileSync } from 'node:fs';
import type { GscAuthConfig, GscQueryRequest, GscResponseRow, DimensionFilterGroup, DimensionFilter } from '../models/types.js';

const GSC_API_BASE = 'https://www.googleapis.com/webmasters/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Google Search Console API client.
 * Supports service account (JWT) and OAuth2 refresh token auth.
 */
export class GscClient {
  private config: GscAuthConfig;
  private siteUrl: string;

  constructor(siteUrl: string, config: GscAuthConfig) {
    this.siteUrl = siteUrl;
    this.config = config;
  }

  /**
   * Fetch search analytics data from GSC.
   */
  async querySearchAnalytics(
    startDate: string,
    endDate: string,
    dimensions: string[] = ['query'],
    rowLimit: number = 5000,
    filters?: { country?: string; device?: string }
  ): Promise<GscResponseRow[]> {
    const token = await this.getAccessToken();
    const encodedSite = encodeURIComponent(this.siteUrl);
    const url = `${GSC_API_BASE}/sites/${encodedSite}/searchAnalytics/query`;

    const dimensionFilterGroups: DimensionFilterGroup[] = [];
    if (filters?.country || filters?.device) {
      const filterItems: DimensionFilter[] = [];
      if (filters.country) {
        filterItems.push({ dimension: 'country', operator: 'equals', expression: filters.country });
      }
      if (filters.device) {
        filterItems.push({ dimension: 'device', operator: 'equals', expression: filters.device });
      }
      dimensionFilterGroups.push({ filters: filterItems });
    }

    const body: GscQueryRequest = {
      siteUrl: this.siteUrl,
      startDate,
      endDate,
      dimensions,
      rowLimit,
      ...(dimensionFilterGroups.length > 0 ? { dimensionFilterGroups } : {}),
    };

    const responseText = await this.post(url, body, token);
    const response = JSON.parse(responseText);
    return (response.rows || []) as GscResponseRow[];
  }

  /**
   * Query GSC with India-only filter.
   */
  async queryIndiaOnly(
    startDate: string,
    endDate: string,
    dimensions: string[] = ['query'],
    rowLimit: number = 5000
  ): Promise<GscResponseRow[]> {
    return this.querySearchAnalytics(startDate, endDate, dimensions, rowLimit, { country: 'ind' });
  }

  /**
   * Query GSC with device breakdown.
   * Returns results for each device type: MOBILE, DESKTOP, TABLET.
   */
  async queryByDevice(
    startDate: string,
    endDate: string,
    rowLimit: number = 5000
  ): Promise<{ mobile: GscResponseRow[]; desktop: GscResponseRow[]; tablet: GscResponseRow[] }> {
    const [mobile, desktop, tablet] = await Promise.all([
      this.querySearchAnalytics(startDate, endDate, ['query'], rowLimit, { device: 'MOBILE' }),
      this.querySearchAnalytics(startDate, endDate, ['query'], rowLimit, { device: 'DESKTOP' }),
      this.querySearchAnalytics(startDate, endDate, ['query'], rowLimit, { device: 'TABLET' }),
    ]);
    return { mobile, desktop, tablet };
  }

  /**
   * Query GSC for India with device breakdown.
   */
  async queryIndiaByDevice(
    startDate: string,
    endDate: string,
    rowLimit: number = 5000
  ): Promise<{ mobile: GscResponseRow[]; desktop: GscResponseRow[]; tablet: GscResponseRow[] }> {
    const [mobile, desktop, tablet] = await Promise.all([
      this.querySearchAnalytics(startDate, endDate, ['query'], rowLimit, { country: 'ind', device: 'MOBILE' }),
      this.querySearchAnalytics(startDate, endDate, ['query'], rowLimit, { country: 'ind', device: 'DESKTOP' }),
      this.querySearchAnalytics(startDate, endDate, ['query'], rowLimit, { country: 'ind', device: 'TABLET' }),
    ]);
    return { mobile, desktop, tablet };
  }

  /**
   * Get access token via service account JWT or OAuth2 refresh.
   */
  private async getAccessToken(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
      return cachedToken.token;
    }

    if (this.config.type === 'service_account') {
      return this.getServiceAccountToken();
    } else {
      return this.getOAuthToken();
    }
  }

  private async getServiceAccountToken(): Promise<string> {
    let keyData: Record<string, string>;

    if (this.config.serviceAccountKeyPath) {
      keyData = JSON.parse(readFileSync(this.config.serviceAccountKeyPath, 'utf-8'));
    } else if (this.config.serviceAccountKey) {
      keyData = JSON.parse(this.config.serviceAccountKey);
    } else {
      throw new Error('Service account key or key path required');
    }

    const now = Math.floor(Date.now() / 1000);
    const jwt = await createJwt(
      {
        iss: keyData.client_email,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      },
      keyData.private_key
    );

    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    });

    const responseText = await this.postForm(TOKEN_URL, params.toString());
    const response = JSON.parse(responseText);
    cachedToken = {
      token: response.access_token,
      expiresAt: Date.now() + (response.expires_in || 3600) * 1000,
    };
    return cachedToken.token;
  }

  private async getOAuthToken(): Promise<string> {
    if (!this.config.clientId || !this.config.clientSecret || !this.config.refreshToken) {
      throw new Error('OAuth config requires clientId, clientSecret, and refreshToken');
    }

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.config.refreshToken,
      grant_type: 'refresh_token',
    });

    const responseText = await this.postForm(TOKEN_URL, params.toString());
    const response = JSON.parse(responseText);
    cachedToken = {
      token: response.access_token,
      expiresAt: Date.now() + (response.expires_in || 3600) * 1000,
    };
    return cachedToken.token;
  }

  private post(url: string, body: object, token: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const parsed = new URL(url);

      const req = request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            Authorization: `Bearer ${token}`,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8');
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`GSC API error ${res.statusCode}: ${text}`));
            } else {
              resolve(text);
            }
          });
        }
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  private postForm(url: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

/**
 * Create a minimal JWT for Google service account auth.
 * Uses Node.js built-in crypto for RS256 signing.
 */
async function createJwt(claims: Record<string, unknown>, privateKeyPem: string): Promise<string> {
  const { createSign } = await import('node:crypto');

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;

  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(privateKeyPem, 'base64url');

  return `${signingInput}.${signature}`;
}

function base64url(str: string): string {
  return Buffer.from(str).toString('base64url');
}
