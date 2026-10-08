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
