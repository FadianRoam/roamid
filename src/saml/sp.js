// RoamID as SAML service provider of community identity providers.
//   samlStart()        the AuthnRequest (HTTP-Redirect, signed)
//   acs()              POST /saml/acs/<idp-id>: the Response (HTTP-POST)
//   spMetadataHandler  GET /saml/sp/metadata.xml[?idp=<id>]

import { b64encode, deflateRaw, samlId, SamlError, b64decodeText } from "./xml.js";
import { authnRequest, spMetadata, spEntityId, acsUrl } from "./build.js";
import { signRedirect, ALG } from "./dsig.js";
import { samlKeys } from "./certs.js";
import { samlConfig } from "./metadata.js";
import { verifyResponse, attrValue, DEFAULT_ATTRS, PERSISTENT } from "./response.js";
import { randomToken, sha256b64url } from "../lib/b64.js";
import { now, readForm, text } from "../lib/http.js";
import { emailAuthority, authoritativeDomains } from "../registry/domains.js";
import { getRegistry } from "../registry/store.js";

// { url, state, requestId }
export async function samlStart(env, idp, tx) {
  const cfg = await samlConfig(env, idp);
  const [key] = samlKeys(env);
  const id = samlId();
  const xml = authnRequest(env, { id, idpId: idp.id, destination: cfg.sso_url, forceAuthn: /\blogin\b/.test(tx.prompt || ""), isPassive: /\bnone\b/.test(tx.prompt || ""), now: now() });
  const state = randomToken(24);
  const q = `SAMLRequest=${encodeURIComponent(b64encode(await deflateRaw(xml)))}&RelayState=${encodeURIComponent(state)}&SigAlg=${encodeURIComponent(ALG.rsa256)}`;
  const url = `${cfg.sso_url}${cfg.sso_url.includes("?") ? "&" : "?"}${q}&Signature=${encodeURIComponent(signRedirect(q, key.key))}`;
  return { url, state, requestId: id };
}

// Verify the Response for `tx` and map it to { sub, claims } (sub is the
// provider's stable subject, before RoamID derives its own).
export async function samlLogin(env, idp, tx, samlResponseB64) {
  const cfg = await samlConfig(env, idp);
  const xml = b64decodeText(samlResponseB64);
  const r = await verifyResponse(xml, {
    acs: acsUrl(env, idp.id), spEntityId: spEntityId(env), idpEntityId: cfg.entity_id, requestId: tx.up_req_id,
    certs: cfg.certs, keys: samlKeys(env),
  });
  // One-time assertion IDs.
  const k = await sha256b64url(`saml|${idp.id}|${r.assertionId}`);
  const ins = await env.DB.prepare("INSERT INTO jti (k, expires) VALUES (?, ?) ON CONFLICT(k) DO NOTHING").bind(k, r.notOnOrAfter + 300).run();
  if (!ins.meta || ins.meta.changes !== 1) throw new SamlError("saml_replay", "this assertion was already used");
  let sub;
  if (idp.sub_source === "nameid") {
    if (r.nameIdFormat !== PERSISTENT) throw new SamlError("saml_subject", `NameID format ${r.nameIdFormat || "(none)"} is not persistent`);
    sub = r.nameId;
  } else {
    sub = attrValue(r.attributes, [idp.sub_source]);
  }
  if (typeof sub !== "string" || !sub || sub.length > 255) throw new SamlError("saml_subject", "no stable subject in the assertion");
  const map = idp.attributes || {};
  const pick = (k) => attrValue(r.attributes, map[k] ? [map[k]] : DEFAULT_ATTRS[k]);
  const claims = {};
  const email = pick("email");
  if (typeof email === "string" && email.includes("@") && email.length <= 254) {
    claims.email = email;
    claims.email_authority = emailAuthority(email, idp.email_attribute_verified === true, await authoritativeDomains(env, idp));
    claims.email_verified = claims.email_authority === "authoritative";
  }
  for (const k of ["name", "preferred_username"]) { const v = pick(k); if (typeof v === "string" && v.length <= 500) claims[k] = v; }
  if (r.authnInstant) claims.auth_time = r.authnInstant;
  if (r.authnContext) claims.acr = r.authnContext.slice(0, 200);
  return { sub, claims };
}

export async function spMetadataHandler(request, env) {
  const reg = await getRegistry(env);
  const only = new URL(request.url).searchParams.get("idp");
  const ids = [...reg.idps.values()].filter((i) => i.protocol === "saml2" && (!only || i.id === only)).map((i) => i.id);
  if (only && !ids.length) return text("unknown identity provider\n", { status: 404 });
  return text(spMetadata(env, samlKeys(env), ids.length ? ids : ["-"]), { type: "application/samlmetadata+xml; charset=utf-8", cache: "public, max-age=300" });
}

export async function readSamlPost(request) {
  const f = await readForm(request);
  if (!f) return null;
  return { response: f.get("SAMLResponse"), request: f.get("SAMLRequest"), relayState: f.get("RelayState") };
}
