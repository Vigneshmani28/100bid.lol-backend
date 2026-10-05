import * as cheerio from "cheerio";
import { METADATA_MAX_IMAGE_BYTES } from "../config/constants";
import { safeFetch, type SafeFetchResult } from "./safeFetch";
import { assertSafeUrl, UnsafeUrlError } from "./urlSafety";

export interface BrandMetadata {
  brandName: string;
  description: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
  canonicalUrl: string;
  websiteUrl: string;
}

/**
 * Fetches a brand's website and extracts standardized ad metadata using
 * fallback priority rules. Never executes scripts on the target page — the
 * HTML is only ever parsed as text with cheerio, never rendered.
 */
export interface CandidateMetadata {
  brandName: string;
  description: string | null;
  imageUrlCandidate: string | null;
  faviconCandidate: string | null;
  canonicalUrl: string;
}

/**
 * Pure HTML-parsing step: extracts candidate metadata using the documented
 * fallback priority rules. Does not make any network calls, so it is fully
 * unit-testable without a real website.
 */
export function extractCandidateMetadata(html: string, finalUrl: URL): CandidateMetadata {
  const $ = cheerio.load(html);

  const meta = (name: string) =>
    clean($(`meta[property="${name}"]`).attr("content")) ??
    clean($(`meta[name="${name}"]`).attr("content"));

  const ogTitle = meta("og:title");
  const ogSiteName = meta("og:site_name");
  const ogDescription = meta("og:description");
  const twitterDescription = meta("twitter:description");
  const metaDescription = meta("description");
  const pageTitle = clean($("title").first().text());

  const ogImage = resolveMaybeUrl(meta("og:image"), finalUrl);
  const twitterImage = resolveMaybeUrl(meta("twitter:image"), finalUrl);

  const canonical =
    resolveMaybeUrl(clean($('link[rel="canonical"]').attr("href")), finalUrl) ??
    finalUrl.toString();

  const favicon = resolveFavicon($, finalUrl);

  // Brand name priority: og:site_name -> og:title -> <title> -> domain name
  const brandName =
    ogSiteName ?? ogTitle ?? pageTitle ?? finalUrl.hostname.replace(/^www\./, "");

  // Description priority: og:description -> twitter:description -> meta description
  const description = ogDescription ?? twitterDescription ?? metaDescription ?? null;

  // Image priority: og:image -> twitter:image -> favicon (resolved later)
  const imageUrlCandidate = ogImage ?? twitterImage ?? null;

  return {
    brandName: truncate(brandName, 120),
    description: description ? truncate(description, 300) : null,
    imageUrlCandidate,
    faviconCandidate: favicon,
    canonicalUrl: canonical,
  };
}

/**
 * Fetches a brand's website and extracts standardized ad metadata using
 * fallback priority rules. Never executes scripts on the target page — the
 * HTML is only ever parsed as text with cheerio, never rendered.
 */
