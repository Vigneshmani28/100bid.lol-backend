import {
  METADATA_FETCH_TIMEOUT_MS,
  METADATA_MAX_REDIRECTS,
  METADATA_MAX_RESPONSE_BYTES,
} from "../config/constants";
import { assertSafeUrl, UnsafeUrlError } from "./urlSafety";

export interface SafeFetchResult {
  finalUrl: URL;
  contentType: string;
  body: Buffer;
}

/**
 * Fetches a URL with SSRF protections applied to the initial URL AND to
 * every redirect hop (manual redirect handling — never let the HTTP client
 * follow redirects on our behalf, since that would bypass our IP checks).
 * Enforces a timeout and a maximum response size.
 */
export async function safeFetch(
  inputUrl: string,
  opts: { maxBytes?: number; timeoutMs?: number; accept?: string } = {},
): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? METADATA_MAX_RESPONSE_BYTES;
  const timeoutMs = opts.timeoutMs ?? METADATA_FETCH_TIMEOUT_MS;

  let currentUrl = await assertSafeUrl(inputUrl);

  for (let redirectCount = 0; redirectCount <= METADATA_MAX_REDIRECTS; redirectCount++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "100bidbot/1.0 (+https://100bid.lol)",
          accept: opts.accept ?? "text/html,application/xhtml+xml",
        },
      });
    } catch {
      if (controller.signal.aborted) {
        throw new UnsafeUrlError("Website took too long to respond");
      }
      throw new UnsafeUrlError("Could not reach this website");
    } finally {
      clearTimeout(timeout);
    }

    // Manual redirect handling: re-validate the Location target before following it.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new UnsafeUrlError("Website returned an invalid redirect");
      }
      const nextUrl = new URL(location, currentUrl);
      currentUrl = await assertSafeUrl(nextUrl.toString());
      continue;
    }

    if (!response.ok) {
      throw new UnsafeUrlError(`Website returned an error (${response.status})`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader && Number(contentLengthHeader) > maxBytes) {
      throw new UnsafeUrlError("Website response is too large");
    }

    const body = await readBodyWithLimit(response, maxBytes);
    return { finalUrl: currentUrl, contentType, body };
  }

  throw new UnsafeUrlError("Too many redirects");
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new UnsafeUrlError("Website response is too large");
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new UnsafeUrlError("Website response is too large");
      }
      chunks.push(value);
    }
  }

  return Buffer.concat(chunks);
}
