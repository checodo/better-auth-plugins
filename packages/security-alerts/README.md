# @checodo/better-auth-security-alerts

Tell users about security-relevant changes to their account in [better-auth](https://better-auth.com): sign-ins from new devices, password and email changes, password resets, passkeys, two-factor turned off, linked accounts, and API keys, with a "This wasn't me" link that signs out every session and blocks the password.

A community plugin, not made by the better-auth team. It looks and works
like better-auth's own plugins: a server plugin, a typed client plugin,
error codes, and database tables.

## Install

```bash
npm install @checodo/better-auth-security-alerts
```

Requires `better-auth` and `@better-auth/core` 1.7.20 or a later 1.x
release (peer dependencies). ESM only.

## Usage

```ts
// auth.ts
import { betterAuth } from "better-auth";
import { securityAlerts } from "@checodo/better-auth-security-alerts";

export const auth = betterAuth({
  plugins: [
    securityAlerts({
      sendAlert: async ({ type, email, details, secureAccountUrl }) => {
        // email the alert to `email`, with the "This wasn't me" link
      },
      secureAccount: {
        callbackURL: "/secure-account",
        resetPasswordURL: "/reset-password",
      },
    }),
  ],
});
```

```ts
// auth-client.ts
import { createAuthClient } from "better-auth/client";
import { securityAlertsClient } from "@checodo/better-auth-security-alerts/client";

export const authClient = createAuthClient({ plugins: [securityAlertsClient()] });
```

Create the plugin's tables with the better-auth CLI:

```bash
npx auth@latest migrate
```

## Documentation

Every alert type, option, endpoint, error code, and table:
[docs](https://checodo-better-auth-plugins.vercel.app/docs/security-alerts).
