// XML for SAML: a hardened parser and small DOM helpers.
//
// The input is refused before parsing when it contains a DOCTYPE or an
// ENTITY declaration (no DTDs, no entity expansion, no external entities)
// or when it is larger than MAX_XML. Parser warnings and errors are fatal.

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

export const MAX_XML = 512 * 1024;
export const NS = {
  samlp: "urn:oasis:names:tc:SAML:2.0:protocol",
  saml: "urn:oasis:names:tc:SAML:2.0:assertion",
  md: "urn:oasis:names:tc:SAML:2.0:metadata",
  ds: "http://www.w3.org/2000/09/xmldsig#",
  xenc: "http://www.w3.org/2001/04/xmlenc#",
  xenc11: "http://www.w3.org/2009/xmlenc11#",
};

export class SamlError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function parseXml(str) {
  if (typeof str !== "string" || !str) throw new SamlError("saml_bad_xml", "empty document");
  if (str.length > MAX_XML) throw new SamlError("saml_bad_xml", "document too large");
  if (/<!DOCTYPE|<!ENTITY/i.test(str)) throw new SamlError("saml_bad_xml", "DOCTYPE and ENTITY declarations are not allowed");
  const fail = (m) => { throw new SamlError("saml_bad_xml", `XML: ${String(m).slice(0, 120)}`); };
  const doc = new DOMParser({ onError: (level, msg) => fail(msg) }).parseFromString(str, "text/xml");
  if (!doc || !doc.documentElement) fail("no root element");
  return doc;
}

export const serialize = (node) => new XMLSerializer().serializeToString(node);

export const isEl = (n, ns, local) => n && n.nodeType === 1 && n.namespaceURI === ns && n.localName === local;

export function children(el, ns, local) {
  const out = [];
  for (let n = el && el.firstChild; n; n = n.nextSibling) if (isEl(n, ns, local)) out.push(n);
  return out;
}
export const child = (el, ns, local) => children(el, ns, local)[0] || null;

// Every element with this name anywhere below `root` (used to count, never to pick).
export function descendants(root, ns, local) {
  return Array.from(root.getElementsByTagNameNS(ns, local));
}

// All text below an element. Comments are not text: "a<!---->b" reads "ab".
export function text(el) {
  if (!el) return "";
  let s = "";
  const walk = (n) => { for (let c = n.firstChild; c; c = c.nextSibling) { if (c.nodeType === 3 || c.nodeType === 4) s += c.data; else if (c.nodeType === 1) walk(c); } };
  walk(el);
  return s.trim();
}

export const attr = (el, name) => (el && el.hasAttribute(name) ? el.getAttribute(name) : null);

export function escapeXml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64encode(bytes) {
  const u = typeof bytes === "string" ? enc.encode(bytes) : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64decode(str) {
  const clean = String(str || "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new SamlError("saml_bad_xml", "not base64");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const b64decodeText = (s) => dec.decode(b64decode(s));

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}
export async function deflateRaw(str) { return pipe(enc.encode(str), new CompressionStream("deflate-raw")); }
export async function inflateRaw(bytes) {
  const out = await pipe(bytes, new DecompressionStream("deflate-raw"));
  if (out.length > MAX_XML) throw new SamlError("saml_bad_xml", "document too large");
  return dec.decode(out);
}

// SAML time: xs:dateTime in UTC.
export const samlTime = (secs) => new Date(secs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
export function parseTime(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

// IDs must start with a letter or underscore (xs:ID).
export const samlId = () => "_" + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("");
