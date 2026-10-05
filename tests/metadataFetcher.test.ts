import { describe, expect, it } from "vitest";
import { extractCandidateMetadata } from "../src/services/metadataFetcher";

const baseUrl = new URL("https://brand.example.com/about");

describe("extractCandidateMetadata", () => {
  it("prefers og:site_name for brand name, og:description for description, og:image for image", () => {
    const html = `
      <html><head>
        <title>Fallback Title</title>
        <meta name="description" content="fallback meta description" />
        <meta property="og:site_name" content="Brand Co" />
        <meta property="og:title" content="Brand Co | Home" />
        <meta property="og:description" content="The best brand ever." />
        <meta property="twitter:description" content="twitter fallback" />
        <meta property="og:image" content="/og-image.png" />
        <meta property="twitter:image" content="/twitter-image.png" />
        <link rel="canonical" href="https://brand.example.com/" />
        <link rel="icon" href="/favicon.png" />
      </head><body></body></html>
    `;

    const result = extractCandidateMetadata(html, baseUrl);

    expect(result.brandName).toBe("Brand Co");
    expect(result.description).toBe("The best brand ever.");
    expect(result.imageUrlCandidate).toBe("https://brand.example.com/og-image.png");
    expect(result.faviconCandidate).toBe("https://brand.example.com/favicon.png");
    expect(result.canonicalUrl).toBe("https://brand.example.com/");
  });

  it("falls back og:title -> <title> -> hostname for brand name when earlier tags are missing", () => {
    const withOgTitle = extractCandidateMetadata(
      `<html><head><meta property="og:title" content="Only OG Title" /></head></html>`,
      baseUrl,
    );
    expect(withOgTitle.brandName).toBe("Only OG Title");

    const withTitleOnly = extractCandidateMetadata(
      `<html><head><title>Page Title Only</title></head></html>`,
      baseUrl,
    );
    expect(withTitleOnly.brandName).toBe("Page Title Only");

    const withNothing = extractCandidateMetadata(`<html><head></head></html>`, baseUrl);
    expect(withNothing.brandName).toBe("brand.example.com");
  });

  it("strips the www. prefix when falling back to hostname", () => {
    const result = extractCandidateMetadata(
      `<html><head></head></html>`,
      new URL("https://www.example.com/"),
    );
    expect(result.brandName).toBe("example.com");
  });

  it("falls back og:description -> twitter:description -> meta description", () => {
    const twitterOnly = extractCandidateMetadata(
      `<html><head><meta name="twitter:description" content="twitter desc" /></head></html>`,
      baseUrl,
    );
    expect(twitterOnly.description).toBe("twitter desc");

    const metaOnly = extractCandidateMetadata(
      `<html><head><meta name="description" content="plain meta desc" /></head></html>`,
      baseUrl,
    );
    expect(metaOnly.description).toBe("plain meta desc");

    const none = extractCandidateMetadata(`<html><head></head></html>`, baseUrl);
    expect(none.description).toBeNull();
  });

  it("falls back og:image -> twitter:image -> null candidate", () => {
    const twitterOnly = extractCandidateMetadata(
      `<html><head><meta property="twitter:image" content="/tw.png" /></head></html>`,
      baseUrl,
    );
    expect(twitterOnly.imageUrlCandidate).toBe("https://brand.example.com/tw.png");

    const none = extractCandidateMetadata(`<html><head></head></html>`, baseUrl);
    expect(none.imageUrlCandidate).toBeNull();
  });

  it("falls back to /favicon.ico when no icon link tags are present", () => {
    const result = extractCandidateMetadata(`<html><head></head></html>`, baseUrl);
    expect(result.faviconCandidate).toBe("https://brand.example.com/favicon.ico");
  });

  it("falls back through icon -> shortcut icon -> apple-touch-icon", () => {
    const shortcutOnly = extractCandidateMetadata(
      `<html><head><link rel="shortcut icon" href="/shortcut.png" /></head></html>`,
      baseUrl,
    );
    expect(shortcutOnly.faviconCandidate).toBe("https://brand.example.com/shortcut.png");

    const appleOnly = extractCandidateMetadata(
      `<html><head><link rel="apple-touch-icon" href="/apple.png" /></head></html>`,
      baseUrl,
    );
    expect(appleOnly.faviconCandidate).toBe("https://brand.example.com/apple.png");
  });

  it("uses the final URL as canonical when no canonical link is present", () => {
    const result = extractCandidateMetadata(`<html><head></head></html>`, baseUrl);
    expect(result.canonicalUrl).toBe(baseUrl.toString());
  });

  it("ignores non-http(s) image/canonical/icon URLs", () => {
    const result = extractCandidateMetadata(
      `<html><head>
        <meta property="og:image" content="javascript:alert(1)" />
        <link rel="canonical" href="javascript:alert(1)" />
        <link rel="icon" href="javascript:alert(1)" />
      </head></html>`,
      baseUrl,
    );
    expect(result.imageUrlCandidate).toBeNull();
    expect(result.canonicalUrl).toBe(baseUrl.toString());
    // Even with a rejected icon URL, resolveFavicon still falls back to /favicon.ico.
    expect(result.faviconCandidate).toBe("https://brand.example.com/favicon.ico");
  });

  it("truncates very long brand names and descriptions", () => {
    const longName = "A".repeat(200);
    const longDescription = "B".repeat(400);
    const result = extractCandidateMetadata(
      `<html><head>
        <meta property="og:site_name" content="${longName}" />
        <meta property="og:description" content="${longDescription}" />
      </head></html>`,
      baseUrl,
    );
    expect(result.brandName.length).toBe(120);
    expect(result.brandName.endsWith("…")).toBe(true);
    expect(result.description?.length).toBe(300);
    expect(result.description?.endsWith("…")).toBe(true);
  });

  it("collapses whitespace in extracted text", () => {
    const result = extractCandidateMetadata(
      `<html><head><meta property="og:site_name" content="  Brand   Co  \n" /></head></html>`,
      baseUrl,
    );
    expect(result.brandName).toBe("Brand Co");
  });
});
