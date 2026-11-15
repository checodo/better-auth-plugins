import { tryGetCurrentAuthEndpointContext } from "@better-auth/core/context";

/** An event for `@checodo/better-auth-audit-log`. */
export interface AuditEvent {
  type: string;
  status?: "success" | "failure" | undefined;
  severity?: "low" | "medium" | "high" | "critical" | undefined;
  /** The user the event is about. */
  userId?: string | null | undefined;
  /** Who did it; defaults to the signed-in user. */
  actorUserId?: string | null | undefined;
  errorCode?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/** The part of the audit log plugin used here. */
interface AuditLog {
  recordEvent?: (event: AuditEvent) => Promise<void>;
}

/**
 * Records an event in the audit log plugin, if the app uses it. The audit
 * log is found through `getPlugin`, like official plugins find each other,
 * so it isn't a dependency. Does nothing outside a request. Never throws:
 * the audit log's `recordEvent` doesn't.
 */
export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  const endpoint = tryGetCurrentAuthEndpointContext();
  const auditLog = endpoint?.context.getPlugin("audit-log") as AuditLog | null | undefined;
  await auditLog?.recordEvent?.(event);
}
