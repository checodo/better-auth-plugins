# @checodo/better-auth-audit-log

An audit log for [better-auth](https://better-auth.com): sign-ins, failed sign-ins, account changes, admin and organization actions, with retention and an optional hash chain.

A community plugin, not made by the better-auth team. It looks and works
like better-auth's own plugins: a server plugin, a typed client plugin,
error codes, and database tables.

## Install

```bash
npm install @checodo/better-auth-audit-log
```

Requires `better-auth` and `@better-auth/core` 1.7.20 or a later 1.x
release (peer dependencies). ESM only.

## Usage

```ts
// auth.ts
import { betterAuth } from "better-auth";
import { auditLog } from "@checodo/better-auth-audit-log";

export const auth = betterAuth({
  plugins: [
    // last, after the other plugins
    auditLog({ retention: { days: 180 } }),
  ],
});
```

```ts
// auth-client.ts
import { createAuthClient } from "better-auth/client";
import { auditLogClient } from "@checodo/better-auth-audit-log/client";

export const authClient = createAuthClient({ plugins: [auditLogClient()] });
```

Create the plugin's tables with the better-auth CLI:

```bash
npx auth@latest migrate
```

## Documentation

Every option, endpoint, error code, and table:
[docs](https://checodo-better-auth-plugins.vercel.app/docs/audit-log).
