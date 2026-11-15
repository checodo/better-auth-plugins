<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": true` in the root `turbo.json` or `turbo.jsonc` to opt in; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# AGENTS.md

## What this is

`better-auth-plugins` is a pnpm/Turborepo monorepo of community plugins for
[better-auth](https://better-auth.com), to be published under the `@checodo`
npm scope, plus a Fumadocs documentation site. See [README.md](./README.md) for
the current list of plugins and what is planned.

## Goal

Every plugin should look and feel like it could ship inside better-auth
itself: same shape, same conventions, same developer experience as the
official plugins (`username`, `organization`, `admin`, ...).

## Layout

- `apps/docs`: Fumadocs site, one page per plugin.
- `apps/playground`: private Next.js + better-auth app (SQLite) to try
  every plugin by hand.
- `packages/<plugin>`: one published package per plugin
  (`@checodo/better-auth-<name>`). Each has a server plugin, a client plugin,
  typed options, error codes, schema, tests. The `blocklist` package is
  the reference to copy from.
- `packages/tooling`: private shared tsconfig, tsdown and vitest config.
- `packages/plugin-utils`: private `@repo/plugin-utils`, stateless helpers
  shared by the plugins (admin check, audit-log events, user callbacks,
  option errors, pagination). Never published and never built on its own:
  each plugin lists it as a **dev dependency** and tsdown compiles it into
  the plugin's `dist` (a "Just-in-Time" package in Turborepo's terms).

## Principles

- Follow better-auth's own patterns over inventing new ones. When unsure,
  check the installed `better-auth` / `@better-auth/core` type declarations;
  the docs site can lag behind the code.
- Plugins are small, opt-in, and typed end to end (server and client).
- Every plugin ships with tests and a docs page.
- Runtime: Node 24 (`.nvmrc`), pnpm 12 (pinned in `packageManager`).
- Tooling: Biome 2 (lint + format), Lefthook (pre-commit), Vitest, tsdown,
  Changesets, publint and arethetypeswrong (package checks). Do not add
  ESLint or Prettier.
- Work happens on short-lived branches, squash-merged to `main`.
- Every PR that changes a published package needs a changeset
  (`pnpm changeset`, see CONTRIBUTING.md#changesets).

## Where to look

- [CONTRIBUTING.md](./CONTRIBUTING.md): commands, plugin structure,
  better-auth API conventions, git and release workflow, how to add a plugin.
- `packages/blocklist`: the reference implementation.
- `.github/`: CI, the release workflow (`release.yml`), and the docs deploy.

## Rules for agents

- Run `pnpm check` (versions, lint, typecheck, test, build, package
  checks) before finishing. Also run `pnpm smoke` after changing a
  `package.json`, `exports`, the build config, or imports between
  packages.
- Never publish to npm or deploy the docs from a local machine
  (`npm publish`, `pnpm publish`, `changeset publish`, `vercel`); releases
  go through `.github/workflows/release.yml` only.
- Do not bypass the Lefthook pre-commit hooks.
- Before writing a helper a second plugin already has, use or extend
  `@repo/plugin-utils` instead of copying it (see
  CONTRIBUTING.md#shared-helpers-repoplugin-utils). Only stateless code
  goes there: every plugin bundles its own copy, so module-level state
  would not be shared.
- Never add `@repo/plugin-utils` to a plugin's `dependencies` (it would be
  installed for users and fail: it isn't published), and never expose its
  types in a plugin's public API. Published `dist/` files must not import
  `@repo/` (`grep -r "@repo/" packages/*/dist --include=*.js --include=*.d.ts`
  finds nothing).
