import type { AuthContext } from "@better-auth/core";
import { getIP } from "@better-auth/core/utils/ip";
import { createChain } from "./chain";
import { databaseStorage } from "./store";
import type {
  AuditEvent,
  AuditEventInput,
  AuditEventSeverity,
  AuditEventStatus,
  AuditLogStorage,
  ResolvedAuditLogOptions,
} from "./types";
import { redact } from "./utils/redact";
import { severityOf } from "./utils/severity";

/** Longest JSON-encoded `metadata`. Longer metadata from hooks is replaced by `{ truncated: true }`. */
export const MAX_METADATA_LENGTH = 4000;
const MAX_USER_AGENT_LENGTH = 512;

type Context = Pick<
  AuthContext,
  "adapter" | "logger" | "options" | "secret" | "runInBackground" | "runInBackgroundOrAwait"
>;

/** What hooks and `recordAuditEvent` know about an event; the rest is filled in. */
export interface EventDetails {
  type: string;
  status?: AuditEventStatus | undefined;
  severity?: AuditEventSeverity | undefined;
  userId?: string | null | undefined;
  actorUserId?: string | null | undefined;
  sessionId?: string | null | undefined;
  organizationId?: string | null | undefined;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  errorCode?: string | null | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}

export type Recorder = ReturnType<typeof createRecorder>;

export function createRecorder(options: ResolvedAuditLogOptions) {
  let lastSweep = 0;
  const chain = options.hashChain ? createChain(options.hashChain.secret) : null;
  let lastCreatedAt = 0;
  /**
   * The current time, but never the same as or earlier than the previous
   * event's: events recorded in the same millisecond (a sign-up and its
   * sign-in) still list in the order they happened.
   */
  const nextTimestamp = () => {
    lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
    return new Date(lastCreatedAt);
  };

  const storageFor = (ctx: Pick<Context, "adapter">): AuditLogStorage =>
    options.storage ?? databaseStorage(ctx.adapter);

  const isRecorded = (type: string) => !options.events || options.events(type);

  function build(ctx: Context, details: EventDetails, headers?: Headers | null): AuditEventInput {
    const status = details.status ?? "success";
    let metadata = details.metadata ? (redact(details.metadata) as Record<string, unknown>) : null;
    if (metadata && JSON.stringify(metadata).length > MAX_METADATA_LENGTH) {
      metadata = { truncated: true };
    }
    const ipAddress =
      details.ipAddress ?? (options.captureIp && headers ? getIP(headers, ctx.options) : null);
    const userAgent =
      details.userAgent ?? (options.captureUserAgent ? (headers?.get("user-agent") ?? null) : null);
    return {
      type: details.type,
      status,
      severity: details.severity ?? severityOf(details.type, status, options.severity),
      userId: details.userId ?? null,
      actorUserId: details.actorUserId ?? null,
      sessionId: details.sessionId ?? null,
      organizationId: details.organizationId ?? null,
      ipAddress,
      userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
      errorCode: details.errorCode ?? null,
      metadata,
      createdAt: nextTimestamp(),
    };
  }

  /** Deletes events created before `date`, and their links. */
  async function deleteOlderThan(ctx: Pick<Context, "adapter">, date: Date): Promise<number> {
    const deleted = await storageFor(ctx).deleteOlderThan(date);
    if (chain) await chain.deleteOlderThan(ctx, date);
    return deleted;
  }

  /** Starts a retention sweep in the background, at most once per `sweepInterval`. */
  function maybeSweep(ctx: Context) {
    if (!options.retention) return;
    const now = Date.now();
    if (now - lastSweep < options.retention.sweepInterval * 1000) return;
    lastSweep = now;
    const cutoff = new Date(now - options.retention.days * 86_400_000);
    const sweep = deleteOlderThan(ctx, cutoff).catch((error) =>
      ctx.logger.error("[audit-log] retention sweep failed", error),
    );
    // Not awaited: a slow sweep must not slow down the request.
    ctx.runInBackground(sweep);
  }

  /**
   * Builds, filters, and stores an event, then calls `onEvent`. Returns
   * `null` if the event isn't recorded (`events`, `beforeLog`). Storage
   * errors are thrown; `onEvent` errors are logged.
   */
  async function recordNow(
    ctx: Context,
    details: EventDetails,
    headers?: Headers | null,
  ): Promise<AuditEvent | null> {
    if (!isRecorded(details.type)) return null;
    let event: AuditEventInput | null = build(ctx, details, headers);
    if (options.beforeLog) {
      try {
        event = await options.beforeLog(event);
      } catch (error) {
        ctx.logger.error("[audit-log] beforeLog threw an error; the event was dropped", error);
        return null;
      }
      if (!event) return null;
    }
    const stored = await storageFor(ctx).write(event);
    if (chain) await chain.link(ctx, stored);
    if (options.onEvent) {
      try {
        await options.onEvent(stored);
      } catch (error) {
        ctx.logger.error("[audit-log] onEvent threw an error", error);
      }
    }
    maybeSweep(ctx);
    return stored;
  }

  /**
   * `recordNow` for hooks: never throws, and runs in the background when
   * better-auth's `advanced.backgroundTasks` is configured.
   */
  async function record(
    ctx: Context,
    details: EventDetails,
    headers?: Headers | null,
  ): Promise<void> {
    if (!isRecorded(details.type)) return;
    const task = recordNow(ctx, details, headers).then(
      () => undefined,
      (error) => ctx.logger.error(`[audit-log] failed to record a "${details.type}" event`, error),
    );
    await ctx.runInBackgroundOrAwait(task);
  }

  return { record, recordNow, storageFor, isRecorded, deleteOlderThan, chain };
}
