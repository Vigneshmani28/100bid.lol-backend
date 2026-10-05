/**
 * Minimal cookie-header reader. We only ever need to read one first-party
 * cookie (DataFast's visitor id) off the raw `Cookie` request header, so a
 * full `cookie-parser` dependency (+ its own build/verify step) isn't worth
 * pulling in for one field.
 */
export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}
