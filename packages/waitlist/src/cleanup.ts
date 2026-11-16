import type { AuthContext } from "@better-auth/core";
import { deleteExpiredEntries } from "./store";
import type { ResolvedWaitlistOptions } from "./types";

type Context = Pick<AuthContext, "adapter" | "logger" | "runInBackground">;

export type Cleanup = ReturnType<typeof createCleanup>;

/**
 * Deletes expired entries: unconfirmed ones whose link has expired, and
 * rejected and registered ones past `retention`. Per plugin instance, so
 * on serverless platforms each instance sweeps on its own schedule.
 */
export function createCleanup(options: ResolvedWaitlistOptions) {
  let lastSweep = 0;

  /** Deletes what has expired at `now`; returns how many entries. */
  function deleteExpired(context: Pick<Context, "adapter">, now = Date.now()): Promise<number> {
    const { rejected, registered } = options.retention;
    return deleteExpiredEntries(context.adapter, {
      unconfirmed: new Date(now - options.confirmationExpiresIn),
      rejected: rejected === undefined ? undefined : new Date(now - rejected),
      registered: registered === undefined ? undefined : new Date(now - registered),
    });
  }

  /** Starts a cleanup in the background, at most once per `sweepInterval`. */
  function maybeSweep(context: Context) {
    const now = Date.now();
    if (now - lastSweep < options.sweepInterval) return;
    lastSweep = now;
    const sweep = deleteExpired(context, now).catch((error) =>
      context.logger.error("[waitlist] cleanup failed", error),
    );
    // Not awaited: a slow cleanup must not slow down the request.
    context.runInBackground(sweep);
  }

  return { deleteExpired, maybeSweep };
}
