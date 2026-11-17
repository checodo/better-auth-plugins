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
 *
 * Only `write` is required: a write-only storage (a log service that
 * can't be queried) works, but then the list endpoint answers
 * `READ_NOT_SUPPORTED`, and `retention` needs `deleteOlderThan`.
 */
export interface AuditLogStorage {
  write: (event: AuditEventInput) => Promise<AuditEvent>;
  /** Newest first, with the total number of matching events. */
  read?: ((query: AuditEventQuery) => Promise<{ events: AuditEvent[]; total: number }>) | undefined;
  /** Deletes events created before `date`; returns how many. */
  deleteOlderThan?: ((date: Date) => Promise<number>) | undefined;
}

/** What a destination's `send` gets besides the events. */
export interface AuditLogDestinationContext {
  /** Aborted when the destination's `timeout` is reached. */
  signal: AbortSignal;
}

/** How a destination groups events before `send`. */
export interface AuditLogDestinationBatch {
  /** Most events per `send`, 1 to 1000. Defaults to `1`. */
  size?: number | undefined;
  /**
   * Milliseconds an event may wait for more to join its batch, 0 to
   * 60000. Defaults to `0` with `size: 1`, else `1000`.
   */
  wait?: number | undefined;
}

/**
 * A place every stored event is also sent to, besides `storage`: a SIEM,
 * a log service, a webhook. Sent in the background, best effort: a
 * failing or slow destination never fails the request, and events still
 * waiting in a batch are lost if the process stops before
 * `auth.api.flushAuditDestinations()`.
 */
export interface AuditLogDestination<T = AuditEvent> {
  /** Names the destination in logged errors. Unique. */
  name: string;
  /** Which event types to send, like the plugin's `events`. Defaults to every recorded event. */
  events?: readonly string[] | undefined;
  /**
   * Converts an event for this destination (ECS, OpenTelemetry, a CSV
   * row...). Return `null` to skip it here. If it throws, the event is
   * skipped for this destination and the error logged.
   */
  transform?: ((event: AuditEvent) => T | null | Promise<T | null>) | undefined;
  /** Delivers a batch, always an array. Throw (or reject) on failure: the error is logged. */
  send: (batch: T[], context: AuditLogDestinationContext) => void | Promise<void>;
  /** Group events before `send`. Defaults to one event per `send`, at once. */
  batch?: AuditLogDestinationBatch | undefined;
  /** Milliseconds before `send` is aborted and counted as failed. Defaults to `10000`. */
  timeout?: number | undefined;
}

/** Settings every ready-made destination accepts, as in `destinations`. */
export type DestinationSettings = Partial<
  Pick<AuditLogDestination, "name" | "events" | "batch" | "timeout">
> & {
  /**
   * Converts each event before it is sent (ECS, OpenTelemetry...).
   * Return `null` to skip it. Defaults to the event as it is.
   */
  transform?: ((event: AuditEvent) => unknown) | undefined;
};

export interface HttpDestinationOptions extends DestinationSettings {
  /** Where to POST the events. `http:` or `https:`. */
  url: string | URL;
  /**
   * `"json"`: one JSON array per request. `"ndjson"`: one JSON object per
   * line, as many log services' HTTP intake expects. Defaults to `"json"`.
   */
  format?: "json" | "ndjson" | undefined;
  /** Extra request headers, e.g. `{ authorization: "Bearer ..." }`. */
  headers?: Readonly<Record<string, string>> | undefined;
  /**
   * Signs every request the Standard Webhooks way (`webhook-id`,
   * `webhook-timestamp`, `webhook-signature` headers), so the receiver can
   * verify it with any Standard Webhooks library. A base64 key of 24 to
   * 64 bytes, optionally prefixed with `whsec_`.
   */
  secret?: string | undefined;
}

/**
 * An entry of `destinations`. Without `transform`, `send` gets the
 * events as they are; with one, annotate `send`'s `batch` with what
 * `transform` returns.
 */
export type AuditLogDestinationEntry =
  | (AuditLogDestination & { transform?: undefined })
  // biome-ignore lint/suspicious/noExplicitAny: each destination converts to its own type; `send` is annotated by the caller.
  | (AuditLogDestination<any> & { transform: (event: AuditEvent) => unknown });

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
  /**
   * Called with every stored event, awaited before the request goes on.
   * Errors are logged. For forwarding events, prefer `destinations`.
   */
  onEvent?: ((event: AuditEvent) => void | Promise<void>) | undefined;
  /** Where to keep events. Defaults to the plugin's `auditEvent` table. */
  storage?: AuditLogStorage | undefined;
  /**
   * Extra places every stored event is sent to, in the background: a
   * SIEM, a log service, a webhook (`httpDestination` from
   * `@checodo/better-auth-audit-log/destinations`). Best effort.
   */
  destinations?: readonly AuditLogDestinationEntry[] | undefined;
  /**
   * Delete old events automatically. Off by default: events are kept
   * forever. Needs a storage with `deleteOlderThan`.
   */
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
  destinations: readonly ResolvedDestination[];
  retention: { days: number; sweepInterval: number } | undefined;
  /** `null`: off. */
  hashChain: { secret: string | undefined } | null;
  adminRoles: readonly string[];
  adminUserIds: readonly string[];
}

export interface ResolvedDestination {
  name: string;
  /** `null`: every recorded event. */
  events: ((type: string) => boolean) | null;
  transform: ((event: AuditEvent) => unknown) | undefined;
  send: (batch: unknown[], context: AuditLogDestinationContext) => void | Promise<void>;
  size: number;
  wait: number;
  timeout: number;
}
