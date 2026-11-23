# @checodo/better-auth-blocklist

Block disallowed emails, usernames, organization and team names, passwords, and IP addresses in [better-auth](https://better-auth.com): disposable email domains, reserved usernames, passwords that contain the user's email or username, IP ranges and countries, your own rules, and rules admins manage at runtime.

A community plugin, not made by the better-auth team. It looks and works
like better-auth's own plugins: a server plugin, a typed client plugin,
error codes, and database tables.

## Install

```bash
npm install @checodo/better-auth-blocklist
```

Requires `better-auth` and `@better-auth/core` 1.7.27 or a later 1.x
release (peer dependencies). ESM only.

## Usage

```ts
// auth.ts
import { betterAuth } from "better-auth";
import { blocklist } from "@checodo/better-auth-blocklist";
import { disposableEmailDomains, reservedUsernames } from "@checodo/better-auth-blocklist/lists";

export const auth = betterAuth({
  plugins: [
    blocklist({
      email: { domains: disposableEmailDomains },
      username: { values: reservedUsernames },
    }),
  ],
});
```

```ts
// auth-client.ts
import { createAuthClient } from "better-auth/client";
import { blocklistClient } from "@checodo/better-auth-blocklist/client";

export const authClient = createAuthClient({ plugins: [blocklistClient()] });
```

Create the plugin's tables with the better-auth CLI:

```bash
npx auth@latest migrate
```

## Documentation

Every option, endpoint, error code, and table:
[docs](https://checodo-better-auth-plugins.vercel.app/docs/blocklist).
