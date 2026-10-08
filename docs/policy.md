# Acceptable use, reports and appeals (v1)

[简体中文](zh-CN/policy.md)

## Acceptable use

An application registered with RoamID must not be used for:

- phishing or impersonation of another service, organization or person;
- fraud;
- distributing malware;
- content that is illegal where the application is offered.

Identity providers are reviewed by a person before they are listed ([registry.md](registry.md)). Applications are reviewed automatically ([rp-integration.md](rp-integration.md) section 12) and go live when the checks pass; the report channel below is how problems that the checks cannot see reach the operator.

## Reports

Anyone can report an application or an identity provider:

- from the sign-in page ("Report this application"),
- from the application's public page at `/apps/<client_id>`,
- or at `/report`.

The form asks for a category (phishing or impersonation, fraud, malware, illegal content, other), a description and, optionally, an email address for questions. It is protected by Orbit Verify.

RoamID stores the report, the identifier of the sign-in in progress when the report was made from the sign-in page (application and identity provider ids, no personal data), the optional email address, and a one-way hash of the reporter's network address. The hash is used only to count distinct reporters.

The form says: "If the report is upheld, its content may be published without your contact details." The reporter can tick "Do not publish my description"; a later publication of that report then shows only the category and the decision.

A report alone does not change anything. It is queued for the operator, and the number of distinct reporters in the last 24 hours raises its priority.

## Operator actions

The operator reviews reports at `/admin/reports`. Each decision names its basis: the operator ticks the open reports it is based on, and only those are upheld; the other reports stay open. Warn, suspend, ban and an identity provider disable without a ticked report are possible only as the operator's own initiative, which upholds no report. With a reason that the owner sees, the operator can:

| Action | Effect |
|---|---|
| Dismiss | The ticked reports are closed as not upheld. Not published. |
| Warn | The reason is shown to the owners in the console. |
| Suspend | Sign-in is refused before the picker (`app_suspended`); the application receives `access_denied`; `/token` refuses it. Temporary. |
| Ban | For illegal sites. Like suspend; the person is not sent back to the application; the domain cannot be used for another application. |
| Restore | Back to `active` (or `development`) when the checks pass. |
| Lift limit | Ends the new-application daily sign-in limit early. |

Every action is recorded with the time, the operator and the reason. Owners see the actions on their applications in the console history.

Identity providers stay under human governance: a provider is retired by a registry pull request setting `"status": "disabled"`. In an emergency the operator can disable a provider at once (an override stored by the instance); it reads as disabled everywhere until the operator removes the override.

## Transparency

Every operator decision is public: warn, suspend, ban and restore for applications; emergency disable and its removal for identity providers.

| Published | Never published |
|---|---|
| The application or identity provider id, its proven domain, the report category, the date (UTC), the decision and a one-line reason. | The reporter's identity, email address or network address hash; the sign-in in progress when the report was made; the operator's identifiers. |

- The record is available at `/transparency.json` (read-only, paged by `?after=<n>`), and mirrored every hour into this repository under `transparency/YYYY/MM.md` and `transparency/YYYY/MM.json`.
- A report's text is published only when the operator chooses "Publish report" for it after the decision. The operator edits a redacted copy first: email addresses and phone numbers are removed and links are made non-clickable (`hxxps://example[.]com`). Published reports also appear as issues labelled `report-upheld`, titled "Report: <category> — <target id>".
- A published report links the decision it was upheld by. A dismissed report is not published unless the operator explicitly chooses to; it is then marked "Not upheld" and linked to no decision. Dismissals and lifted limits are not part of the public record.
- When the reporter chose "Do not publish my description", only the category and the decision are published.
- An entry that was published in error is marked as withdrawn with a reason; it is not deleted.

## Appeals

The owner of a suspended or banned application, or the contact of an identity provider, can appeal:

- from the application's page in the console, or
- with the "Appeal a decision" issue form in this repository (`appeal.yml`); each decision record links to it.

An appeal opens a new item in the operator's queue. The operator answers by restoring the application or by keeping the action; either way the decision is recorded in the history and in the public record.
