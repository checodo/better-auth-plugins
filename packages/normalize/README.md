# @checodo/better-auth-normalize

Email and phone number normalization for [better-auth](https://better-auth.com): one account per inbox (`a.da+news@gmail.com` is `ada@gmail.com`), and phone numbers stored in E.164.

A community plugin, not made by the better-auth team. It looks and works
like better-auth's own plugins: server plugins, a typed client plugin,
error codes, and a database field.

## Install

```bash
npm install @checodo/better-auth-normalize
```

Requires `better-auth` and `@better-auth/core` 1.7.20 or a later 1.x
release (peer dependencies). ESM only.

## Usage

```ts
// auth.ts
import { betterAuth } from "better-auth";
import { emailNormalization } from "@checodo/better-auth-normalize/email";
import { phoneNormalization } from "@checodo/better-auth-normalize/phone";

export const auth = betterAuth({
  plugins: [
    // one account per inbox; optionally sign in with any form of the address
    emailNormalization({ allowNormalizedSignIn: true }),
    // with better-auth's phoneNumber plugin: numbers stored in E.164
    phoneNormalization({ defaultCountry: "DE" }),
  ],
});
```

```ts
// auth-client.ts
import { createAuthClient } from "better-auth/client";
import { normalizeClient } from "@checodo/better-auth-normalize/client";

export const authClient = createAuthClient({ plugins: [normalizeClient()] });
```

Add the `normalizedEmail` field with the better-auth CLI, then fill it
for existing users with `auth.api.backfillNormalizedEmails`:

```bash
npx auth@latest migrate
```

## Documentation

The email rules, phone normalization, options, and error
codes: [docs](https://checodo-better-auth-plugins.vercel.app/docs/normalize).
