import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";

export const referralSchema = {
  /** One code per user. */
  referralCode: {
    fields: {
      userId: {
        type: "string",
        required: true,
        references: { model: "user", field: "id", onDelete: "cascade" },
      },
      /** Uppercase. */
      code: {
        type: "string",
        required: true,
      },
      createdAt: {
        type: "date",
        required: true,
      },
    },
    indexes: [
      { fields: ["userId"], unique: true },
      { fields: ["code"], unique: true },
    ],
  },
  /** Who referred whom. A user is referred at most once. */
  referral: {
    fields: {
      referrerUserId: {
        type: "string",
        required: true,
        index: true,
        references: { model: "user", field: "id", onDelete: "cascade" },
      },
      referredUserId: {
        type: "string",
        required: true,
        references: { model: "user", field: "id", onDelete: "cascade" },
      },
      /** The code used at sign-up, kept even if the code changes. */
      code: {
        type: "string",
        required: true,
      },
      /** "pending" | "completed" */
      status: {
        type: "string",
        required: true,
        index: true,
      },
      completedAt: {
        type: "date",
        required: false,
      },
      createdAt: {
        type: "date",
        required: true,
      },
    },
    indexes: [{ fields: ["referredUserId"], unique: true }],
  },
  /** Steps a referred user has completed. Each step counts once. */
  referralStep: {
    fields: {
      referralId: {
        type: "string",
        required: true,
        references: { model: "referral", field: "id", onDelete: "cascade" },
      },
      step: {
        type: "string",
        required: true,
      },
      /** JSON-encoded. */
      metadata: {
        type: "string",
        required: false,
      },
      completedAt: {
        type: "date",
        required: true,
      },
    },
    indexes: [{ fields: ["referralId", "step"], unique: true }],
  },
} satisfies BetterAuthPluginDBSchema;

export type ReferralSchema = typeof referralSchema;
