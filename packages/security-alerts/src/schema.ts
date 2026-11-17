import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";

/** Devices users signed in from, to tell a sign-in from a new device. */
export const securityAlertsSchema = {
  knownDevice: {
    fields: {
      userId: {
        type: "string",
        required: true,
        references: { model: "user", field: "id", onDelete: "cascade" },
        index: true,
      },
      /**
       * HMAC-SHA256 (keyed with the auth secret) of the browser family, OS
       * family, and, with `newDevice.includeIp`, the coarse IP address.
       */
      fingerprint: {
        type: "string",
        required: true,
      },
      /** For people, e.g. "Chrome on macOS". */
      label: {
        type: "string",
        required: true,
      },
      /** The last sign-in from this device. */
      lastSeenAt: {
        type: "date",
        required: true,
      },
      /** After this, a sign-in from the device alerts again (see `newDevice.expiresIn`). */
      expiresAt: {
        type: "date",
        required: true,
      },
      createdAt: {
        type: "date",
        required: true,
      },
    },
    // One row per user and device, enforced by the database too.
    indexes: [{ fields: ["userId", "fingerprint"], unique: true }],
  },
} satisfies BetterAuthPluginDBSchema;

export type SecurityAlertsSchema = typeof securityAlertsSchema;
