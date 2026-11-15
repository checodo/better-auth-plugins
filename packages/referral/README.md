# @checodo/better-auth-referral

Referral codes for [better-auth](https://better-auth.com): codes per user, attribution for every sign-up method, and steps such as a first purchase before a referral earns a reward.

A community plugin, not made by the better-auth team. It looks and works
like better-auth's own plugins: a server plugin, a typed client plugin,
error codes, and database tables.

## Install

```bash
npm install @checodo/better-auth-referral
```

Requires `better-auth` and `@better-auth/core` 1.7.20 or a later 1.x
release (peer dependencies). ESM only.

## Usage

```ts
// auth.ts
import { betterAuth } from "better-auth";
import { referral } from "@checodo/better-auth-referral";

export const auth = betterAuth({
  plugins: [
    referral({
      steps: ["email-verified"],
      onReferralCompleted: async ({ referrerUserId }) => {
        // reward the referrer
      },
    }),
  ],
});
```

```ts
// auth-client.ts
import { createAuthClient } from "better-auth/client";
import { referralClient } from "@checodo/better-auth-referral/client";

export const authClient = createAuthClient({ plugins: [referralClient()] });
```

Create the plugin's tables with the better-auth CLI:

```bash
npx auth@latest migrate
```

## Documentation

Every option, endpoint, error code, and table:
[docs](https://github.com/checodo/better-auth-plugins/blob/main/apps/docs/content/docs/referral.mdx).
