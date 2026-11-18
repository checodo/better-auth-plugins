import type { BetterAuthClientPlugin } from "better-auth/client";
import { AUDIT_LOG_ERROR_CODES } from "./error-codes";
import type { AuditLogPlugin } from "./index";

/**
 * Client companion to `auditLog()`. Adds `authClient.auditLog.listEvents`,
 * typed from the server plugin: the signed-in user's own events, or any
 * user's for admins.
 *
 * @example
 * ```ts
 * import { createAuthClient } from "better-auth/client";
 * import { auditLogClient } from "@checodo/better-auth-audit-log/client";
 *
 * export const authClient = createAuthClient({
 *   plugins: [auditLogClient()],
 * });
 *
 * const { data } = await authClient.auditLog.listEvents({ query: { type: "sign-in" } });
 * ```
 */
export const auditLogClient = () => {
  return {
    id: "audit-log",
    $InferServerPlugin: {} as AuditLogPlugin,
    pathMethods: {
      "/audit-log/list-events": "GET",
      "/audit-log/export": "GET",
    },
    $ERROR_CODES: AUDIT_LOG_ERROR_CODES,
  } satisfies BetterAuthClientPlugin;
};

export { AUDIT_LOG_ERROR_CODES } from "./error-codes";
