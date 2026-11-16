import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";

/**
 * Rules managed at runtime through the rule endpoints. They are applied on
 * top of the static rules from the plugin options.
 */
export const blocklistSchema = {
  blocklistRule: {
    fields: {
      /** "email" | "username" | "organization" | "team" | "password" | "ip" */
      target: {
        type: "string",
        required: true,
        index: true,
      },
      /** "exact" | "domain" | "prefix" | "suffix" | "contains" | "regex" | "cidr" | "country" */
      type: {
        type: "string",
        required: true,
      },
      value: {
        type: "string",
        required: true,
      },
      reason: {
        type: "string",
        required: false,
      },
      createdAt: {
        type: "date",
        required: true,
      },
    },
    // One rule per target, type, and value, enforced by the database too.
    indexes: [{ fields: ["target", "type", "value"], unique: true }],
  },
} satisfies BetterAuthPluginDBSchema;

export type BlocklistSchema = typeof blocklistSchema;
