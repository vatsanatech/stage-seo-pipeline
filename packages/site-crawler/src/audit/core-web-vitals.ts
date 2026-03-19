export interface CoreWebVitals {
  url: string;
  strategy: 'mobile' | 'desktop';
  performanceScore: number;
  lcp: MetricResult; // Largest Contentful Paint
  cls: MetricResult; // Cumulative Layout Shift
  fid: MetricResult; // First Input Delay
  inp: MetricResult; // Interaction to Next Paint
  fcp: MetricResult; // First Contentful Paint
  ttfb: MetricResult; // Time to First Byte
  si: MetricResult; // Speed Index
  tbt: MetricResult; // Total Blocking Time
}

export interface MetricResult {
  value: number;
  unit: string;
  rating: 'good' | 'needs_improvement' | 'poor' | 'unknown';
}

export interface CwvIssue {
  url: string;
  metric: string;
  value: number;
  unit: string;
  threshold: number;
  rating: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
}

export interface CwvReport {
  url: string;
  strategy: 'mobile' | 'desktop';
  vitals: CoreWebVitals;
  issues: CwvIssue[];
  overallRating: 'good' | 'needs_improvement' | 'poor';
}

// Google-recommended thresholds
const THRESHOLDS = {
  lcp: { good: 2500, poor: 4000, unit: 'ms' },
  cls: { good: 0.1, poor: 0.25, unit: '' },
  fid: { good: 100, poor: 300, unit: 'ms' },
  inp: { good: 200, poor: 500, unit: 'ms' },
  fcp: { good: 1800, poor: 3000, unit: 'ms' },
  ttfb: { good: 800, poor: 1800, unit: 'ms' },
  si: { good: 3400, poor: 5800, unit: 'ms' },
  tbt: { good: 200, poor: 600, unit: 'ms' },
} as const;

type MetricName = keyof typeof THRESHOLDS;

function rateMetric(name: MetricName, value: number): MetricResult {
  const t = THRESHOLDS[name];
  let rating: MetricResult['rating'];
  if (value <= t.good) rating = 'good';
  else if (value <= t.poor) rating = 'needs_improvement';
  else rating = 'poor';
  return { value, unit: t.unit, rating };
}

/**
 * Fetch Core Web Vitals from Google PageSpeed Insights API.
 * Requires PAGESPEED_API_KEY environment variable (or works without key with rate limits).
 */
export async function fetchCoreWebVitals(
  url: string,
  strategy: 'mobile' | 'desktop' = 'mobile',
  apiKey?: string
): Promise<CoreWebVitals> {
  const key = apiKey || process.env.PAGESPEED_API_KEY || '';
  const params = new URLSearchParams({
    url,
    strategy,
    category: 'performance',
  });
  if (key) params.set('key', key);

  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`;
  const response = await fetch(apiUrl, { signal: AbortSignal.timeout(60000) });

  if (!response.ok) {
    throw new Error(`PageSpeed API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  return parsePageSpeedResponse(url, strategy, data);
}

/**
 * Parse a PageSpeed Insights API response into CoreWebVitals.
 */
export function parsePageSpeedResponse(
  url: string,
  strategy: 'mobile' | 'desktop',
  data: any
): CoreWebVitals {
  const audits = data?.lighthouseResult?.audits ?? {};
  const categories = data?.lighthouseResult?.categories ?? {};

  const performanceScore = Math.round((categories?.performance?.score ?? 0) * 100);

  const getValue = (auditId: string): number => {
    return audits[auditId]?.numericValue ?? 0;
  };

  return {
    url,
    strategy,
    performanceScore,
    lcp: rateMetric('lcp', getValue('largest-contentful-paint')),
    cls: rateMetric('cls', getValue('cumulative-layout-shift')),
    fid: rateMetric('fid', getValue('max-potential-fid')),
    inp: rateMetric('inp', getValue('interaction-to-next-paint') || getValue('max-potential-fid')),
    fcp: rateMetric('fcp', getValue('first-contentful-paint')),
    ttfb: rateMetric('ttfb', getValue('server-response-time')),
    si: rateMetric('si', getValue('speed-index')),
    tbt: rateMetric('tbt', getValue('total-blocking-time')),
  };
}

/**
 * Analyze Core Web Vitals and produce a report with issues.
 */
export function analyzeCwv(vitals: CoreWebVitals): CwvReport {
  const issues: CwvIssue[] = [];

  const checkMetric = (name: string, metric: MetricResult, thresholdKey: MetricName) => {
    const t = THRESHOLDS[thresholdKey];
    if (metric.rating === 'poor') {
      issues.push({
        url: vitals.url,
        metric: name,
        value: metric.value,
        unit: metric.unit,
        threshold: t.good,
        rating: metric.rating,
        severity: 'critical',
        message: `${name} is poor (${formatValue(metric.value, metric.unit)}, threshold: ${formatValue(t.good, metric.unit)})`,
      });
    } else if (metric.rating === 'needs_improvement') {
      issues.push({
        url: vitals.url,
        metric: name,
        value: metric.value,
        unit: metric.unit,
        threshold: t.good,
        rating: metric.rating,
        severity: 'warning',
        message: `${name} needs improvement (${formatValue(metric.value, metric.unit)}, target: ${formatValue(t.good, metric.unit)})`,
      });
    }
  };

  checkMetric('LCP', vitals.lcp, 'lcp');
  checkMetric('CLS', vitals.cls, 'cls');
  checkMetric('FID', vitals.fid, 'fid');
  checkMetric('INP', vitals.inp, 'inp');
  checkMetric('FCP', vitals.fcp, 'fcp');
  checkMetric('TTFB', vitals.ttfb, 'ttfb');
  checkMetric('SI', vitals.si, 'si');
  checkMetric('TBT', vitals.tbt, 'tbt');

  // Performance score check
  if (vitals.performanceScore < 50) {
    issues.push({
      url: vitals.url,
      metric: 'Performance Score',
      value: vitals.performanceScore,
      unit: '/100',
      threshold: 90,
      rating: 'poor',
      severity: 'critical',
      message: `Performance score is poor (${vitals.performanceScore}/100)`,
    });
  } else if (vitals.performanceScore < 90) {
    issues.push({
      url: vitals.url,
      metric: 'Performance Score',
      value: vitals.performanceScore,
      unit: '/100',
      threshold: 90,
      rating: 'needs_improvement',
      severity: 'warning',
      message: `Performance score needs improvement (${vitals.performanceScore}/100, target: 90+)`,
    });
  }

  // Overall rating based on core metrics (LCP, CLS, INP)
  let overallRating: CwvReport['overallRating'] = 'good';
  if (vitals.lcp.rating === 'poor' || vitals.cls.rating === 'poor' || vitals.inp.rating === 'poor') {
    overallRating = 'poor';
  } else if (vitals.lcp.rating === 'needs_improvement' || vitals.cls.rating === 'needs_improvement' || vitals.inp.rating === 'needs_improvement') {
    overallRating = 'needs_improvement';
  }

  return {
    url: vitals.url,
    strategy: vitals.strategy,
    vitals,
    issues,
    overallRating,
  };
}

function formatValue(value: number, unit: string): string {
  if (unit === 'ms') return `${Math.round(value)}ms`;
  if (unit === '') return value.toFixed(3);
  return `${value}${unit}`;
}
