import type { InferOptionSchema } from "better-auth";
import type { AuditLogSchema } from "./schema";

export type AuditEventStatus = "success" | "failure";
export type AuditEventSeverity = "low" | "medium" | "high" | "critical";

/** Actions of better-auth's `admin` plugin the log records, as `admin.<action>`. */
export type AdminAuditAction =
  | "create-user"
  | "update-user"
  | "set-role"
  | "set-user-password"
  | "ban-user"
  | "unban-user"
  | "impersonate-user"
  | "stop-impersonating"
  | "revoke-user-session"
  | "revoke-user-sessions"
  | "remove-user";

/** The events the plugin records by itself. */
export type BuiltInAuditEventType =
  | "sign-up"
  | "sign-in"
  | "sign-out"
  | "session-revoked"
  | "user-deleted"
  | "password-changed"
  | "password-reset"
  | "email-changed"
  | "email-verified"
  | "account-linked"
  | "account-unlinked"
  | `admin.${AdminAuditAction}`;

/** A built-in event type, or one of your own (`auth.api.recordAuditEvent`, `paths`). */
export type AuditEventType = BuiltInAuditEventType | (string & {});

/** An event as stored and returned by the plugin. */
export interface AuditEvent {
  id: string;
  type: AuditEventType;
  status: AuditEventStatus;
  severity: AuditEventSeverity;
  /** The user the event is about. */
  userId: string | null;
  /** The user who did it: the user themselves, an admin, or `null` (e.g. a failed sign-in). */
  actorUserId: string | null;
  sessionId: string | null;
  organizationId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  /** The error code of a failed request, e.g. `INVALID_EMAIL_OR_PASSWORD`. */
  errorCode: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/** An event before it is stored: what `beforeLog` sees and may change. */
export type AuditEventInput = Omit<AuditEvent, "id">;

/** Filters for reading events. */
export interface AuditEventQuery {
  userId?: string | undefined;
  actorUserId?: string | undefined;
  type?: string | undefined;
  status?: AuditEventStatus | undefined;
  /** Events at or after this time. */
  from?: Date | undefined;
  /** Events before this time. */
  to?: Date | undefined;
  limit: number;
  offset: number;
}

/**
 * Where events are kept. The default stores them in the plugin's
 * `auditEvent` table through better-auth's database adapter;
 * `memoryStorage()` keeps them in memory (tests, demos).
 */
export interface AuditLogStorage {
  write: (event: AuditEventInput) => Promise<AuditEvent>;
  /** Newest first, with the total number of matching events. */
  read: (query: AuditEventQuery) => Promise<{ events: AuditEvent[]; total: number }>;
  /** Deletes events created before `date`; returns how many. */
  deleteOlderThan: (date: Date) => Promise<number>;
}

export interface AuditLogRetention {
  /** Delete events older than this many days. */
  days: number;
  /**
   * At most one sweep per this many seconds, started in the background by
   * a recorded event. Defaults to `3600`. Use `auth.api.deleteExpiredAuditEvents`
   * from a cron job instead, or as well.
   */
  sweepInterval?: number | undefined;
}

export interface AuditLogOptions {
  /**
   * Which event types to record. A pattern ending in `.*` matches a group,
   * e.g. `["sign-in", "admin.*"]`. Defaults to every event.
   */
  events?: readonly string[] | undefined;
  /**
   * Extra endpoints to record, by path, with the event type to use, e.g.
   * `{ "/organization/delete": "organization.deleted" }`. The signed-in
   * user is the event's user and actor.
   */
  paths?: Readonly<Record<string, string>> | undefined;
  /** Severity per event type, overriding the built-in one. */
  severity?: Readonly<Record<string, AuditEventSeverity>> | undefined;
  /** Store the client's IP address (better-auth's `advanced.ipAddress` rules). Defaults to `true`. */
  captureIp?: boolean | undefined;
  /** Store the client's `User-Agent` header. Defaults to `true`. */
  captureUserAgent?: boolean | undefined;
  /**
   * Changes or drops an event before it is stored, e.g. to pseudonymize
   * IP addresses. Return the event to keep, `null` to drop it. If it
   * throws, the event is dropped and the error logged.
   */
  beforeLog?:
    | ((event: AuditEventInput) => AuditEventInput | null | Promise<AuditEventInput | null>)
    | undefined;
  /** Called with every stored event, e.g. to forward it to a SIEM. Errors are logged. */
  onEvent?: ((event: AuditEvent) => void | Promise<void>) | undefined;
  /** Where to keep events. Defaults to the plugin's `auditEvent` table. */
  storage?: AuditLogStorage | undefined;
  /** Delete old events automatically. Off by default: events are kept forever. */
  retention?: AuditLogRetention | undefined;
  /**
   * Chain events with keyed hashes, so changed or deleted events can be
   * detected with `auth.api.verifyAuditChain`. Adds the `auditChain` table;
   * needs the default database storage. `true` uses better-auth's secret;
   * pass `{ secret }` to use a key of its own (at least 32 characters).
   * Off by default.
   */
  hashChain?: boolean | { secret?: string | undefined } | undefined;
  /**
   * Users with one of these roles (the `role` field of better-auth's
   * `admin` plugin) may list every user's events. Defaults to `["admin"]`.
   */
  adminRoles?: readonly string[] | undefined;
  /** Users with these ids may list every user's events, whatever their role. */
  adminUserIds?: readonly string[] | undefined;
  /**
   * Rename the plugin's table or its columns, like better-auth's own
   * plugins: `{ auditEvent: { modelName: "audit_events" } }`.
   */
  schema?: InferOptionSchema<AuditLogSchema> | undefined;
}

export interface ResolvedAuditLogOptions {
  /** `null`: every event. */
  events: ((type: string) => boolean) | null;
  paths: Readonly<Record<string, string>>;
  severity: Readonly<Record<string, AuditEventSeverity>>;
  captureIp: boolean;
  captureUserAgent: boolean;
  beforeLog: AuditLogOptions["beforeLog"];
  onEvent: AuditLogOptions["onEvent"];
  storage: AuditLogStorage | undefined;
  retention: { days: number; sweepInterval: number } | undefined;
  /** `null`: off. */
  hashChain: { secret: string | undefined } | null;
  adminRoles: readonly string[];
  adminUserIds: readonly string[];
}
