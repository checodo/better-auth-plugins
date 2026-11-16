<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/docs/public/brand/logo-inverted.svg">
    <img src="apps/docs/public/brand/logo.svg" alt="better-auth-plugins" height="64">
  </picture>
</h1>

Community plugins for [better-auth](https://better-auth.com) that install
and behave like the ones that ship with it. Docs:
**[checodo-better-auth-plugins.vercel.app](https://checodo-better-auth-plugins.vercel.app)**.

## Packages

| Package                                                            | npm                                                                                                                                           | Description                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`@checodo/better-auth-audit-log`](./packages/audit-log)           | [![npm](https://img.shields.io/npm/v/@checodo/better-auth-audit-log)](https://www.npmjs.com/package/@checodo/better-auth-audit-log)           | Audit log of sign-ins, account changes, and admin actions.        |
| [`@checodo/better-auth-authentication`](./packages/authentication) | [![npm](https://img.shields.io/npm/v/@checodo/better-auth-authentication)](https://www.npmjs.com/package/@checodo/better-auth-authentication) | Sign in with Steam, Epic Games, and Xbox like built-in providers. |
| [`@checodo/better-auth-blocklist`](./packages/blocklist)           | [![npm](https://img.shields.io/npm/v/@checodo/better-auth-blocklist)](https://www.npmjs.com/package/@checodo/better-auth-blocklist)           | Block emails, usernames, names, weak passwords, and IP addresses. |
| [`@checodo/better-auth-referral`](./packages/referral)             | [![npm](https://img.shields.io/npm/v/@checodo/better-auth-referral)](https://www.npmjs.com/package/@checodo/better-auth-referral)             | Referral codes, sign-up attribution, and reward steps.            |
| [`@checodo/better-auth-waitlist`](./packages/waitlist)             | [![npm](https://img.shields.io/npm/v/@checodo/better-auth-waitlist)](https://www.npmjs.com/package/@checodo/better-auth-waitlist)             | Gate sign-up behind a waitlist with admin approval and invites.   |

Versions are `0.x`: a minor version may contain breaking changes (each
package's `CHANGELOG.md` says so).

## Apps

- **`apps/docs`**: a [Fumadocs](https://fumadocs.dev) site with usage docs
  for every plugin.
- **`apps/playground`**: a Next.js app with better-auth, every plugin, and
  the official plugins they work with, to try them by hand. Private, never
  published.

## Development

Requires Node 24 (see `.nvmrc`) and pnpm 12. The exact pnpm version is
pinned in `package.json` (`packageManager`), so Corepack or pnpm's own
version switching picks it up.

```bash
pnpm install

pnpm check       # lint, typecheck, test, build, package checks: run before every PR

pnpm build
pnpm test
pnpm typecheck
pnpm lint

# work on one package
pnpm --filter <package> test
pnpm --filter <package> test:watch

# run the docs site (port 3000)
pnpm --filter docs dev

# run the playground (http://localhost:3001), rebuilding the plugins on change
pnpm turbo run dev --filter=playground...

# delete the playground database (stop the playground first)
pnpm --filter playground reset-db
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for all commands, the plugin
structure, and the better-auth conventions every plugin follows.

## Repo layout

```
apps/
  docs/            Fumadocs documentation site
  playground/      Next.js app to try the plugins (private, unpublished)
packages/
  tooling/         shared tsconfig/tsdown/vitest config (private, unpublished)
  plugin-utils/    shared helpers bundled into each plugin (private, unpublished)
  <plugin>/        one package per plugin: @checodo/better-auth-<plugin>
```

## Plugin conventions

Every plugin follows the same shape as better-auth's own built-in plugins:
a server plugin (`.`), a companion client plugin (`./client`), typed
options, error codes, a DB schema, tests, and a docs page. `better-auth`
and `@better-auth/core` are peer dependencies and never bundled. The
details are in
[CONTRIBUTING.md](./CONTRIBUTING.md#better-auth-conventions).

## Git workflow

Trunk-based: `main` plus short-lived feature branches, squash-merged via
pull request. See [CONTRIBUTING.md](./CONTRIBUTING.md#git-workflow) for the
details.

## CI and releases

CI (`.github/workflows/ci.yml`) checks every push to `main` and every pull
request; `audit.yml` checks the dependencies for known vulnerabilities and
`scorecard.yml` the repository's security practices. Dependabot proposes
dependency updates weekly.

Each package is versioned independently with
[Changesets](https://github.com/changesets/changesets):

```bash
pnpm changeset           # describe a change to a package (every PR that changes one)
```

Versioning and publishing are done only by the `release.yml` workflow:
merged changesets become a "Version Packages" pull request, and merging
that publishes to npm with provenance, creates the tags and GitHub
releases (with the tarball, an SBOM, and signed build provenance per
package), and deploys the docs. Canary
versions are published by hand from the workflow. Nothing is ever
published from a local machine. See
[CONTRIBUTING.md](./CONTRIBUTING.md#ci-and-releases).

## Git hooks

`pnpm install` installs [Lefthook](https://lefthook.dev) (via the `prepare`
script). On commit it runs Biome (with fixes, re-staged) on the staged
files and checks that the lockfile is in sync. Humans can bypass it once
with `LEFTHOOK=0 git commit ...`; agents must not.

## Security

Found a vulnerability? Please report it privately, not in a public issue:
see [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE.md). Each package ships the same license file.

The plugins are provided as is, without warranty (see the license). Test
them in your own application like any other dependency.
