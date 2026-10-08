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

A report alone does not change anything. It is queued for the operator, and the number of distinct reporters in the last 24 hours raises its priority.

## Operator actions

The operator reviews reports at `/admin/reports` and can, with a reason that the owner sees:

| Action | Effect |
|---|---|
| Dismiss | The open reports are closed. |
| Warn | The reason is shown to the owners in the console. |
| Suspend | Sign-in is refused before the picker (`app_suspended`); the application receives `access_denied`; `/token` refuses it. Temporary. |
| Ban | For illegal sites. Like suspend; the person is not sent back to the application; the domain cannot be used for another application. |
| Restore | Back to `active` (or `development`) when the checks pass. |
| Lift limit | Ends the new-application daily sign-in limit early. |

Every action is recorded with the time, the operator and the reason. Owners see the actions on their applications in the console history.

Identity providers stay under human governance: a provider is retired by a registry pull request setting `"status": "disabled"`. In an emergency the operator can disable a provider at once (an override stored by the instance); it reads as disabled everywhere until the operator removes the override.

## Appeals

The owner of a suspended or banned application can appeal from the application's page in the console. An appeal opens a new item in the operator's queue. The operator answers by restoring the application or by keeping the action; either way the decision is recorded in the history.