export async function fetchBrandMetadata(rawUrl: string): Promise<BrandMetadata> {
  let pageFetch: SafeFetchResult;
  try {
    pageFetch = await safeFetch(rawUrl);
  } catch (err) {
    // A site that refuses to serve its own page to a server-side fetch
    // (bot/WAF defenses, a timeout, a 403/5xx) is not a dead end — Google's
    // favicon service only needs the domain, not the page HTML, so it
    // doesn't depend on this fetch succeeding at all. Fall back to a
    // domain-derived name and skip straight to the favicon lookup instead of
    // failing the whole preview. `err` is deliberately unused: whatever the
    // safeFetch failure was, the fallback path is the same. Re-run just the
    // URL safety check (no fetch) so a genuinely unsafe/malformed URL still
    // throws here rather than silently producing a fake preview.
    void err;
    const fallbackUrl = await assertSafeUrl(rawUrl);
    const imageUrl = await verifyImageIsSafe(googleFaviconUrl(fallbackUrl));
    return {
      brandName: fallbackUrl.hostname.replace(/^www\./, ""),
      description: null,
      imageUrl,
      faviconUrl: null,
      canonicalUrl: fallbackUrl.toString(),
      websiteUrl: fallbackUrl.toString(),
    };
  }

  const { finalUrl, contentType, body } = pageFetch;

  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw new UnsafeUrlError("This URL does not point to a webpage");
  }

  const html = body.toString("utf-8");
  const candidate = extractCandidateMetadata(html, finalUrl);

  // Image priority: Google's favicon service first, then og:image ->
  // twitter:image -> the page's own favicon link, each re-verified as a
  // safe, real image (never trust the HTML's or Google's claim alone).
  //
  // Every cell on the wall renders this as a small square. A page's
  // og:image is usually a wide social-card banner designed to be cropped
  // into a 1200x630 rectangle, not a square — it looks inconsistent next to
  // cells that only had a favicon to fall back on. Google's service returns
  // a uniformly-sized icon for almost any domain and has its own internal
  // fallback chain (icon type -> size -> crawling the site directly), so it
  // rarely fails outright — but if it ever does, we still fall back to the
  // page's own metadata exactly as before.
  const imageUrl =
    (await verifyImageIsSafe(googleFaviconUrl(finalUrl))) ??
    (candidate.imageUrlCandidate ? await verifyImageIsSafe(candidate.imageUrlCandidate) : null) ??
    (candidate.faviconCandidate ? await verifyImageIsSafe(candidate.faviconCandidate) : null);

  return {
    brandName: candidate.brandName,
    description: candidate.description,
    imageUrl,
    faviconUrl: candidate.faviconCandidate,
    canonicalUrl: candidate.canonicalUrl,
    websiteUrl: finalUrl.toString(),
  };
}

/**
 * Google's favicon service. Given any site, reliably returns a
 * consistently-sized square icon for that domain — this is what actually
 * renders in each grid cell, so a uniform icon looks far better than an
 * arbitrary og:image banner. Keyed off the origin (not the full page path),
 * since a favicon is site-wide, not page-specific.
 */
function googleFaviconUrl(target: URL, size = 128): string {
  const params = new URLSearchParams({
    client: "SOCIAL",
    type: "FAVICON",
    fallback_opts: "TYPE,SIZE,URL",
    url: target.origin,
    size: String(size),
  });
  return `https://t0.gstatic.com/faviconV2?${params.toString()}`;
}

/** Validates a candidate image URL is reachable, safe, and within size limits. */
async function verifyImageIsSafe(imageUrl: string): Promise<string | null> {
  try {
    const { contentType, body } = await safeFetch(imageUrl, {
      maxBytes: METADATA_MAX_IMAGE_BYTES,
      accept: "image/*",
    });
    if (!isAllowedImageType(contentType, body)) return null;
    return imageUrl;
  } catch {
    return null;
  }
}

const ALLOWED_IMAGE_SIGNATURES: Array<{ mime: string; check: (b: Buffer) => boolean }> = [
  { mime: "image/png", check: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", check: (b) => b.subarray(0, 3).toString("ascii") === "GIF" },
  { mime: "image/webp", check: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
  { mime: "image/x-icon", check: (b) => b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02) },
  { mime: "image/svg+xml", check: (b) => b.subarray(0, 200).toString("utf-8").trim().startsWith("<svg") || b.subarray(0, 200).toString("utf-8").includes("<?xml") },
];

/** Never trust Content-Type alone — verify the file signature (magic bytes) too. */
function isAllowedImageType(contentType: string, body: Buffer): boolean {
  if (body.byteLength === 0) return false;
  const declaresImage = contentType.startsWith("image/");
  const signatureMatch = ALLOWED_IMAGE_SIGNATURES.some((sig) => sig.check(body));
  return declaresImage && signatureMatch;
}

function resolveFavicon($: cheerio.CheerioAPI, base: URL): string | null {
  const iconHref =
    clean($('link[rel="icon"]').attr("href")) ??
    clean($('link[rel="shortcut icon"]').attr("href")) ??
    clean($('link[rel="apple-touch-icon"]').attr("href"));

  const resolved = resolveMaybeUrl(iconHref, base);
  if (resolved) return resolved;

  // Fallback to the conventional /favicon.ico path.
  return new URL("/favicon.ico", base).toString();
}

function resolveMaybeUrl(value: string | null, base: URL): string | null {
  if (!value) return null;
  try {
    const resolved = new URL(value, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function clean(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}
