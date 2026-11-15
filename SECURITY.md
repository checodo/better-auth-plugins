# Security policy

These plugins sit in the authentication path of the apps that use them,
so security reports get priority over everything else in this repository.

## Reporting a vulnerability

**Please don't open a public issue, pull request, or discussion for a
security problem.** Report it privately instead, through GitHub:

1. Go to the repository's
   [**Security** tab](https://github.com/checodo/better-auth-plugins/security).
2. Click **Report a vulnerability**
   ([direct link](https://github.com/checodo/better-auth-plugins/security/advisories/new)).

Only the maintainers can see the report. Helpful details:

- the plugin and version (`@checodo/better-auth-<plugin>`), and the
  `better-auth` version;
- the relevant plugin options and better-auth settings (for example
  account linking, rate limiting, or the database adapter);
- steps to reproduce, ideally a minimal auth config and the requests that
  show the problem;
- what an attacker gains (taking over an account, getting past a
  waitlist or blocklist, reading other users' data, ...).

## What happens next

This is a small project with a single maintainer, so these are targets,
not guarantees:

- **Within 3 working days:** we confirm we got the report.
- **Within 10 working days:** we tell you whether we can reproduce it,
  how serious we think it is, and the plan for a fix.
- **Fix and release:** depends on the severity. We keep you posted while
  we work on it, and may ask you to check the fix.
- **Disclosure:** we publish a GitHub security advisory (with a CVE where
  it applies) once a fixed version is on npm. We ask you to keep the
  details private until then, up to 90 days after your report. If a fix
  takes longer, we'll explain why and agree on a date with you.

With your permission, we credit you in the advisory.

## Supported versions

| Package                               | Supported versions | Security fixes |
| ------------------------------------- | ------------------ | -------------- |
| `@checodo/better-auth-audit-log`      | latest release     | yes            |
| `@checodo/better-auth-authentication` | latest release     | yes            |
| `@checodo/better-auth-blocklist`      | latest release     | yes            |
| `@checodo/better-auth-referral`       | latest release     | yes            |
| `@checodo/better-auth-waitlist`       | latest release     | yes            |
| any of them                           | older releases     | no             |
| any of them                           | `canary` versions  | no             |

Only the latest release of each plugin gets security fixes. While the
plugins are on `0.x`, fixes come as a new release of the newest `0.x`
line; upgrade to get them. `canary` versions (snapshots of unreleased
changes) are for trying things out, not for production.

Nothing has been published to npm yet; this applies from the first
release.

## Scope

In scope: the published plugins in `packages/*` (server and client
code, including their default behavior and their documented options).

Out of scope, and where to go instead:

- **better-auth itself** and its built-in plugins: report to the
  [better-auth project](https://github.com/better-auth/better-auth/security).
  If you aren't sure whether a problem is in better-auth or in a plugin
  here, report it here; we'll forward it if needed.
- **`apps/playground` and `apps/docs`:** a local test app (with a fixed
  development secret on purpose) and the documentation site. Report
  problems with them as normal issues, unless they affect the published
  plugins.
- **Configurations the docs warn against**, for example setting `email`
  from a profile in `mapProfileToUser` while the provider is trusted for
  account linking, or rate limiting kept in memory across several
  servers. If the docs are unclear or the warning is missing, that is
  worth a report.
- Problems that need an attacker who already controls your server, your
  better-auth secret, or (for the audit log's hash chain) the chain's key.

## Security notes in the docs

Each plugin's docs page describes what it protects against and what it
doesn't, for example the
[waitlist's tokens and rate limits](./apps/docs/content/docs/waitlist.mdx),
the [audit log's hash chain](./apps/docs/content/docs/audit-log.mdx), and
[account linking for the sign-in providers](./apps/docs/content/docs/authentication/index.mdx).
