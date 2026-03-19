import { request } from 'node:https';
import { request as httpRequest } from 'node:http';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export function fetchUrl(url: string, opts: FetchOptions = {}): Promise<string> {
  const { timeoutMs = 15_000, headers = {} } = opts;

  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const doRequest = isHttps ? request : httpRequest;
    const parsedUrl = new URL(url);

    const req = doRequest(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          fetchUrl(redirectUrl, opts).then(resolve, reject);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout: ${url}`));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Rate limiter: wait between requests to avoid being blocked */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
