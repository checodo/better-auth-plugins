# Contributing

Details for working in this repo. For the big picture see
[AGENTS.md](./AGENTS.md) and [README.md](./README.md).

Security problems don't go in issues or pull requests: report them
privately as described in [SECURITY.md](./SECURITY.md).

## Setup

- **Node 24**, the exact version is in `.nvmrc` (`nvm use`). It is
  enforced (`engines` with `engine-strict`), so other versions refuse to
  install. Tests and the playground rely on Node's built-in
  `node:sqlite`, and the lists script runs TypeScript directly.
- **pnpm 12**, pinned in `package.json` (`packageManager`); Corepack or
  pnpm's own version switching picks it up. Other package managers fail
  to install: they don't understand pnpm's `catalog:` versions. (No
  `only-allow` preinstall script: it would download code with `npx`,
  outside the lockfile and the supply-chain settings below.)
- `pnpm install` also installs the Git hooks (Lefthook, see
  [Git hooks](#git-hooks)).

### Supply-chain settings

`pnpm-workspace.yaml` hardens installs, and installs that trip them are
not to be worked around:

- `minimumReleaseAge` (24 hours, strict): versions younger than a day
  don't install. Wait a day for a fresh release.
- `trustPolicy: no-downgrade`: a version published with weaker trust
  evidence than earlier ones (a possible package takeover) is refused.
  Keep the previous version and look into the release before upgrading.
- `allowBuilds`: only the listed packages may run install scripts. Add a
  package only after checking what its script does.

## Commands

```bash
pnpm check            # versions, docs, lint, typecheck, test, build, package checks: run before every PR
pnpm smoke            # pack every package, install it into a fresh app from npm, type-check and run it
pnpm build            # turbo run build
pnpm test             # turbo run test
pnpm test:db          # concurrency tests on Postgres or MySQL (see "Testing")
pnpm typecheck        # turbo run typecheck
pnpm lint             # biome check . --error-on-warnings
pnpm lint:fix         # biome check --write . (lint fixes and formatting)
pnpm lint:packages    # publint + arethetypeswrong on built packages
pnpm changeset        # describe a change to a package (see "Changesets")
pnpm deps:update      # interactive dependency updates within ranges
pnpm clean            # remove build output and turbo caches
pnpm reset            # clean and remove node_modules

pnpm --filter <package> test
pnpm --filter <package> exec vitest run test/<file>.test.ts   # one test file
pnpm --filter docs dev                      # docs site on :3000
pnpm turbo run dev --filter=playground...   # playground on :3001 (+ plugin watch builds)
pnpm --filter playground reset-db           # delete the playground database (stop it first)
pnpm --filter @checodo/better-auth-blocklist lists:update   # see "Predefined lists"
```

`pnpm smoke` needs network access (it installs better-auth from npm), so
it is not part of `pnpm check`. Run it when you change a `package.json`,
the `exports`, the build config, or imports between packages; CI runs it on
every pull request. `pnpm smoke -- --keep` keeps the temporary app for
debugging.

pnpm runs one script per call and passes any further words to it as
arguments, so `pnpm lint typecheck` does not run two scripts. Use
`pnpm check`, or chain calls with `&&`.

## Repository layout

```
apps/
  docs/            Fumadocs site, one page per plugin
  playground/      Next.js + better-auth app to try the plugins (private)
packages/
  tooling/         shared tsconfig, tsdown and vitest config (private)
  plugin-utils/    @repo/plugin-utils: helpers bundled into the plugins (private)
  <plugin>/        one published package per plugin
```

## Plugin structure

Each plugin package follows the same structure (the blocklist is the
reference):

```
src/
  index.ts         the server plugin: export const <name> = (options) => ({...})
  client.ts        the client plugin: $InferServerPlugin + pathMethods
  types.ts         <Name>Options + Resolved<Name>Options
  options.ts       resolves defaults and validates options, once, at creation
  error-codes.ts   defineErrorCodes({...})
  schema.ts        BetterAuthPluginDBSchema
  store.ts         adapter reads and writes for the plugin's own tables
  check.ts         (blocklist) the shared check used by routes/ and hooks/
  routes/          createAuthEndpoint handlers, one file per concern
  hooks/           hooks.before factories and databaseHooks (via init)
  utils/           pure helpers with their own unit tests
  lists/           (blocklist only) generated list files, plus a hand-written
                   index.ts; see "Predefined lists"
scripts/           maintenance scripts, not shipped (e.g. lists:update)
test/              vitest: integration tests with getTestInstance, unit
                   tests for utils/ and scripts/
turbo.json         makes `dev` wait for `build` (see "When adding a new plugin")
```

## better-auth conventions

Plugins target the latest `better-auth` / `@better-auth/core` release.
The pnpm catalog holds the one version range, and every package uses it
with `catalog:` for both the peer and the dev dependency, so the version
we test against is the lowest version we support (pnpm writes the real
range into the published `package.json`). A `better-auth` bump in the
catalog therefore raises the supported minimum too; update the
Requirements line in `apps/docs/content/docs/index.mdx` in the same change
(`pnpm check` fails if it doesn't match). The notes below were verified
against the `1.7.20` type declarations and runtime, not just the docs site
(the docs can lag behind the code). Re-check them when `better-auth` is
upgraded.

### Plugin shape

- **Server plugin**: a function returning `{ id, version, init?, schema?,
  endpoints?, hooks?, $ERROR_CODES?, options, ... }` that satisfies
  `BetterAuthPlugin` from `@better-auth/core`, not `better-auth`. Like the
  built-in plugins, set `version` (`import { version } from
  "../package.json"`; only the string is bundled) and `options` (the
  options the user passed). Use the same `id` in the client plugin.
- **Plugin type registry**: published plugins augment
  `BetterAuthPluginRegistry` in `@better-auth/core` (key = plugin `id`,
  `{ creator: typeof <plugin> }`), so `ctx.getPlugin("<id>")` infers the
  exact type. See the end of `packages/blocklist/src/index.ts`.
- **Options**: resolve defaults and compile anything expensive once, when
  the plugin is created (`options.ts`), not per request. Invalid static
  configuration throws right there, so mistakes show up at startup.
- **User callbacks** (like the blocklist's `onBlocked`): catch and log
  their errors (`ctx.context.logger`); a failing callback must not change
  the response the client gets.
- **Client plugin**: `$InferServerPlugin: {} as ReturnType<typeof plugin>`
  (import the server plugin as a type only), `pathMethods` for every
  endpoint, and `$ERROR_CODES`. `authClient.$ERROR_CODES` only exists in
  the types, not at runtime, so also export the error codes from the
  client entry point for apps to compare with `error.code`.

### Errors

- Build error codes with `defineErrorCodes` from
  `@better-auth/core/utils/error-codes`. It turns a plain
  `Record<string, string>` into `Record<string, RawError>`
  (`{ code, message }`). Never assign a plain string map to `$ERROR_CODES`
  directly.
- Throw with `APIError.from(status, X_ERROR_CODES.SOME_CODE)` from
  `better-auth/api`.

### Database

- **Schema**: type it as `BetterAuthPluginDBSchema` from
  `@better-auth/core/db` (not `@better-auth/core/db/plugin`, which isn't a
  published export path).
- **Uniqueness**: enforce it in the database with a table-level
  `indexes: [{ fields: [...], unique: true }]` (fields must be
  `required`), not only in endpoint code. A unique index bounds the string
  columns on MySQL and SQL Server, so cap those values in the endpoint's
  body schema. Endpoints still check for duplicates first and turn a
  unique-index error from a concurrent request into the same error code.
- **Renaming tables and columns**: plugins with their own tables accept a
  `schema?: InferOptionSchema<typeof schema>` option and apply it with
  `mergeSchema(structuredClone(schema), options.schema)` from
  `better-auth/db`, like the `username` plugin. `mergeSchema` changes the
  object it gets, hence the copy.
- **Caching**: data read on hot paths (every sign-up, every keystroke of
  an availability check) is cached with a short TTL and cleared by the
  plugin's own write endpoints. Make the TTL an option; `0` disables it.

### Endpoints

- `createAuthEndpoint(path, { method, body?, query?, use?, metadata? }, handler)`
  from `better-auth/api`. Paths are `/<plugin>/<verb>-<noun>` in kebab
  case (`/blocklist/create-rule`), POST for mutations (ids go in the body,
  not the path), GET for reads. Add `metadata.openapi.description`.
- Validate input with Zod (`import * as z from "zod"`, a `catalog:`
  dependency), with lengths capped where the database needs it.
- **Requiring a session**: use `sessionMiddleware` from `better-auth/api`
  in `use: [...]`, then read `ctx.context.session` in the handler. Don't
  call `ctx.context.getSession`; it doesn't exist. The standalone helper
  is `getSessionFromCtx` from `better-auth/api`.
- **Admin-only endpoints**: check the admin plugin's comma-separated
  `role` field against an `adminRoles` option (default `["admin"]`) plus
  an `adminUserIds` option, and answer everyone else with `403`.

### Hooks

- `hooks.before` / `hooks.after` entries are
  `{ matcher: (context: HookEndpointContext) => boolean, handler: AuthMiddleware }`.
  `HookEndpointContext.path` is `string | undefined`; guard with
  `!!context.path`, and look paths up with `Object.hasOwn(map, path)`,
  not `path in map`. Import `HookEndpointContext` from `@better-auth/core`.
- Path hooks only see the endpoints they name. To guard every user
  creation or update (OAuth, magic link, admin, ...), return
  `databaseHooks` from the plugin's `init(ctx)`, like the `username`
  plugin does.
- `user.update.before` receives the changed fields but no user id, and
  better-auth sometimes writes unchanged values back (an OAuth sign-in
  with `overrideUserInfoOnSignIn` rewrites the email). Only check values
  that really change; for unique fields, "a user already has this value"
  means unchanged.
- Inside `databaseHooks`, read through
  `await getCurrentAdapter(ctx.adapter)` from `@better-auth/core/context`,
  not the plain adapter. The user is created inside a transaction, and on
  SQLite a read outside it waits for that transaction forever.
- **Not `user.validateUserInfo`**: better-auth 1.7 has an app-level
  `user.validateUserInfo` callback. Plugins shouldn't use it: it is a
  single option (a plugin would override the app's own), it only runs on
  user creation, and it rejects with a generic `403`.

### Dependencies and build

- `better-auth` and `@better-auth/core` are `catalog:` peer dependencies
  (and `catalog:` dev dependencies) in every plugin package, never
  bundled.
  Shared versions (`better-auth`, `@better-auth/core`, `typescript`,
  `vitest`, `@types/node`, `zod`) live in the pnpm catalog in
  `pnpm-workspace.yaml`; add a dependency there once two or more packages
  need it.
- `tsdown` (configured via `@repo/tooling/tsdown`) keeps everything in
  `dependencies`/`peerDependencies` external and, with `"type": "module"`
  and `platform: "neutral"`, emits `.js`/`.d.ts` (not `.mjs`/`.d.mts`).
  The `exports` map in each plugin's `package.json` points at those
  files. Verify this again if tsdown is upgraded.

### Shared helpers (`@repo/plugin-utils`)

Helpers that two or more plugins need live in `packages/plugin-utils`,
imported by subpath:

| Import                          | What                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@repo/plugin-utils/admin`      | `isAdmin(user, options)` and `resolveAdminOptions(options)`: the `adminRoles` / `adminUserIds` check (comma-separated roles of the admin plugin) |
| `@repo/plugin-utils/audit`      | `recordAuditEvent(event)`: records an event in the audit log plugin through `getPlugin("audit-log")`, if the app uses it                         |
| `@repo/plugin-utils/callbacks`  | `runCallback(ctx, pluginId, name, fn)`: runs a user callback via `runInBackgroundOrAwait`, logs its errors                                       |
| `@repo/plugin-utils/options`    | `createFail(pluginId)`: throws `[plugin] message` for invalid options                                                                            |
| `@repo/plugin-utils/pagination` | `paginationQuery({ defaultLimit, maxLimit })`: `limit` / `offset` query fields                                                                   |

How it works:

- **It is never built or published.** Its `exports` point at
  `src/*.ts`. Each plugin lists it as a `workspace:*` **dev dependency**,
  so tsdown, which keeps only `dependencies` and `peerDependencies`
  external, compiles it into the plugin's `dist`. Vitest and `tsc` read
  the TypeScript directly. Turborepo calls this a Just-in-Time package:
  it has `test` and `typecheck` tasks but no `build`, and a change to it
  still invalidates the cached builds of the plugins that import it.
- **Stateless only.** Every plugin bundles its own copy, so a module-level
  cache or counter would exist once per plugin. Pass state in instead.
- **Internal only.** Don't expose its types in a plugin's public API
  (options, endpoint results): declare public types in the plugin, so its
  `.d.ts` never needs `@repo/plugin-utils`. `pnpm check` runs publint and
  arethetypeswrong on every plugin; also check
  `grep -r "@repo/" packages/*/dist --include=*.js --include=*.d.ts`
  finds nothing after a build. (Source maps name the original files; that
  is fine.)
- **Add only what is shared.** A helper moves here once a second plugin
  needs the same code. Code that differs on purpose stays in the plugins,
  for example email normalization (the blocklist folds look-alike
  characters, the waitlist matches what better-auth stores).
- `better-auth`, `@better-auth/core`, and `zod` are its peer
  dependencies, like the plugins'; the plugins' own peer dependencies
  provide them.
- A change to it changes every plugin that bundles it: once changesets
  are in use, add one for each affected plugin.

## Testing

- Integration tests use `getTestInstance` from `better-auth/test`: a real
  auth instance on SQLite (Node's `node:sqlite`) with an HTTP-shaped
  client. Pass `{ disableTestUser: true }` as its second argument, or it
  signs up a default test user first.
- Add better-auth's `testUtils()` plugin to create users and session
  headers directly (`test.saveUser(test.createUser({ ... }))`,
  `test.getAuthHeaders({ userId })`) instead of signing up and in. Users
  still go through `internalAdapter.createUser`, so database hooks apply.
- Test through `auth.api.*` for server behavior, and through the client at
  least once per endpoint group, so `pathMethods` and inference are
  covered.
- Group tests by behavior (`email`, `rule endpoints`, ...), not by when
  they were written. Race conditions get a deterministic test (for
  example `vi.mock` that makes a pre-check miss, or a slowed-down
  adapter write so every request reads first), not `Promise.all` and
  hope.
- SQLite runs one statement at a time, so a race that depends on the
  database (a conditional update, a unique key, a transaction committing
  late) also runs on Postgres and MySQL: `pnpm test:db` runs the tests of
  the waitlist and referral plugins whose name contains "concurrent",
  "race", "out of order", or "at once", with `TEST_DATABASE` set.
  `getTestInstance` connects to fixed addresses; start them with
  `docker compose -f docker-compose.test.yml up -d --wait`, then run
  `TEST_DATABASE=postgres pnpm test:db` and `TEST_DATABASE=mysql pnpm test:db`.
  A new setup that should run there spreads `testDatabase()` from
  `@repo/tooling/test-helpers` into `getTestInstance`'s second argument.
- Maintenance scripts keep their logic in importable modules (the script
  itself runs on import) and are unit-tested; network access is replaced
  by fakes, such as the fake DNS resolver in `test/scripts.test.ts`.
- Each test creates its own instance; nothing is shared between tests.
- `test/official-plugins.test.ts` in each plugin covers better-auth's
  official plugins. Flows that take more than a call (Sign-In with
  Ethereum) have helpers in `@repo/tooling/test-helpers`; add one there
  instead of copying setup into a second plugin.

## Docs site

`apps/docs` is a Fumadocs site. Each plugin gets one page in
`content/docs/<plugin>.mdx`, listed in `content/docs/meta.json` and on
`content/docs/index.mdx`. A plugin with parts that stand on their own
(like the sign-in providers of `authentication`) gets a folder instead:
`content/docs/<plugin>/index.mdx` plus one page per part, with a
`meta.json` that lists the parts (not `index`). Follow the structure of
better-auth's own plugin pages: overview, Installation (`<Steps>`,
including the migration with `npx auth@latest migrate` / `generate` in
`<Tabs>`), Usage, plugin-specific sections, Schema (`<TypeTable>`), Error
codes, and Options (`<TypeTable>`). `Steps`, `Tabs`, `TypeTable`, and
`Callout` are available in MDX (`src/components/mdx.tsx`). The docs build
is part of `pnpm check`.

Two checks keep the docs in line with the code, both part of `pnpm check`:

- `pnpm check:docs` (`scripts/check-docs.mts`): every option of the
  plugin's options type (and of its nested `*Options` types) is in a
  `<TypeTable>` under `## Options`, and every documented option exists;
  each `Table: \`model\``table under`## Schema`lists exactly the
  fields of`schema.ts`; the `## Error codes`table lists exactly the
  codes of`error-codes.ts`, each with a status the code throws it with.
  A new plugin is added to `PLUGINS` in that script.
- The docs `typecheck` (`apps/docs/scripts/check-snippets.mts`)
  type-checks every TypeScript code sample against the real packages.
  Samples may use `auth`, `authClient`, the plugin functions, and the
  placeholders in `apps/docs/scripts/snippet-prelude.ts` without
  importing them; add a placeholder there when the prose explains a value
  (`token`, `sendEmail`, ...). Mark a fence ` ```ts no-check ` only for
  code that can't compile (pseudo-code).

## Playground

`apps/playground` (Next.js, port 3001) runs better-auth with every plugin
and the official plugins they work with, on a local SQLite file.

- Configuration lives in `src/lib/auth-options.ts`; tables, columns, and
  indexes are created automatically on startup and before the first
  request (`src/lib/migrate.ts`).
- `.env.example` lists the environment variables; both have working
  defaults for local development.
- `pnpm --filter playground reset-db` deletes the database. It refuses
  while the playground runs, because the server would keep the deleted
  file open.
- The rule pages need the `admin` role: the playground has a "Make me
  admin" button. That is a playground-only shortcut, never ship it.

## Git workflow

Trunk-based development: `main` plus short-lived feature branches.

- `main` is always releasable. Nobody commits to it directly once CI is on.
- Branch names carry a type prefix and a scope:
  `feat/blocklist-allowlist`, `fix/blocklist-regex-guard`,
  `docs/blocklist-page`, `chore/deps`. Keep branches to a day or two; for
  a big plugin, merge it in slices under `0.x` versions.
- Every change goes through a pull request and is **squash-merged**, so
  `main` has one commit per change. Use Conventional Commit style for PR
  titles (`feat(blocklist): add allow list`).
- Code style is Biome's (`biome.json`, line width 100); there is no
  ESLint or Prettier. Comments explain why, not what. Generated files
  (the two list files in `src/lists/`, `THIRD_PARTY_NOTICES.md`) are
  excluded from Biome.

### Changesets

- A PR that changes anything under `packages/*` (except `packages/tooling`)
  needs a changeset: run `pnpm changeset`. Docs-only, playground-only,
  tooling-only, and test-only PRs don't: tests aren't published, so
  `changedFilePatterns` in `.changeset/config.json` leaves out each
  package's `test/` folder. Don't add an empty or patch changeset for a
  test: it would release an unchanged package. `@repo/plugin-utils` itself gets no
  changeset (it is never published); describe the change in a changeset
  for each plugin that bundles it.
- While versions are `0.x`: `minor` for features and for breaking changes
  (say so in the changeset), `patch` for fixes and refreshed list data.
- Releases are not done by hand. Merging changesets to `main` makes the
  release workflow open (or update) a "Version Packages" PR; merging that
  PR publishes to npm and creates the tags and GitHub releases (see
  [CI and releases](#ci-and-releases)).
- Each plugin has a `CHANGELOG.md` (published with the package) that
  Changesets fills, newest version first. Don't edit it by hand: put the
  text in the changeset.

### Branch protection (GitHub settings, once CI is on)

- Require a pull request before merging; allow **squash merge only**.
- Require the `CI / ci`, `CI / database (postgres)`, and
  `CI / database (mysql)` status checks to pass. The `database` checks
  can only be selected once the job has run, for example on the pull
  request that adds them. Not `CI / changeset`: the "Version Packages"
  pull request removes the changesets and would fail it.
- Require branches to be up to date before merging.
- Block force pushes and deletion of `main`.
- If you work alone, skip the required-review rule but keep the checks.
  Once there are other contributors, turn on "Require review from Code
  Owners": `.github/CODEOWNERS` makes `@checodo` the owner of everything.

### CI and releases

`.github/workflows/ci.yml` runs on every push to `main` and every pull
request: the same steps as `pnpm check`, plus `pnpm smoke`. Its token can
only read the repository, and a run stops after 20 minutes. Its
`database` job runs `pnpm test:db` on Postgres and on MySQL, in parallel
with the rest.

Its `changeset` job fails a pull request that changes a published
package without a changeset. It runs while the repository variable
`CHANGESETS_ENABLED` is `"true"` (Settings > Secrets and variables >
Actions > Variables). It skips Dependabot's pull requests, which never
have a changeset, and the "Version Packages" pull request, which removes
them.

Other workflows:

- `audit.yml`: `pnpm audit` on every pull request, on `main`, and daily.
  GitHub's dependency graph can't read pnpm 12's lockfile yet, so
  Dependabot alerts see no dependencies; this covers known
  vulnerabilities until it can. Not a required check, so a new advisory
  doesn't block unrelated pull requests. Remove it once Insights >
  Dependency graph lists the dependencies.
- `scorecard.yml`: [OpenSSF Scorecard](https://scorecard.dev), a weekly
  check of the repository's security practices. Runs only once the
  repository is public.

Every action is pinned to a full commit SHA, with the version as a
comment (`uses: actions/checkout@<sha> # v4.4.0`): a tag can be moved to
other code, a SHA can't. Keep it that way for new workflows: once the
repository requires pinned actions (Settings > Actions > General), GitHub
refuses to run unpinned ones. A non-GitHub action also has to be added to
the allowed actions there, and an action in a subfolder counts as its own
action: `changesets/action@*` doesn't allow `changesets/action/version`.
Otherwise the whole workflow fails with "Startup failure" (it can't be
re-run; the next push or "Run workflow" starts it again). The list is:

```
pnpm/action-setup@*, ossf/scorecard-action@*, changesets/action/select-mode@*, changesets/action/version@*, changesets/action/pack@*, changesets/action/publish@*
```

`.github/dependabot.yml` proposes updates for the npm dependencies and
the actions once a week, only for versions at least 3 days old (pnpm
refuses versions younger than a day anyway, see
[Supply-chain settings](#supply-chain-settings)). Minor and patch updates
come grouped in one pull request; major updates one by one.

`.github/workflows/release.yml` versions and publishes, in jobs that
each get only the permissions they need:

- On every push to `main` it checks for pending changesets. If there are
  any, it opens or updates the "Version Packages" pull request. A small
  GitHub App creates it (its client ID and private key are in the `npm`
  environment), because a pull request opened with the workflow's own
  token gets no CI run, so the required `ci` check would never report.
- Merging that pull request publishes every package version that isn't on
  npm yet: one job builds and packs the tarballs without any secrets, the
  next publishes them in the `npm` environment with npm trusted publishing
  (no npm token, provenance included), then creates the git tags and
  GitHub releases. Each release gets the published tarball, a CycloneDX
  SBOM (`pnpm sbom`), and a Sigstore bundle with signed build provenance
  for both (also a GitHub attestation: `gh attestation verify <file>
  --repo checodo/better-auth-plugins`). Release jobs install dependencies
  without install scripts wherever nothing needs building. Then the docs
  are deployed (environment `docs`, a Vercel
  deploy hook), so the docs always show the latest published version.
- **Actions > Release > Run workflow** on `main` publishes a canary: each
  package with a pending changeset as `<next version>-canary-<datetime>`
  under the npm tag `canary` (`npm install <package>@canary`). No version
  commit, no tags, no changelog entry. `latest` stays unchanged.

Vercel doesn't deploy `main` by itself (`apps/docs/vercel.json`); pull
requests still get preview deployments. For a docs-only fix (a typo),
**Actions > Deploy docs > Run workflow** deploys the docs as they are on
`main`: use it only when `main` has no docs for unreleased features.

Never publish or deploy from a local machine (`npm publish`,
`pnpm publish`, `changeset publish`, `vercel`): that is the workflows'
job.

### First publish of a new package

npm can't attach a trusted publisher to a package that doesn't exist yet,
and the release workflow has no npm token. So a new package is created
once by the maintainer, without a token, through npm's staged publishing.
(The release workflow stops with an error pointing here if a package
isn't on npm yet.)

Locally, with Node 24 (`nvm use`: npm 11.15 or newer has `npm stage` and
`npm trust`), signed in with the maintainer's npm account (`npm login`,
2FA in the browser):

1. Create the package by staging a throwaway placeholder, in an empty
   folder outside the repository:

   ```bash
   d=$(mktemp -d) && cd "$d"
   printf '{"name":"%s","version":"0.0.1-bootstrap","license":"MIT"}\n' "@checodo/better-auth-<name>" > package.json
   npm stage publish --access public --tag bootstrap
   ```

   A prerelease version needs an explicit dist-tag (`--tag bootstrap`
   keeps it away from `latest`). npm creates the package with a public
   placeholder version `0.0.0-stage`; the staged version stays private.
   The package shows up on npm a few minutes later.
2. Add the trusted publisher (2FA in the browser):

   ```bash
   npm trust github @checodo/better-auth-<name> --file release.yml --repo checodo/better-auth-plugins --env npm --allow-publish --yes
   ```

   `npm trust list @checodo/better-auth-<name>` shows it ("publish, stage
   publish"). Then npmjs.com > the package > **Settings > Publishing
   access**: "Require two-factor authentication and disallow bypass 2fa
   tokens".
3. **Release within 2 days**: npm drops a trust setup that nothing has
   published through within 2 days. Merge the "Version Packages" pull
   request with the new package's first version soon after step 2. If
   it expired, run step 2 again.
4. After the first release: reject the staged placeholder
   (`npm stage list`, then `npm stage reject <stage-id>`, or **Staged
   Packages** on npmjs.com), deprecate npm's placeholder, then
   `npm logout`:

   ```bash
   npm deprecate @checodo/better-auth-<name>@0.0.0-stage "Placeholder from npm's package creation, not a release."
   ```

The real first version is published by the release workflow, with
provenance, like every later one.

### Git hooks

`lefthook.yml` runs on pre-commit: Biome on the staged files (fixes are
re-staged), and a frozen-lockfile check when a `package.json`,
`pnpm-lock.yaml`, or `pnpm-workspace.yaml` is staged. Humans can skip the
hooks once with `LEFTHOOK=0`; agents must not bypass them.

## Predefined lists

The list files in `packages/blocklist/src/lists/`
(`disposable-email-domains.ts`, `reserved-usernames.ts`) are generated;
don't edit them by hand. `src/lists/index.ts`, which re-exports them, is
written by hand. To refresh the lists from the upstream sources:

```bash
pnpm --filter @checodo/better-auth-blocklist lists:update
```

It needs `git` and network access, but no GitHub token, and takes a few
minutes. The script (`scripts/update-lists.ts`, logic in
`scripts/sources.ts` and `scripts/mail-dns.ts`):

- pins every source to the latest commit of its branch (`git ls-remote`)
  and checks that its license file is still the expected license;
- merges the sources, drops invalid entries, removes known legitimate
  mail services and everything in `scripts/never-block.ts`, then
  de-duplicates and sorts;
- drops public suffixes (`net.ua`, `msk.ru`, ...), checked against the
  Public Suffix List, because domain rules also match subdomains;
- checks every email domain in DNS and keeps only those that verifiably
  receive email (MX records, or A/AAAA records without MX). Domains that
  don't exist, publish a "null MX", or have no records are dropped, more
  than half of the merged list. Failed lookups get a second, slower pass;
  domains that still can't be confirmed are dropped too. More than 5%
  failures in the first pass abort the run;
- queries public DNS servers (Cloudflare and Google, or `DNS_SERVERS`),
  because local filters such as Pi-hole or NextDNS report disposable
  domains as non-existent;
- refuses an update whose merged sources, or whose final list, shrinks by
  more than 20% (`--allow-shrink` after checking why);
- regenerates the package's `THIRD_PARTY_NOTICES.md`, with every source
  whose data ships and every source only used to filter it.

`--skip-dns` skips the DNS check, for trying out script changes only;
don't commit its output.

Review the diff, run the tests (they check that the lists are sorted,
unique, free of public suffixes and of `never-block.ts` providers), then,
once changesets are in use, add a patch changeset. Only add sources whose license allows
redistribution (CC0, MIT, BSD); lists without a license are left out on
purpose. If a real provider shows up in a list, add it to
`never-block.ts`.

## When adding a new plugin

1. Copy `packages/blocklist`'s file structure as a starting point (see
   [Plugin structure](#plugin-structure)).
2. Set up `package.json`:
   - `name` (`@checodo/better-auth-<name>`), `version` `0.0.0`,
     `description`, `keywords`, `author`, `repository` (with
     `directory`), `homepage` (the plugin's docs page,
     `https://checodo-better-auth-plugins.vercel.app/docs/<name>`, also
     linked from the README's "Documentation" section; npm shows it as the
     package's homepage), `bugs`, and `license` (`MIT`, with a copy of the root
     `LICENSE.md` in the package folder; `pnpm smoke` checks it's there).
   - `"type": "module"`, `"sideEffects": false`, `files: ["dist"]`, and
     an `exports` map for `.`, `./client`, and `./package.json` pointing
     at the `.js`/`.d.ts` files in `dist/`.
   - Scripts `build` (`tsdown`), `dev` (`tsdown --watch --no-clean`),
     `test`, `test:watch`, `typecheck`, `clean`, and `lint:package`
     (publint + arethetypeswrong), so the root `turbo` tasks pick the
     package up.
   - `peerDependencies` and `devDependencies` on `better-auth` and
     `@better-auth/core`, both `catalog:`,
     `@repo/tooling` and `@repo/plugin-utils` as `workspace:*` dev
     dependencies (see
     [Shared helpers](#shared-helpers-repoplugin-utils)), and
     `publishConfig.access: "public"`.
3. Add `tsconfig.json` (extending `@repo/tooling/tsconfig/library.json`),
   `tsdown.config.ts` (`defineLibraryConfig` from `@repo/tooling/tsdown`),
   and `vitest.config.ts` (`defineLibraryTestConfig` from
   `@repo/tooling/vitest`). Copy `packages/blocklist/turbo.json` too: it
   makes the package's `dev` wait for its `build`, so the two never write
   `dist/` at the same time while an app imports it.
4. Write `types.ts`, `error-codes.ts`, `schema.ts` first, then
   `routes/`/`hooks/`, then `index.ts` and `client.ts`.
5. Add integration tests with `getTestInstance` plus unit tests for any
   pure helpers (see [Testing](#testing)).
6. Add a doc page (see [Docs site](#docs-site)), the plugin to `PLUGINS`
   in `scripts/check-docs.mts`, the package to the table in `README.md`,
   a package `README.md` like the others (npm shows it; its code
   samples and version line are checked too), and a `CHANGELOG.md` with
   only the `# <package name>` title (and `"CHANGELOG.md"` in `files`). Add the plugin to the
   "Works with" table on `combining-plugins.mdx`, with an
   `official-plugins.test.ts` that proves each row.
7. Add the plugin to `apps/playground` (server and client config, plus a
   page to try it).
8. Add a changeset (`pnpm changeset`, `minor`).
9. Run `pnpm check` before opening the PR.
10. Before the "Version Packages" PR that first releases it is merged,
    the maintainer creates the package on npm and gives it a trusted
    publisher (see [First publish of a new package](#first-publish-of-a-new-package)).
    Otherwise the release stops before publishing anything. Merge it
    within 2 days of adding the trusted publisher.
