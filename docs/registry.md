# Registry (v1)

[简体中文](zh-CN/registry.md)

The registry is the set of JSON files in `registry/`. It is public and contains no secrets.

```
registry/idps/<id>.json            identity providers   schema/idp.schema.json
registry/clients/<client_id>.json  applications         schema/client.schema.json
```

## Adding or changing an entry

1. Fork the repository and add or edit one file.
2. Run the checks locally (Node.js 22.5 or later):
   ```
   npm test
   node scripts/check.mjs --base origin/main --probe
   ```
3. Open a pull request with the matching template: identity provider or application.
4. CI runs the tests, the schema and rule checks, the permanent-identifier check against `main`, and for identity providers a live probe of the discovery document and the email domain TXT records. The result is in the job summary of the `check` workflow.
5. Identity providers: a maintainer reviews and merges. Applications: a pull request that only adds or changes `registry/clients/*.json` is merged automatically when the `check` workflow passed and every entry passes the automated review ([rp-integration.md](rp-integration.md) section 12), domain proof included; a change to an existing application must come from the GitHub account in its `contact.github`. Otherwise the `automerge` job comments with the reasons and a maintainer can still review it. The job runs on this repository with `main` checked out; it reads the pull request through the GitHub API and never runs its code. Within about 5 minutes the entry is published at `https://fadianroam.github.io/roamid/registry.json` and loaded by RoamID. `/status` shows the commit in use.

An identity provider entry with `client_auth` `client_secret_basic` or `client_secret_post` is only usable after its secret has been handed to the operator (see [idp-requirements.md](idp-requirements.md) section 2).

## Without an account at a listed identity provider

The developer console needs a sign-in through one of the listed identity providers. Without one, register by GitHub instead; every way below ends in a pull request that goes through the same checks (applications: automated review and automatic merge; identity providers: review by a maintainer).

**One click: a new file with a filled-in example, then "Propose new file".** Replace the example values, rename the file to your identifier, and submit. The template of the pull request opens with it.

