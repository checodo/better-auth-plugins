import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";

export const emailNormalizationSchema = {
  user: {
    fields: {
      normalizedEmail: {
        type: "string",
        required: false,
        // One account per inbox: two forms of one address can't both sign up.
        unique: true,
        input: false,
        returned: false,
      },
    },
  },
} satisfies BetterAuthPluginDBSchema;

export type EmailNormalizationSchema = typeof emailNormalizationSchema;
