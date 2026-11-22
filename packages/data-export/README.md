# @checodo/better-auth-data-export

Data access requests for [better-auth](https://better-auth.com): every signed-in user downloads what you store about them as one JSON file (GDPR Art. 15 and 20), with passwords, tokens, and other secrets left out.

A community plugin, not made by the better-auth team. It looks and works
like better-auth's own plugins: a server plugin, a typed client plugin,
and error codes.

## Install

```bash
npm install @checodo/better-auth-data-export
```

Requires `better-auth` and `@better-auth/core` 1.7.20 or a later 1.x
release (peer dependencies). ESM only.

## Usage

```ts
// auth.ts
import { betterAuth } from "better-auth";
import { dataExport } from "@checodo/better-auth-data-export";

export const auth = betterAuth({
  plugins: [
    dataExport({
      // your own data outside better-auth's schema, under `app`
      contributors: { orders: (user) => db.order.findMany({ where: { userId: user.id } }) },
    }),
  ],
});
```

```ts
// auth-client.ts
import { createAuthClient } from "better-auth/client";
import { dataExportClient } from "@checodo/better-auth-data-export/client";

export const authClient = createAuthClient({ plugins: [dataExportClient()] });

const { data } = await authClient.dataExport.download();
```

It finds the data through better-auth's schema (every model that
references the user, the app's own included), and the audit log and
waitlist add theirs. Requests by email: `auth.api.exportUserData({ body: { userId } })` on the server.

## Documentation

The file's format, what is left out, admin exports, limits, options, and
error codes: [docs](https://checodo-better-auth-plugins.vercel.app/docs/data-export).
