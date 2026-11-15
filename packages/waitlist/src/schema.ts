import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";

/** One row per email that joined the waitlist or was invited directly. */
export const waitlistSchema = {
  waitlistEntry: {
    fields: {
      /** Trimmed and lowercased, like better-auth's user emails. */
      email: {
        type: "string",
        required: true,
      },
      /** "unconfirmed" | "pending" | "approved" | "rejected" | "registered" */
      status: {
        type: "string",
        required: true,
        index: true,
      },
      /** SHA-256 hash of the secret in the links sent to the email (confirm, status, leave). */
      tokenHash: {
        type: "string",
        required: true,
      },
      /** Confirmation emails sent so far; resends are limited. */
      confirmationsSent: {
        type: "number",
        required: true,
        defaultValue: 0,
      },
      /** SHA-256 hash of the invite code, while the entry is approved. */
      inviteCodeHash: {
        type: "string",
        required: false,
        index: true,
      },
      inviteExpiresAt: {
        type: "date",
        required: false,
      },
      /** JSON-encoded, from `/waitlist/join`. */
      metadata: {
        type: "string",
        required: false,
      },
      /** Not a foreign key: the entry outlives the admin's account. */
      approvedBy: {
        type: "string",
        required: false,
      },
      approvedAt: {
        type: "date",
        required: false,
      },
      registeredAt: {
        type: "date",
        required: false,
      },
      createdAt: {
        type: "date",
        required: true,
      },
      updatedAt: {
        type: "date",
        required: true,
      },
    },
    // One entry per email and token, enforced by the database too.
    indexes: [
      { fields: ["email"], unique: true },
      { fields: ["tokenHash"], unique: true },
    ],
  },
} satisfies BetterAuthPluginDBSchema;

export type WaitlistSchema = typeof waitlistSchema;
