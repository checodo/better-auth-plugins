import type { BetterAuthClientPlugin } from "better-auth/client";
import { WAITLIST_ERROR_CODES } from "./error-codes";
import type { WaitlistPlugin } from "./index";

/**
 * Client companion to `waitlist()`. Adds `authClient.waitlist.join`,
 * `confirm`, `getStatus`, `leave`, `checkInvite`, and the admin endpoints
 * (`listEntries`, `getStats`, `approveEntries`, `rejectEntry`,
 * `deleteEntry`, `createInvite`), typed from the server plugin.
 *
 * @example
 * ```ts
 * import { createAuthClient } from "better-auth/client";
 * import { waitlistClient } from "@checodo/better-auth-waitlist/client";
 *
 * export const authClient = createAuthClient({
 *   plugins: [waitlistClient()],
 * });
 *
 * await authClient.waitlist.join({ email: "ada@example.com" });
 * ```
 */
export const waitlistClient = () => {
  return {
    id: "waitlist",
    $InferServerPlugin: {} as WaitlistPlugin,
    pathMethods: {
      "/waitlist/join": "POST",
      "/waitlist/confirm": "POST",
      "/waitlist/get-status": "GET",
      "/waitlist/leave": "POST",
      "/waitlist/check-invite": "GET",
      "/waitlist/list-entries": "GET",
      "/waitlist/get-stats": "GET",
      "/waitlist/approve-entries": "POST",
      "/waitlist/reject-entry": "POST",
      "/waitlist/delete-entry": "POST",
      "/waitlist/create-invite": "POST",
    },
    $ERROR_CODES: WAITLIST_ERROR_CODES,
  } satisfies BetterAuthClientPlugin;
};

export { WAITLIST_ERROR_CODES } from "./error-codes";
