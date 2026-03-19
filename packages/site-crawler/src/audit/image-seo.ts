import * as cheerio from 'cheerio';

export interface ImageInfo {
  src: string;
  alt: string | undefined;
  width: string | undefined;
  height: string | undefined;
  loading: string | undefined;
  isBelowFold: boolean;
}

export interface ImageSeoIssue {
  url: string;
  imageSrc: string;
  category: ImageSeoCategory;
  severity: 'critical' | 'warning' | 'info';
  message: string;
}

export type ImageSeoCategory =
  | 'missing_alt'
  | 'empty_alt'
  | 'missing_lazy_loading'
  | 'non_webp'
  | 'oversized'
  | 'missing_dimensions';

export interface ImageSeoReport {
  url: string;
  totalImages: number;
  issues: ImageSeoIssue[];
  summary: Record<ImageSeoCategory, number>;
}

const WEBP_EXTENSIONS = new Set(['.webp', '.avif']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.svg', '.webp', '.avif', '.ico']);

/**
 * Analyze all images on a page for SEO issues.
 */
export function checkImageSeo(pageUrl: string, html: string, headers?: Record<string, string>): ImageSeoReport {
  const $ = cheerio.load(html);
  const issues: ImageSeoIssue[] = [];
  const images: ImageInfo[] = [];

  $('img').each((index, el) => {
    const $img = $(el);
    const src = $img.attr('src') || $img.attr('data-src') || '';
    const alt = $img.attr('alt');
    const width = $img.attr('width');
    const height = $img.attr('height');
    const loading = $img.attr('loading');
    // Heuristic: images after first 3 are likely below fold
    const isBelowFold = index >= 3;

    images.push({ src, alt, width, height, loading, isBelowFold });

    const resolvedSrc = resolveImageSrc(src, pageUrl);

    // Missing alt attribute entirely
    if (alt === undefined) {
      issues.push({
        url: pageUrl,
        imageSrc: resolvedSrc,
        category: 'missing_alt',
        severity: 'critical',
        message: `Image missing alt attribute: ${resolvedSrc}`,
      });
    } else if (alt.trim() === '' && !isDecorativeImage($img)) {
      // Empty alt on non-decorative image
      issues.push({
        url: pageUrl,
        imageSrc: resolvedSrc,
        category: 'empty_alt',
        severity: 'warning',
        message: `Image has empty alt text (only acceptable for decorative images): ${resolvedSrc}`,
      });
    }

    // Missing lazy loading for below-fold images
    if (isBelowFold && loading !== 'lazy') {
      issues.push({
        url: pageUrl,
        imageSrc: resolvedSrc,
        category: 'missing_lazy_loading',
        severity: 'warning',
        message: `Below-fold image missing loading="lazy": ${resolvedSrc}`,
      });
    }

    // Non-WebP/AVIF format
    if (src && !isModernFormat(src)) {
      issues.push({
        url: pageUrl,
        imageSrc: resolvedSrc,
        category: 'non_webp',
        severity: 'info',
        message: `Image not in modern format (WebP/AVIF): ${resolvedSrc}`,
      });
    }

    // Missing width/height attributes (causes layout shift)
    if (!width || !height) {
      issues.push({
        url: pageUrl,
        imageSrc: resolvedSrc,
        category: 'missing_dimensions',
        severity: 'warning',
        message: `Image missing width/height attributes (causes CLS): ${resolvedSrc}`,
      });
    }
  });

  // Also check <picture> sources for format issues
  $('picture source').each((_, el) => {
    const srcset = $(el).attr('srcset') || '';
    const type = $(el).attr('type') || '';

    if (srcset && !type.includes('webp') && !type.includes('avif') && !isModernFormat(srcset.split(' ')[0])) {
      // Only info — the <picture> element may have a WebP source elsewhere
    }
  });

  const summary: Record<ImageSeoCategory, number> = {
    missing_alt: 0,
    empty_alt: 0,
    missing_lazy_loading: 0,
    non_webp: 0,
    oversized: 0,
    missing_dimensions: 0,
  };

  for (const issue of issues) {
    summary[issue.category]++;
  }

  return {
    url: pageUrl,
    totalImages: images.length,
    issues,
    summary,
  };
}

/**
 * Check image file size by making a HEAD request.
 * Returns issues for images over the size threshold.
 */
export async function checkImageSizes(
  pageUrl: string,
  html: string,
  maxSizeKb: number = 200
): Promise<ImageSeoIssue[]> {
  const $ = cheerio.load(html);
  const issues: ImageSeoIssue[] = [];
  const checked = new Set<string>();

  const imgSrcs: string[] = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (src) imgSrcs.push(src);
  });

  for (const src of imgSrcs) {
    const resolvedSrc = resolveImageSrc(src, pageUrl);
    if (checked.has(resolvedSrc)) continue;
    checked.add(resolvedSrc);

    if (!resolvedSrc.startsWith('http')) continue;

    try {
      const response = await fetch(resolvedSrc, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      const contentLength = response.headers.get('content-length');

      if (contentLength) {
        const sizeKb = parseInt(contentLength, 10) / 1024;
        if (sizeKb > maxSizeKb) {
          issues.push({
            url: pageUrl,
            imageSrc: resolvedSrc,
            category: 'oversized',
            severity: sizeKb > 500 ? 'critical' : 'warning',
            message: `Image file too large (${Math.round(sizeKb)}KB, max ${maxSizeKb}KB): ${resolvedSrc}`,
          });
        }
      }
    } catch {
      // Skip unreachable images
    }
  }

  return issues;
}

function resolveImageSrc(src: string, pageUrl: string): string {
  if (!src) return '(empty src)';
  try {
    return new URL(src, pageUrl).href;
  } catch {
    return src;
  }
}

function isModernFormat(src: string): boolean {
  try {
    const pathname = new URL(src, 'https://placeholder.com').pathname.toLowerCase();
    const ext = '.' + (pathname.split('.').pop() || '');
    return WEBP_EXTENSIONS.has(ext);
  } catch {
    const lower = src.toLowerCase();
    return lower.includes('.webp') || lower.includes('.avif');
  }
}

function isDecorativeImage($img: cheerio.Cheerio<any>): boolean {
  // Heuristic: role="presentation" or aria-hidden="true" indicates decorative
  return $img.attr('role') === 'presentation' || $img.attr('aria-hidden') === 'true';
}
