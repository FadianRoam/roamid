// Identity provider logos: PNG, WebP or JPEG only (no SVG: it can carry
// script). The type is read from the magic bytes and must match the file
// extension; dimensions come from the image header. Refused: more than
// 100 KB, smaller than 64 px or larger than 512 px on a side, an aspect
// ratio beyond 2:1, animation (APNG, animated WebP), and any data after the
// end of the image (polyglots). Pure function, no dependencies; used by CI,
// `npm run new:idp`, the issue-form bot and the Worker sync.

export const LOGO_LIMITS = { bytes: 100 * 1024, min: 64, max: 512, aspect: 2 };
export const LOGO_TYPES = { png: "image/png", webp: "image/webp", jpg: "image/jpeg" };

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const tag = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

function sniff(b) {
  if (b.length >= 8 && b[0] === 0x89 && tag(b, 1) === "PNG\r" && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 12 && tag(b, 0) === "RIFF" && tag(b, 8) === "WEBP") return "webp";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  return null;
}

function png(b) {
  let i = 8, w = 0, h = 0, first = true;
  while (i + 12 <= b.length) {
    const len = u32be(b, i), t = tag(b, i + 4);
    if (i + 12 + len > b.length) return { error: "a PNG chunk runs past the end of the file" };
    if (first) { if (t !== "IHDR" || len !== 13) return { error: "the PNG does not start with IHDR" }; w = u32be(b, i + 8); h = u32be(b, i + 12); first = false; }
    if (t === "acTL") return { error: "animated PNG (APNG) is not allowed" };
    i += 12 + len;
    if (t === "IEND") return i === b.length ? { w, h } : { error: "data after the end of the PNG (IEND)" };
  }
  return { error: "the PNG has no IEND chunk" };
}

function webp(b) {
  if (u32le(b, 4) + 8 !== b.length) return { error: "the WebP RIFF size does not match the file (trailing or missing data)" };
  let i = 12, w = 0, h = 0;
  while (i + 8 <= b.length) {
    const t = tag(b, i), len = u32le(b, i + 4), d = i + 8;
    if (d + len > b.length) return { error: "a WebP chunk runs past the end of the file" };
    if (t === "ANIM" || t === "ANMF") return { error: "animated WebP is not allowed" };
    if (t === "VP8X") { if (b[d] & 0x02) return { error: "animated WebP is not allowed" }; w = u24le(b, d + 4) + 1; h = u24le(b, d + 7) + 1; }
    else if (t === "VP8 " && !w) { if (b[d + 3] !== 0x9d || b[d + 4] !== 0x01 || b[d + 5] !== 0x2a) return { error: "bad VP8 frame header" }; w = (b[d + 6] | (b[d + 7] << 8)) & 0x3fff; h = (b[d + 8] | (b[d + 9] << 8)) & 0x3fff; }
    else if (t === "VP8L" && !w) { if (b[d] !== 0x2f) return { error: "bad VP8L header" }; const v = u32le(b, d + 1); w = (v & 0x3fff) + 1; h = ((v >>> 14) & 0x3fff) + 1; }
    i = d + len + (len & 1);
  }
  if (i !== b.length) return { error: "data after the last WebP chunk" };
  return w ? { w, h } : { error: "the WebP has no image header" };
}

function jpeg(b) {
  let i = 2, w = 0, h = 0;
  while (i + 2 <= b.length) {
    if (b[i] !== 0xff) return { error: "bad JPEG segment marker" };
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd9) return i + 2 === b.length ? (w ? { w, h } : { error: "the JPEG has no frame header" }) : { error: "data after the end of the JPEG (EOI)" };
    if (m >= 0xd0 && m <= 0xd7) { i += 2; continue; }
    if (i + 4 > b.length) break;
    const len = u16be(b, i + 2);
    if (len < 2 || i + 2 + len > b.length) return { error: "a JPEG segment runs past the end of the file" };
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(m)) { h = u16be(b, i + 5); w = u16be(b, i + 7); }
    i += 2 + len;
    if (m === 0xda) {
      // Entropy-coded data: up to the next marker that is not a stuffed
      // byte (FF00) or a restart marker (FFD0-FFD7).
      while (i + 1 < b.length && !(b[i] === 0xff && b[i + 1] !== 0x00 && !(b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7))) i++;
    }
  }
  return { error: "the JPEG has no end marker (EOI)" };
}

// bytes: Uint8Array. ext: "png" | "webp" | "jpg" (from the file name), or null
// when there is no name (a download). Returns { type, ext, width, height, errors }.
export function checkLogo(bytes, ext = null) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const errors = [];
  if (b.length > LOGO_LIMITS.bytes) errors.push(`logo: ${Math.ceil(b.length / 1024)} KB, at most 100 KB`);
  const kind = sniff(b);
  if (!kind) return { errors: [...errors, "logo: not a PNG, WebP or JPEG file (SVG and other formats are not accepted)"] };
  if (ext && ext !== kind) errors.push(`logo: the file is ${kind.toUpperCase()} but named .${ext}; use logo.${kind}`);
  const r = kind === "png" ? png(b) : kind === "webp" ? webp(b) : jpeg(b);
  if (r.error) return { type: LOGO_TYPES[kind], ext: kind, errors: [...errors, `logo: ${r.error}`] };
  const { w, h } = r;
  if (Math.min(w, h) < LOGO_LIMITS.min || Math.max(w, h) > LOGO_LIMITS.max) errors.push(`logo: ${w}×${h}; each side must be between 64 and 512 pixels`);
  else if (Math.max(w, h) / Math.min(w, h) > LOGO_LIMITS.aspect) errors.push(`logo: ${w}×${h}; the aspect ratio must be between 1:1 and 2:1`);
  return { type: LOGO_TYPES[kind], ext: kind, width: w, height: h, errors };
}
