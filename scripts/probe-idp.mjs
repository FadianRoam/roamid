// Live probe of one identity provider entry: the OpenID Connect discovery
// document, or the SAML metadata (or inline values) and signing
// certificates. Shared by the registry check (CI) and the automatic review.
//
//   probeIdp(idp, { fetchFn }) -> { errors: [string], notes: [string] }
import { discoveryProblems } from "../src/oidc/upstream.js";
import { parseIdpMetadata } from "../src/saml/build.js";
import { certInfo } from "../src/saml/certs.js";

export async function probeIdp(idp, { fetchFn = fetch } = {}) {
  const errors = [], notes = [];
  if (idp.protocol === "saml2") await probeSaml(idp, fetchFn, errors, notes);
  else {
    const url = idp.issuer.replace(/\/$/, "") + "/.well-known/openid-configuration";
    try {
      const r = await fetchFn(url, { signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const p = discoveryProblems(idp, await r.json());
      if (p.length) errors.push(p.join("; "));
      else notes.push(`discovery OK (${url})`);
    } catch (e) {
      errors.push(`discovery ${url}: ${e.message}`);
    }
  }
  return { errors, notes };
}

async function probeSaml(idp, fetchFn, errors, notes) {
  let m = { entity_id: idp.entity_id, sso_url: idp.sso_url, certs: idp.certs || [], valid_until: null };
  const now = Math.floor(Date.now() / 1000);
  if (idp.metadata_url) {
    try {
      const r = await fetchFn(idp.metadata_url, { signal: AbortSignal.timeout(10000), redirect: "manual", headers: { Accept: "application/samlmetadata+xml, application/xml" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      m = parseIdpMetadata(await r.text());
    } catch (e) {
      errors.push(`metadata ${idp.metadata_url}: ${e.message}`);
      return;
    }
    if (idp.entity_id && m.entity_id !== idp.entity_id) errors.push(`entityID in the metadata (${m.entity_id}) differs from entity_id`);
    if (m.valid_until && m.valid_until <= now) errors.push("the metadata has expired (validUntil)");
    if (!/^https:\/\//.test(m.sso_url || "")) errors.push("SingleSignOnService is not https");
  }
  let valid = 0;
  for (const c of m.certs) {
    try {
      const i = certInfo(c);
      if (i.notBefore <= now && i.notAfter > now) valid++;
      notes.push(`signing certificate ${i.subject.replace(/\n/g, ", ")}, valid until ${new Date(i.notAfter * 1000).toISOString().slice(0, 10)}`);
    } catch { errors.push("a signing certificate cannot be read"); }
  }
  if (!valid) errors.push("no signing certificate is valid now");
  else notes.push(`SAML ${idp.metadata_url ? `metadata OK (${idp.metadata_url})` : "inline configuration OK"}, entity ${m.entity_id}, SSO ${m.sso_url}`);
}
