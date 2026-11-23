# @checodo/better-auth-waitlist

Gate sign-up behind a waitlist in [better-auth](https://better-auth.com): double opt-in, admin approval, invite codes, and a gate that covers every sign-up method.

A community plugin, not made by the better-auth team. It looks and works
like better-auth's own plugins: a server plugin, a typed client plugin,
error codes, and database tables.

## Install

```bash
npm install @checodo/better-auth-waitlist
```

Requires `better-auth` and `@better-auth/core` 1.7.27 or a later 1.x
release (peer dependencies). ESM only.

## Usage

```ts
// auth.ts
import { betterAuth } from "better-auth";
import { waitlist } from "@checodo/better-auth-waitlist";

export const auth = betterAuth({
  plugins: [
    waitlist({
      sendConfirmationEmail: async ({ email, token }) => {
        // email a link to your confirm page with the token
      },
      sendInvite: async ({ email, inviteCode }) => {
        // email the invite code once an admin approves the entry
      },
    }),
  ],
});
```

```ts
// auth-client.ts
import { createAuthClient } from "better-auth/client";
import { waitlistClient } from "@checodo/better-auth-waitlist/client";

export const authClient = createAuthClient({ plugins: [waitlistClient()] });
```

Create the plugin's tables with the better-auth CLI:

```bash
npx auth@latest migrate
```

## Documentation

Every option, endpoint, error code, and table:
[docs](https://checodo-better-auth-plugins.vercel.app/docs/waitlist).
