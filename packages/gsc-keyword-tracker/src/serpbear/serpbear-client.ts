import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

/** SerpBear keyword position data */
export interface SerpBearKeyword {
  id: number;
  keyword: string;
  position: number;
  previousPosition: number;
  country: string;
  device: string;
  domain: string;
  lastUpdated: string;
  history: Array<{ date: string; position: number }>;
  tags: string[];
}

/** SerpBear domain data */
export interface SerpBearDomain {
  id: number;
  domain: string;
  keywords: SerpBearKeyword[];
  slug: string;
}

/** SerpBear client configuration */
export interface SerpBearConfig {
  baseUrl: string; // e.g., 'http://localhost:3000' or 'https://serpbear.example.com'
  apiKey: string;
}

/**
 * SerpBear self-hosted rank tracker API client.
 * SerpBear tracks actual SERP positions daily, separate from GSC.
 */
export class SerpBearClient {
  private config: SerpBearConfig;

  constructor(config: SerpBearConfig) {
    this.config = config;
  }

  /**
   * Get all domains configured in SerpBear.
   */
  async getDomains(): Promise<SerpBearDomain[]> {
    const response = await this.get('/api/domains');
    const data = JSON.parse(response);
    return (data.domains || []) as SerpBearDomain[];
  }

  /**
   * Get keywords for a specific domain.
   */
  async getKeywords(domainId: number): Promise<SerpBearKeyword[]> {
    const response = await this.get(`/api/keywords?domain=${domainId}`);
    const data = JSON.parse(response);
    return (data.keywords || []) as SerpBearKeyword[];
  }

  /**
   * Get keyword position history.
   */
  async getKeywordHistory(keywordId: number): Promise<Array<{ date: string; position: number }>> {
    const response = await this.get(`/api/keywords/${keywordId}/history`);
    const data = JSON.parse(response);
    return (data.history || []) as Array<{ date: string; position: number }>;
  }

  /**
   * Trigger a refresh of keyword positions in SerpBear.
   */
  async refreshKeywords(domainId: number): Promise<boolean> {
    try {
      await this.get(`/api/refresh?domain=${domainId}`);
      return true;
    } catch {
      return false;
    }
  }

  private get(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.config.baseUrl);
      const isHttps = url.protocol === 'https:';
      const doRequest = isHttps ? httpsRequest : httpRequest;

      const req = doRequest(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            Accept: 'application/json',
          },
          timeout: 15_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8');
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`SerpBear API error ${res.statusCode}: ${text.substring(0, 200)}`));
            } else {
              resolve(text);
            }
          });
        }
      );
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.on('error', reject);
      req.end();
    });
  }
}

/**
 * Create SerpBear client from environment variables.
 */
export function createSerpBearClient(): SerpBearClient {
  const baseUrl = process.env.SERPBEAR_URL || process.env.SERPBEAR_BASE_URL;
  const apiKey = process.env.SERPBEAR_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error('SERPBEAR_URL and SERPBEAR_API_KEY environment variables required');
  }

  return new SerpBearClient({ baseUrl, apiKey });
}
