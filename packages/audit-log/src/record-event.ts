import type { GenericEndpointContext } from "@better-auth/core";
import {
  getCurrentAdapter,
  runWithAdapter,
  tryGetCurrentAuthEndpointContext,
} from "@better-auth/core/context";
import type { EventDetails, Recorder } from "./recorder";

/** What other plugins pass to `recordEvent`. */
export type PluginEventDetails = Omit<EventDetails, "ipAddress" | "userAgent">;

/**
 * Records an event for another plugin, through
 * `ctx.context.getPlugin("audit-log")?.recordEvent(...)`, the way official
 * plugins reach each other (`anonymous` calls `twoFactor` like this).
 *
 * Fills in what the request knows: the signed-in user as actor (unless
 * `actorUserId` is given), the session, its active organization, the IP
 * address, and the user agent. Never throws.
 *
 * Inside a database transaction (a database hook while a user is created),
 * the event is written outside it once the transaction ends: an event
 * about something that was refused, like a blocked sign-up, must survive
 * the rollback.
 */
export function createRecordEvent(recorder: Recorder) {
  return async (
    details: PluginEventDetails,
    endpoint: GenericEndpointContext | null | undefined = tryGetCurrentAuthEndpointContext() as
      | GenericEndpointContext
      | undefined,
  ): Promise<void> => {
    if (!endpoint || !recorder.isRecorded(details.type)) return;
    const ctx = endpoint.context;
    const session = ctx.session;
    const event: EventDetails = {
      actorUserId: session?.user.id ?? null,
      sessionId: session?.session.id ?? null,
      organizationId:
        ((session?.session as { activeOrganizationId?: string | null } | undefined)
          ?.activeOrganizationId as string | null | undefined) ?? null,
      ...details,
    };
    const headers = endpoint.request?.headers ?? endpoint.headers ?? null;

    try {
      if ((await getCurrentAdapter(ctx.adapter)) === ctx.adapter) {
        await recorder.record(ctx, event, headers);
        return;
      }
      // In a transaction: not awaited, so the write waits for the
      // transaction instead of the transaction waiting for the write.
      ctx.runInBackground(runWithAdapter(ctx.adapter, () => recorder.record(ctx, event, headers)));
    } catch (error) {
      ctx.logger.error(`[audit-log] failed to record a "${details.type}" event`, error);
    }
  };
}
