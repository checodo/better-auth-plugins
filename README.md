<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/docs/public/brand/logo-inverted.svg">
    <img src="apps/docs/public/brand/logo.svg" alt="better-auth-plugins" height="64">
  </picture>
</h1>

Plugins for [better-auth](https://better-auth.com) that install and work
like the ones that ship with it: audit logs, blocklists, waitlists,
referrals, security alerts, and gaming sign-ins.

**[Documentation](https://checodo-better-auth-plugins.vercel.app)** ·
[Combining plugins](https://checodo-better-auth-plugins.vercel.app/docs/combining-plugins) ·
[Compliance](https://checodo-better-auth-plugins.vercel.app/docs/compliance) ·
[Changelog](https://checodo-better-auth-plugins.vercel.app/docs/changelog)

## Plugins

| Plugin                                                                                                                                                                                                                                          | What it does                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [**Audit log**](https://checodo-better-auth-plugins.vercel.app/docs/audit-log) <br> [![npm](https://img.shields.io/npm/v/@checodo/better-auth-audit-log)](https://www.npmjs.com/package/@checodo/better-auth-audit-log)                         | Records every sign-in method, failed sign-ins, account changes, and admin actions. Retention, a tamper-evident hash chain, export as NDJSON or CSV, and forwarding to a SIEM, a log service, or a webhook. |
| [**Blocklist**](https://checodo-better-auth-plugins.vercel.app/docs/blocklist) <br> [![npm](https://img.shields.io/npm/v/@checodo/better-auth-blocklist)](https://www.npmjs.com/package/@checodo/better-auth-blocklist)                         | Blocks disposable email domains, reserved usernames and organization names, weak passwords, and IP addresses or countries. Lists included.                                                                 |
| [**Waitlist**](https://checodo-better-auth-plugins.vercel.app/docs/waitlist) <br> [![npm](https://img.shields.io/npm/v/@checodo/better-auth-waitlist)](https://www.npmjs.com/package/@checodo/better-auth-waitlist)                             | Puts sign-up behind a waitlist: people join, admins approve, invites let them in. Email confirmation and cleanup included.                                                                                 |
| [**Referral**](https://checodo-better-auth-plugins.vercel.app/docs/referral) <br> [![npm](https://img.shields.io/npm/v/@checodo/better-auth-referral)](https://www.npmjs.com/package/@checodo/better-auth-referral)                             | Referral codes for every user, attribution at sign-up, and reward steps you trigger (first purchase, verified email...).                                                                                   |
| [**Security alerts**](https://checodo-better-auth-plugins.vercel.app/docs/security-alerts) <br> [![npm](https://img.shields.io/npm/v/@checodo/better-auth-security-alerts)](https://www.npmjs.com/package/@checodo/better-auth-security-alerts) | Tells users about sign-ins from new devices and changes to their account, with a "This wasn't me" link that secures it.                                                                                    |
| [**Authentication**](https://checodo-better-auth-plugins.vercel.app/docs/authentication) <br> [![npm](https://img.shields.io/npm/v/@checodo/better-auth-authentication)](https://www.npmjs.com/package/@checodo/better-auth-authentication)     | Sign in with Steam, Epic Games, and Xbox, like better-auth's built-in social providers.                                                                                                                    |

## Quick start

Install the plugins you need, for example the audit log and the
blocklist:

```bash
npm install @checodo/better-auth-audit-log @checodo/better-auth-blocklist
```

Add them to your auth config (the audit log goes last, so it sees
finished sign-ins):

```ts
// auth.ts
import { auditLog } from "@checodo/better-auth-audit-log";
import { blocklist } from "@checodo/better-auth-blocklist";
import { disposableEmailDomains } from "@checodo/better-auth-blocklist/lists";
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  emailAndPassword: { enabled: true },
  plugins: [
    blocklist({ email: { domains: disposableEmailDomains } }),
    auditLog({ retention: { days: 90 } }),
  ],
});
```

Then create their tables with `npx auth@latest migrate` (or `generate`),
and add the client plugins:

```ts
// auth-client.ts
import { auditLogClient } from "@checodo/better-auth-audit-log/client";
import { blocklistClient } from "@checodo/better-auth-blocklist/client";
import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
  plugins: [blocklistClient(), auditLogClient()],
});

const { data } = await authClient.auditLog.listEvents();
```

Each plugin's docs page has its options, endpoints, error codes, and
database schema.

## Why these plugins

- **Built like better-auth's own.** Each one is a server plugin plus a
  typed client plugin, with error codes, a database schema for the
  better-auth CLI, and `auth.api` endpoints. No database code of their
  own: they use your better-auth adapter.
- **They work together.** The blocklist checks waitlist emails, referral
  codes ride on the same sign-up, and the audit log records what the
  others do. None depends on another.
- **Tested.** Every plugin has its own test suite. CI runs it on every
  pull request, also against the lowest supported better-auth version,
  and installs the packed packages into a fresh app to check them the
  way you get them.
- **Published with care.** Releases come only from GitHub Actions, with
  npm provenance, an SBOM, and signed build provenance on each GitHub
  release.
- **Honest about compliance.** The
  [compliance page](https://checodo-better-auth-plugins.vercel.app/docs/compliance)
  says which SOC 2, ISO 27001, and GDPR controls each plugin helps with,
  and what stays your job.

Requires better-auth 1.7.20 or a later 1.x release. ESM only. Versions
are `0.x`: a minor version may contain breaking changes, and each
package's changelog says so.

## Contributing

Requires Node 24 (see `.nvmrc`) and pnpm 12 (pinned in `package.json`).

```bash
pnpm install
pnpm check       # lint, typecheck, test, build, package checks: run before every PR

# run the docs site (port 3000)
pnpm --filter docs dev

# run the playground with every plugin (http://localhost:3001)
pnpm turbo run dev --filter=playground...
```

```
apps/
  docs/            Fumadocs documentation site
  playground/      Next.js app to try the plugins (private, unpublished)
packages/
  <plugin>/        one package per plugin: @checodo/better-auth-<plugin>
  plugin-utils/    shared helpers bundled into each plugin (private, unpublished)
  tooling/         shared tsconfig/tsdown/vitest config (private, unpublished)
```

[CONTRIBUTING.md](./CONTRIBUTING.md) has every command, the plugin
structure, the better-auth conventions every plugin follows, the git
workflow (short-lived branches, squash-merged), changesets, and how
releases work. Every PR that changes a package needs a changeset
(`pnpm changeset`); nothing is published from a local machine.

## Security

Found a vulnerability? Please report it privately, not in a public issue:
see [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE.md). A community project, not made by the better-auth
team. The plugins are provided as is, without warranty (see the
license); test them in your own application like any other dependency.
