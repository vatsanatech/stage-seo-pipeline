export type FreshnessCategory = 'fresh' | 'stale' | 'very_stale' | 'unknown';

export interface PageFreshness {
  url: string;
  lastModified: Date | null;
  ageInDays: number | null;
  category: FreshnessCategory;
}

export interface FreshnessReport {
  checkedAt: string;
  totalPages: number;
  fresh: PageFreshness[];
  stale: PageFreshness[];
  veryStale: PageFreshness[];
  unknown: PageFreshness[];
  summary: {
    fresh: number;
    stale: number;
    veryStale: number;
    unknown: number;
    avgAgeDays: number | null;
    oldestPage: { url: string; ageInDays: number } | null;
  };
  issues: FreshnessIssue[];
}

export interface FreshnessIssue {
  url: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  ageInDays: number | null;
}

export interface FreshnessThresholds {
  staleDays: number;
  veryStaleDays: number;
}

const DEFAULT_THRESHOLDS: FreshnessThresholds = {
  staleDays: 90,
  veryStaleDays: 180,
};

/**
 * Categorize a page's freshness based on its Last-Modified date.
 */
export function categorizeAge(
  lastModified: Date | null,
  now: Date = new Date(),
  thresholds: FreshnessThresholds = DEFAULT_THRESHOLDS
): { category: FreshnessCategory; ageInDays: number | null } {
  if (!lastModified) {
    return { category: 'unknown', ageInDays: null };
  }

  const ageMs = now.getTime() - lastModified.getTime();
  const ageInDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  if (ageInDays >= thresholds.veryStaleDays) {
    return { category: 'very_stale', ageInDays };
  }
  if (ageInDays >= thresholds.staleDays) {
    return { category: 'stale', ageInDays };
  }
  return { category: 'fresh', ageInDays };
}

/**
 * Analyze content freshness from crawled page data (headers from crawler).
 */
export function analyzeContentFreshness(
  pages: Array<{ url: string; headers: Record<string, string> }>,
  options: { thresholds?: FreshnessThresholds; now?: Date } = {}
): FreshnessReport {
  const now = options.now ?? new Date();
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;

  const results: PageFreshness[] = pages.map(page => {
    const lastModifiedHeader = page.headers['last-modified'] || page.headers['Last-Modified'];
    const lastModified = lastModifiedHeader ? new Date(lastModifiedHeader) : null;
    const validDate = lastModified && !isNaN(lastModified.getTime()) ? lastModified : null;
    const { category, ageInDays } = categorizeAge(validDate, now, thresholds);

    return {
      url: page.url,
      lastModified: validDate,
      ageInDays,
      category,
    };
  });

  return buildFreshnessReport(results, now);
}

/**
 * Analyze freshness from pre-parsed data.
 */
export function analyzeFreshnessFromDates(
  pages: Array<{ url: string; lastModified: Date | null }>,
  options: { thresholds?: FreshnessThresholds; now?: Date } = {}
): FreshnessReport {
  const now = options.now ?? new Date();
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;

  const results: PageFreshness[] = pages.map(page => {
    const { category, ageInDays } = categorizeAge(page.lastModified, now, thresholds);
    return { url: page.url, lastModified: page.lastModified, ageInDays, category };
  });

  return buildFreshnessReport(results, now);
}

function buildFreshnessReport(results: PageFreshness[], now: Date): FreshnessReport {
  const fresh = results.filter(r => r.category === 'fresh');
  const stale = results.filter(r => r.category === 'stale');
  const veryStale = results.filter(r => r.category === 'very_stale');
  const unknown = results.filter(r => r.category === 'unknown');

  const knownAges = results.filter(r => r.ageInDays !== null).map(r => r.ageInDays!);
  const avgAgeDays = knownAges.length > 0
    ? Math.round(knownAges.reduce((a, b) => a + b, 0) / knownAges.length)
    : null;

  const oldest = knownAges.length > 0
    ? results.reduce((max, r) => (r.ageInDays !== null && r.ageInDays > (max.ageInDays ?? -1)) ? r : max, results[0])
    : null;

  const issues: FreshnessIssue[] = [];

  for (const page of veryStale) {
    issues.push({
      url: page.url,
      severity: 'critical',
      message: `Content very stale (${page.ageInDays} days since last update)`,
      ageInDays: page.ageInDays,
    });
  }

  for (const page of stale) {
    issues.push({
      url: page.url,
      severity: 'warning',
      message: `Content stale (${page.ageInDays} days since last update)`,
      ageInDays: page.ageInDays,
    });
  }

  for (const page of unknown) {
    issues.push({
      url: page.url,
      severity: 'info',
      message: 'No Last-Modified header — cannot determine content freshness',
      ageInDays: null,
    });
  }

  return {
    checkedAt: now.toISOString(),
    totalPages: results.length,
    fresh,
    stale,
    veryStale,
    unknown,
    summary: {
      fresh: fresh.length,
      stale: stale.length,
      veryStale: veryStale.length,
      unknown: unknown.length,
      avgAgeDays,
      oldestPage: oldest && oldest.ageInDays !== null
        ? { url: oldest.url, ageInDays: oldest.ageInDays }
        : null,
    },
    issues,
  };
}
