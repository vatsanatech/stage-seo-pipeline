import * as cheerio from 'cheerio';

export type MobileIssueCategory =
  | 'viewport_missing'
  | 'viewport_invalid'
  | 'small_font'
  | 'small_touch_target'
  | 'fixed_width_image'
  | 'horizontal_scroll_risk'
  | 'no_responsive_meta';

export interface MobileUsabilityIssue {
  url: string;
  category: MobileIssueCategory;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  element?: string;
}

export interface MobileUsabilityReport {
  url: string;
  issues: MobileUsabilityIssue[];
  hasViewport: boolean;
  summary: Record<MobileIssueCategory, number>;
}

/**
 * Check a page's HTML for mobile usability issues.
 */
export function checkMobileUsability(pageUrl: string, html: string): MobileUsabilityReport {
  const $ = cheerio.load(html);
  const issues: MobileUsabilityIssue[] = [];

  // 1. Viewport meta tag
  const viewport = $('meta[name="viewport"]');
  const hasViewport = viewport.length > 0;

  if (!hasViewport) {
    issues.push({
      url: pageUrl,
      category: 'viewport_missing',
      severity: 'critical',
      message: 'Missing viewport meta tag — page will not render correctly on mobile',
    });
  } else {
    const content = viewport.first().attr('content') || '';
    if (!content.includes('width=device-width')) {
      issues.push({
        url: pageUrl,
        category: 'viewport_invalid',
        severity: 'warning',
        message: `Viewport meta tag missing "width=device-width": ${content}`,
        element: content,
      });
    }
    if (content.includes('maximum-scale=1') || content.includes('user-scalable=no')) {
      issues.push({
        url: pageUrl,
        category: 'viewport_invalid',
        severity: 'warning',
        message: 'Viewport disables user scaling — accessibility concern',
        element: content,
      });
    }
  }

  // 2. Inline font sizes < 12px
  checkInlineFontSizes($, pageUrl, issues);

  // 3. Small touch targets (links/buttons with explicit small dimensions)
  checkSmallTouchTargets($, pageUrl, issues);

  // 4. Fixed-width images that could cause horizontal scroll
  checkFixedWidthImages($, pageUrl, issues);

  // 5. Fixed-width containers
  checkFixedWidthContainers($, pageUrl, issues);

  const summary: Record<MobileIssueCategory, number> = {
    viewport_missing: 0,
    viewport_invalid: 0,
    small_font: 0,
    small_touch_target: 0,
    fixed_width_image: 0,
    horizontal_scroll_risk: 0,
    no_responsive_meta: 0,
  };

  for (const issue of issues) {
    summary[issue.category]++;
  }

  return { url: pageUrl, issues, hasViewport, summary };
}

function checkInlineFontSizes($: cheerio.CheerioAPI, url: string, issues: MobileUsabilityIssue[]): void {
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    const fontSizeMatch = style.match(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*px/i);
    if (fontSizeMatch) {
      const size = parseFloat(fontSizeMatch[1]);
      if (size < 12) {
        const tagName = (el as any).tagName || 'unknown';
        issues.push({
          url,
          category: 'small_font',
          severity: 'warning',
          message: `Inline font-size ${size}px is below 12px minimum for mobile readability`,
          element: `<${tagName} style="...font-size:${size}px...">`,
        });
      }
    }
  });
}

function checkSmallTouchTargets($: cheerio.CheerioAPI, url: string, issues: MobileUsabilityIssue[]): void {
  const touchElements = $('a, button, input[type="button"], input[type="submit"], [role="button"]');

  touchElements.each((_, el) => {
    const style = $(el).attr('style') || '';
    const widthMatch = style.match(/(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)\s*px/i);
    const heightMatch = style.match(/(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)\s*px/i);

    if (widthMatch || heightMatch) {
      const width = widthMatch ? parseFloat(widthMatch[1]) : Infinity;
      const height = heightMatch ? parseFloat(heightMatch[1]) : Infinity;

      if (width < 48 || height < 48) {
        const tagName = (el as any).tagName || 'unknown';
        const text = $(el).text().trim().slice(0, 50);
        issues.push({
          url,
          category: 'small_touch_target',
          severity: 'warning',
          message: `Touch target too small (${width === Infinity ? '?' : width}x${height === Infinity ? '?' : height}px, minimum 48x48px)`,
          element: `<${tagName}>${text}</${tagName}>`,
        });
      }
    }
  });
}

function checkFixedWidthImages($: cheerio.CheerioAPI, url: string, issues: MobileUsabilityIssue[]): void {
  $('img').each((_, el) => {
    const style = $(el).attr('style') || '';
    const width = $(el).attr('width');

    // Check inline style for fixed pixel width > 320px
    const styleWidthMatch = style.match(/(?:^|;)\s*width\s*:\s*(\d+)\s*px/i);
    if (styleWidthMatch) {
      const w = parseInt(styleWidthMatch[1], 10);
      if (w > 320) {
        issues.push({
          url,
          category: 'fixed_width_image',
          severity: 'warning',
          message: `Image has fixed width ${w}px which may cause horizontal scroll on mobile`,
          element: `<img src="${$(el).attr('src')?.slice(0, 80) || '...'}" style="width:${w}px">`,
        });
      }
    }

    // Check HTML width attribute > 320px without max-width in style
    if (width && parseInt(width, 10) > 320 && !style.includes('max-width')) {
      issues.push({
        url,
        category: 'fixed_width_image',
        severity: 'info',
        message: `Image has width="${width}" attribute without max-width constraint — may overflow on mobile`,
        element: `<img src="${$(el).attr('src')?.slice(0, 80) || '...'}" width="${width}">`,
      });
    }
  });
}

function checkFixedWidthContainers($: cheerio.CheerioAPI, url: string, issues: MobileUsabilityIssue[]): void {
  $('div, section, table, main, article').each((_, el) => {
    const style = $(el).attr('style') || '';
    const widthMatch = style.match(/(?:^|;)\s*width\s*:\s*(\d+)\s*px/i);

    if (widthMatch) {
      const w = parseInt(widthMatch[1], 10);
      if (w > 480) {
        const tagName = (el as any).tagName || 'div';
        issues.push({
          url,
          category: 'horizontal_scroll_risk',
          severity: 'warning',
          message: `Container has fixed width ${w}px — likely causes horizontal scroll on mobile`,
          element: `<${tagName} style="width:${w}px">`,
        });
      }
    }
  });
}
