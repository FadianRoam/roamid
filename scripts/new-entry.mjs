#!/usr/bin/env node
// Write a registry entry by answering questions, then run the same checks as CI.
//   npm run new:app      registry/clients/<client_id>.json
//   npm run new:idp      registry/idps/<id>/idp.json  [--logo <file>]
// Offline: for a client secret, a 32-byte secret is generated here, printed
// once, and only its SHA-256 is written.
import { createInterface } from "node:readline/promises";
import { randomBytes, createHash } from "node:crypto";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { checkLogo } from "../src/registry/logo.js";
import { execFileSync } from "node:child_process";
import { buildClient, clientInstructions, buildIdp, idpInstructions } from "./scaffold.mjs";

const kind = process.argv[2];
if (kind !== "app" && kind !== "idp") { console.error("usage: node scripts/new-entry.mjs app|idp [--logo <file>]"); process.exit(2); }
// --logo <file> (identity providers): checked like CI before anything is written.
const li = process.argv.indexOf("--logo");
let logo = null;
if (li > 0) {
  if (kind !== "idp") { console.error("--logo is for identity providers"); process.exit(2); }
  const file = process.argv[li + 1];
  const bytes = readFileSync(file);
  const ext = (/\.([a-z]+)$/i.exec(file) || [])[1]?.toLowerCase().replace("jpeg", "jpg") || null;
  const c = checkLogo(bytes, ext);
  if (c.errors.length) { console.error(`Logo refused:\n  - ${c.errors.join("\n  - ")}`); process.exit(1); }
  logo = { bytes, ext: c.ext };
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def = "") => (await rl.question(`${q}${def ? ` [${def}]` : ""}: `)).trim() || def;
const f = {};
if (kind === "app") {
  f.client_id = await ask("client_id (a-z, 0-9, -; permanent)");
  f.name_en = await ask("Name (English)");
  f.name_zh = await ask("Name (Chinese, optional)");
  f.domain = await ask("Domain you control (example.com)");
  f.homepage = await ask("Homepage", f.domain ? `https://${f.domain}/` : "");
  f.protocol = await ask("Protocol: oidc or saml2", "oidc");
  if (f.protocol === "saml2") {
    f.entity_id = await ask("Entity ID");
    f.acs_urls = await ask("ACS URLs (space separated)");
    f.sign_cert = await ask("AuthnRequest signing certificate, base64 (optional)");
  } else {
    f.redirect_uris = await ask("Redirect URIs (space separated)");
    f.post_logout_redirect_uris = await ask("Post-logout redirect URIs (optional)");
    f.auth = await ask("Client authentication: none, private_key_jwt, client_secret_basic, client_secret_post", "client_secret_basic");
    if (f.auth === "private_key_jwt") f.jwks_uri = await ask("JWKS URI");
  }
  f.subject_type = await ask("Subject type: public or pairwise", "public");
  f.github = await ask("Your GitHub account");
  f.email = await ask("Contact email");
} else {
  f.id = await ask("id (a-z, 0-9, -; permanent; also the callback path)");
  f.name_en = await ask("Name (English)");
  f.name_zh = await ask("Name (Chinese, optional)");
  f.protocol = await ask("Protocol: oidc or saml2", "oidc");
  f.homepage = await ask("Homepage");
  if (f.protocol === "saml2") {
    f.metadata_url = await ask("Metadata URL (https; empty to give entity ID, SSO URL and certificate)");
    if (!f.metadata_url) { f.entity_id = await ask("Entity ID"); f.sso_url = await ask("HTTP-Redirect SSO URL"); f.certs = await ask("Signing certificate, base64 on one line"); }
    f.sub_source = await ask("Subject: nameid or an attribute name", "nameid");
    f.email_attribute_verified = await ask("Are released email addresses verified? yes/no", "no");
  } else {
    f.issuer = await ask("Issuer (exactly as in the discovery document)");
    f.client_id = await ask("Client ID created for RoamID at your IdP", "roamid");
    f.client_auth = await ask("Client authentication: private_key_jwt, client_secret_basic, client_secret_post", "private_key_jwt");
    f.scopes = await ask("Scopes", "openid email profile");
  }
  f.email_domains = await ask("Email domains you are authoritative for (space separated, optional)");
  f.github = await ask("Your GitHub account");
  f.email = await ask("Contact email");
}
rl.close();
let secret = null;
if (kind === "app" && /^client_secret_/.test(f.auth || "")) {
  secret = randomBytes(32).toString("base64url");
  f.client_secret_sha256 = createHash("sha256").update(secret).digest("hex");
}
const { entry, errors } = kind === "app" ? buildClient(f) : buildIdp(f);
if (errors.length) { console.error(`\nNot written:\n  - ${errors.join("\n  - ")}`); process.exit(1); }
const path = kind === "app" ? `registry/clients/${entry.client_id}.json` : `registry/idps/${entry.id}/idp.json`;
if (existsSync(path)) { console.error(`${path} exists; identifiers are permanent. Edit the file instead.`); process.exit(1); }
if (kind === "idp") mkdirSync(`registry/idps/${entry.id}`, { recursive: true });
writeFileSync(path, JSON.stringify(entry, null, 2) + "\n");
if (logo) { writeFileSync(`registry/idps/${entry.id}/logo.${logo.ext}`, logo.bytes); console.log(`Wrote registry/idps/${entry.id}/logo.${logo.ext}`); }
console.log(`\nWrote ${path}\n`);
if (secret) console.log(`Client secret (shown once, store it now; only its SHA-256 is in the file):\n\n  ${secret}\n`);
console.log((kind === "app" ? clientInstructions(entry) : idpInstructions(entry)).join("\n"));
console.log("\nRunning the registry checks (as CI):\n");
try { execFileSync(process.execPath, ["scripts/check.mjs", "--base", "origin/main", "--probe"], { stdio: "inherit" }); } catch { process.exitCode = 1; }
