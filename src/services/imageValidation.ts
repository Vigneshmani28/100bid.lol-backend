/**
 * Detects an image's real format from its file signature ("magic bytes"),
 * rather than trusting the client-supplied MIME type or filename extension —
 * both of which are trivially spoofable. Only a small allowlist of common,
 * safe web image formats is supported.
 */

interface ImageSignature {
  ext: string;
  mime: string;
  check: (buf: Buffer) => boolean;
}

const SIGNATURES: ImageSignature[] = [
  {
    ext: "png",
    mime: "image/png",
    check: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    ext: "jpg",
    mime: "image/jpeg",
    check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: "webp",
    mime: "image/webp",
    check: (b) =>
      b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  },
  {
    ext: "gif",
    mime: "image/gif",
    check: (b) =>
      b.length >= 6 && (b.toString("ascii", 0, 6) === "GIF87a" || b.toString("ascii", 0, 6) === "GIF89a"),
  },
];

export function detectImageType(buffer: Buffer): { ext: string; mime: string } | null {
  for (const signature of SIGNATURES) {
    if (signature.check(buffer)) {
      return { ext: signature.ext, mime: signature.mime };
    }
  }
  return null;
}
