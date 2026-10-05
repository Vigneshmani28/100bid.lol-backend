import dns from "node:dns/promises";
import net from "node:net";

/**
 * SSRF-safe URL handling.
 *
 * Users submit arbitrary website URLs. We must never let the server make a
 * request to an internal/private/link-local/loopback address, cloud metadata
 * endpoint, or a non-http(s) scheme — including via a redirect chain.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

/** Cloud metadata IPs and other well-known SSRF targets, blocked outright. */
const BLOCKED_IPS = new Set([
  "169.254.169.254", // AWS/GCP/Azure metadata
  "169.254.170.2", // AWS ECS task metadata
  "0.0.0.0",
  "127.0.0.1",
  "::1",
]);

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/**
 * Normalizes a user-supplied URL string into a canonical https/http URL.
 * Adds a scheme if missing. Throws UnsafeUrlError for disallowed schemes.
 */
export function normalizeUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new UnsafeUrlError("URL is required");

  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new UnsafeUrlError("Malformed URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Unsupported URL scheme: ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with embedded credentials are not allowed");
  }

  return url;
}

/** True if the given IPv4/IPv6 address is private, reserved, loopback, or link-local. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true; // not a valid IP at all — treat as unsafe
}

function isPrivateIpv4(ip: string): boolean {
  if (BLOCKED_IPS.has(ip)) return true;
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;

  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 IETF protocol
  if (a === 192 && b === 0 && parts[2] === 2) return true; // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved (224-255)

  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (BLOCKED_IPS.has(normalized)) return true;
  if (normalized === "::") return true;
  if (normalized.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — validate the embedded IPv4 address.
    const embedded = normalized.split(":").pop() ?? "";
    if (net.isIP(embedded) === 4) return isPrivateIpv4(embedded);
  }
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local (fc00::/7)
  if (normalized === "::1") return true; // loopback

  return false;
}

/**
 * Resolves the hostname and asserts every resolved IP is public. Throws
 * UnsafeUrlError otherwise. Must be called for the original URL AND for
 * every hop in a redirect chain, since a public hostname can still resolve
 * (or later be re-pointed via DNS rebinding) to a private address.
 */
export async function assertPublicHost(url: URL): Promise<void> {
  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UnsafeUrlError("This hostname is not allowed");
  }

  // If the hostname is already a literal IP, validate it directly.
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new UnsafeUrlError("URLs pointing to private/internal addresses are not allowed");
    }
    return;
  }

  let records: string[];
  try {
    const results = await dns.lookup(hostname, { all: true, verbatim: true });
    records = results.map((r) => r.address);
  } catch {
    throw new UnsafeUrlError("Could not resolve this hostname");
  }

  if (records.length === 0) {
    throw new UnsafeUrlError("Could not resolve this hostname");
  }

  for (const ip of records) {
    if (isPrivateOrReservedIp(ip)) {
      throw new UnsafeUrlError("URLs pointing to private/internal addresses are not allowed");
    }
  }
}

/**
 * Screening for a URL we will only ever *store and display*, never fetch.
 *
 * Skips the DNS resolution `assertPublicHost` does — a brand's site may be
 * unresolvable from our network yet perfectly real for visitors, and refusing
 * it would block a bid over something we never act on. Literal private/
 * reserved IPs and blocked hostnames are still rejected, so the wall can't be
 * used to publish a link to someone's intranet. Never use this for a URL that
 * is about to be requested server-side — that needs `assertSafeUrl`.
 */
export function assertDisplaySafeUrl(input: string): URL {
  const url = normalizeUrl(input);
  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UnsafeUrlError("This hostname is not allowed");
  }
  if (net.isIP(hostname) && isPrivateOrReservedIp(hostname)) {
    throw new UnsafeUrlError("URLs pointing to private/internal addresses are not allowed");
  }

  return url;
}

/** Full safety check: normalize + scheme check + DNS/IP check. */
export async function assertSafeUrl(input: string): Promise<URL> {
  const url = normalizeUrl(input);
  await assertPublicHost(url);
  return url;
}
