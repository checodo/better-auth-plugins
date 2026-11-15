import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";

export const auditLogSchema = {
  /**
   * One row per event. User ids are plain columns, not foreign keys: the
   * log must outlive the users it mentions, `user-deleted` included.
   */
  auditEvent: {
    fields: {
      /** `sign-in`, `admin.ban-user`, or an app-defined type. */
      type: {
        type: "string",
        required: true,
        index: true,
      },
      /** "success" | "failure" */
      status: {
        type: "string",
        required: true,
      },
      /** "low" | "medium" | "high" | "critical" */
      severity: {
        type: "string",
        required: true,
      },
      /** The user the event is about. */
      userId: {
        type: "string",
        required: false,
        index: true,
      },
      /** The user who did it: the user themselves, or an admin. */
      actorUserId: {
        type: "string",
        required: false,
        index: true,
      },
      sessionId: {
        type: "string",
        required: false,
      },
      /** The session's active organization (organization plugin). */
      organizationId: {
        type: "string",
        required: false,
      },
      ipAddress: {
        type: "string",
        required: false,
      },
      userAgent: {
        type: "string",
        required: false,
      },
      /** The error code of a failed request, e.g. `INVALID_EMAIL_OR_PASSWORD`. */
      errorCode: {
        type: "string",
        required: false,
      },
      /** JSON-encoded. */
      metadata: {
        type: "string",
        required: false,
      },
      createdAt: {
        type: "date",
        required: true,
        index: true,
      },
    },
  },
} satisfies BetterAuthPluginDBSchema;

/** Added with the `hashChain` option: one link per event, in order. */
export const auditChainSchema = {
  auditChain: {
    fields: {
      /** 1, 2, 3, ... Unique, so concurrent writers can't fork the chain. */
      sequence: {
        type: "number",
        required: true,
      },
      /** The event's id. Not a foreign key: a deleted event must show as missing. */
      eventId: {
        type: "string",
        required: true,
      },
      previousHash: {
        type: "string",
        required: true,
      },
      /** HMAC-SHA256 of the event, the sequence number, and `previousHash`. */
      hash: {
        type: "string",
        required: true,
      },
      /** The event's `createdAt`, for retention. */
      createdAt: {
        type: "date",
        required: true,
        index: true,
      },
    },
    indexes: [{ fields: ["sequence"], unique: true }],
  },
} satisfies BetterAuthPluginDBSchema;

export type AuditLogSchema = typeof auditLogSchema & Partial<typeof auditChainSchema>;