| Entry | Open |
|---|---|
| Application, OpenID Connect | [new registry/clients/… file](https://github.com/FadianRoam/roamid/new/main/registry/clients?filename=your-app-id.json&value=%7B%0A%20%20%22%24schema%22%3A%20%22..%2F..%2Fschema%2Fclient.schema.json%22%2C%0A%20%20%22client_id%22%3A%20%22example-portal%22%2C%0A%20%20%22protocol%22%3A%20%22oidc%22%2C%0A%20%20%22name%22%3A%20%7B%0A%20%20%20%20%22en%22%3A%20%22Example%20Portal%22%2C%0A%20%20%20%20%22zh%22%3A%20%22%E7%A4%BA%E4%BE%8B%E9%97%A8%E6%88%B7%22%0A%20%20%7D%2C%0A%20%20%22homepage%22%3A%20%22https%3A%2F%2Fexample.com%2F%22%2C%0A%20%20%22domain%22%3A%20%22example.com%22%2C%0A%20%20%22contact%22%3A%20%7B%0A%20%20%20%20%22github%22%3A%20%22example-dev%22%2C%0A%20%20%20%20%22email%22%3A%20%22dev%40example.com%22%0A%20%20%7D%2C%0A%20%20%22redirect_uris%22%3A%20%5B%0A%20%20%20%20%22https%3A%2F%2Fportal.example.com%2Fauth%2Fcallback%22%0A%20%20%5D%2C%0A%20%20%22post_logout_redirect_uris%22%3A%20%5B%0A%20%20%20%20%22https%3A%2F%2Fportal.example.com%2F%22%0A%20%20%5D%2C%0A%20%20%22token_endpoint_auth_method%22%3A%20%22private_key_jwt%22%2C%0A%20%20%22jwks_uri%22%3A%20%22https%3A%2F%2Fportal.example.com%2F.well-known%2Fjwks.json%22%2C%0A%20%20%22subject_type%22%3A%20%22public%22%2C%0A%20%20%22status%22%3A%20%22active%22%0A%7D%0A&quick_pull=1&template=application.md) |
| Application, SAML 2.0 | [new registry/clients/… file](https://github.com/FadianRoam/roamid/new/main/registry/clients?filename=your-app-id.json&value=%7B%0A%20%20%22%24schema%22%3A%20%22..%2F..%2Fschema%2Fclient-saml2.schema.json%22%2C%0A%20%20%22client_id%22%3A%20%22example-wiki%22%2C%0A%20%20%22protocol%22%3A%20%22saml2%22%2C%0A%20%20%22name%22%3A%20%7B%0A%20%20%20%20%22en%22%3A%20%22Example%20Wiki%22%2C%0A%20%20%20%20%22zh%22%3A%20%22%E7%A4%BA%E4%BE%8B%E7%BB%B4%E5%9F%BA%22%0A%20%20%7D%2C%0A%20%20%22homepage%22%3A%20%22https%3A%2F%2Fwiki.example.com%2F%22%2C%0A%20%20%22domain%22%3A%20%22example.com%22%2C%0A%20%20%22contact%22%3A%20%7B%0A%20%20%20%20%22github%22%3A%20%22example-dev%22%2C%0A%20%20%20%20%22email%22%3A%20%22dev%40example.com%22%0A%20%20%7D%2C%0A%20%20%22entity_id%22%3A%20%22https%3A%2F%2Fwiki.example.com%2Fsaml%2Fmetadata%22%2C%0A%20%20%22acs_urls%22%3A%20%5B%0A%20%20%20%20%22https%3A%2F%2Fwiki.example.com%2Fsaml%2Facs%22%0A%20%20%5D%2C%0A%20%20%22subject_type%22%3A%20%22public%22%2C%0A%20%20%22status%22%3A%20%22active%22%0A%7D%0A&quick_pull=1&template=application.md) |
| Identity provider, OpenID Connect | [new registry/idps/… file](https://github.com/FadianRoam/roamid/new/main/registry/idps?filename=your-idp-id.json&value=%7B%0A%20%20%22%24schema%22%3A%20%22..%2F..%2Fschema%2Fidp.schema.json%22%2C%0A%20%20%22id%22%3A%20%22example%22%2C%0A%20%20%22protocol%22%3A%20%22oidc%22%2C%0A%20%20%22name%22%3A%20%7B%0A%20%20%20%20%22en%22%3A%20%22Example%20Community%22%2C%0A%20%20%20%20%22zh%22%3A%20%22%E7%A4%BA%E4%BE%8B%E7%A4%BE%E5%8C%BA%22%0A%20%20%7D%2C%0A%20%20%22issuer%22%3A%20%22https%3A%2F%2Flogin.example.org%2Frealms%2Fmain%22%2C%0A%20%20%22homepage%22%3A%20%22https%3A%2F%2Fexample.org%2F%22%2C%0A%20%20%22contact%22%3A%20%7B%0A%20%20%20%20%22github%22%3A%20%22example-admin%22%2C%0A%20%20%20%20%22email%22%3A%20%22admin%40example.org%22%0A%20%20%7D%2C%0A%20%20%22client_id%22%3A%20%22roamid%22%2C%0A%20%20%22client_auth%22%3A%20%22private_key_jwt%22%2C%0A%20%20%22scopes%22%3A%20%5B%0A%20%20%20%20%22openid%22%2C%0A%20%20%20%20%22email%22%2C%0A%20%20%20%20%22profile%22%0A%20%20%5D%2C%0A%20%20%22email_domains%22%3A%20%5B%0A%20%20%20%20%22example.org%22%0A%20%20%5D%2C%0A%20%20%22status%22%3A%20%22active%22%0A%7D%0A&quick_pull=1&template=identity-provider.md) |
| Identity provider, SAML 2.0 | [new registry/idps/… file](https://github.com/FadianRoam/roamid/new/main/registry/idps?filename=your-idp-id.json&value=%7B%0A%20%20%22%24schema%22%3A%20%22..%2F..%2Fschema%2Fidp-saml2.schema.json%22%2C%0A%20%20%22id%22%3A%20%22example-saml%22%2C%0A%20%20%22protocol%22%3A%20%22saml2%22%2C%0A%20%20%22name%22%3A%20%7B%0A%20%20%20%20%22en%22%3A%20%22Example%20University%22%2C%0A%20%20%20%20%22zh%22%3A%20%22%E7%A4%BA%E4%BE%8B%E5%A4%A7%E5%AD%A6%22%0A%20%20%7D%2C%0A%20%20%22homepage%22%3A%20%22https%3A%2F%2Fexample.edu%2F%22%2C%0A%20%20%22contact%22%3A%20%7B%0A%20%20%20%20%22github%22%3A%20%22example-admin%22%2C%0A%20%20%20%20%22email%22%3A%20%22admin%40example.edu%22%0A%20%20%7D%2C%0A%20%20%22metadata_url%22%3A%20%22https%3A%2F%2Fidp.example.edu%2Fidp%2Fshibboleth%22%2C%0A%20%20%22entity_id%22%3A%20%22https%3A%2F%2Fidp.example.edu%2Fidp%2Fshibboleth%22%2C%0A%20%20%22sub_source%22%3A%20%22urn%3Aoasis%3Anames%3Atc%3ASAML%3Aattribute%3Asubject-id%22%2C%0A%20%20%22email_attribute_verified%22%3A%20true%2C%0A%20%20%22email_domains%22%3A%20%5B%0A%20%20%20%20%22example.edu%22%0A%20%20%5D%2C%0A%20%20%22status%22%3A%20%22active%22%0A%7D%0A&quick_pull=1&template=identity-provider.md) |

**Without git: a form.** [Register an application](https://github.com/FadianRoam/roamid/issues/new?template=register-application.yml) or [register an identity provider](https://github.com/FadianRoam/roamid/issues/new?template=register-identity-provider.yml). A bot turns the form into a pull request on a branch `issue-<number>` and comments with the next steps (the domain proof record, or the redirect URI to register at your provider). Secrets never go through issues: a field that looks like one is removed from the issue and nothing is opened. For a client secret, use the command below, or choose `private_key_jwt` or `none`. The pull request is checked by a `check` run started by the bot; for an application, the automatic review picks it up within 30 minutes.

**From a clone: a guided command.**

```
npm run new:app     # writes registry/clients/<client_id>.json
npm run new:idp     # writes registry/idps/<id>.json
```

It asks for the fields, writes the file, prints the DNS TXT record (or the well-known file) to publish and, for an identity provider, the redirect URI to register; then it runs the same checks as CI. With `client_secret_*` it generates a 32-byte secret on your machine, shows it once and writes only its SHA-256.

Copy-ready examples: [examples/](../examples/) (`app-oidc.json`, `app-saml2.json`, `idp-oidc.json`, `idp-saml2.json`). They use `example.com` style domains; the tests validate them against the schemas and do not run the network checks on them.

## Rules

| Rule | |
|---|---|
| File name | equals `id` (identity providers) or `client_id` (applications) |
| Identifiers | `id`: `[a-z0-9-]{2,32}`; `client_id`: `[a-z0-9-]{2,64}`; unique |
| Permanent | An identifier on `main` is never removed or renamed: subjects are derived from it. Retire with `"status": "disabled"`. CI refuses deletes and renames. |
| Issuer | https, no query or fragment, unique across identity providers |
| Email domains | unique across identity providers, including overlap by wildcard; each proven by TXT |
| Redirect URIs | https, or http on a loopback host; exact; no fragment or wildcard |
| Size | at most 500 identity providers and 5000 applications |

## Entry status at run time

RoamID validates every entry again when it loads the registry. An entry that fails is skipped and listed on `/status` with the reasons; the other entries stay in use. If the published file cannot be fetched or parsed, RoamID keeps the last copy that loaded.
