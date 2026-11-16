import type { BetterAuthPlugin } from "@better-auth/core";
import { createAuthEndpoint } from "better-auth/api";
import type { Cleanup } from "../cleanup";

export function createCleanupEndpoints(cleanup: Cleanup) {
  return {
    /**
     * Server only: deletes expired entries, for a cron job. Unconfirmed
     * entries whose link has expired, and rejected and registered entries
     * past `retention`.
     */
    deleteExpiredWaitlistEntries: createAuthEndpoint(
      {
        method: "POST",
        metadata: {
          openapi: {
            description:
              "Delete expired waitlist entries: unconfirmed ones whose link has expired, and rejected and registered ones past the retention period. Server only",
          },
        },
      },
      async (ctx) => {
        const deleted = await cleanup.deleteExpired(ctx.context);
        return ctx.json({ deleted });
      },
    ),
  } satisfies BetterAuthPlugin["endpoints"];
}
