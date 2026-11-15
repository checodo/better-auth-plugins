# @checodo/better-auth-authentication

Sign in with Steam, Epic Games, and Xbox in [better-auth](https://better-auth.com), through `signIn.social` like any built-in social provider.

A community plugin, not made by the better-auth team. It looks and works
like better-auth's own plugins: a server plugin, a typed client plugin,
error codes.

## Install

```bash
npm install @checodo/better-auth-authentication
```

Requires `better-auth` and `@better-auth/core` 1.7.20 or a later 1.x
release (peer dependencies). ESM only.

## Usage

```ts
// auth.ts
import { betterAuth } from "better-auth";
import { authentication } from "@checodo/better-auth-authentication";

export const auth = betterAuth({
  plugins: [
    authentication({
      steam: { apiKey: process.env.STEAM_API_KEY },
    }),
  ],
});
```

```ts
// auth-client.ts
import { createAuthClient } from "better-auth/client";
import { authenticationClient } from "@checodo/better-auth-authentication/client";

export const authClient = createAuthClient({ plugins: [authenticationClient()] });
```

## Documentation

Every option, endpoint, error code, and table:
[docs](https://checodo-better-auth-plugins.vercel.app/docs/authentication).
