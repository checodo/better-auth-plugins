import type { BetterAuthClientPlugin } from "better-auth/client";
import { SECURITY_ALERTS_ERROR_CODES } from "./error-codes";
import type { SecurityAlertsPlugin } from "./index";

/**
 * Client companion to `securityAlerts()`. Adds
 * `authClient.securityAlerts.secureAccount` (the confirmation page of the
 * "This wasn't me" link), `listDevices`, and `forgetDevice`, typed from
 * the server plugin.
 *
 * @example
 * ```ts
 * import { createAuthClient } from "better-auth/client";
 * import { securityAlertsClient } from "@checodo/better-auth-security-alerts/client";
 *
 * export const authClient = createAuthClient({
 *   plugins: [securityAlertsClient()],
 * });
 * ```
 */
export const securityAlertsClient = () => {
  return {
    id: "security-alerts",
    $InferServerPlugin: {} as SecurityAlertsPlugin,
    pathMethods: {
      "/security-alerts/secure-account": "POST",
      "/security-alerts/list-devices": "GET",
      "/security-alerts/forget-device": "POST",
    },
    // Securing the account signs out every session, maybe this browser's:
    // `useSession` fetches the session again.
    atomListeners: [
      {
        matcher: (path) => path === "/security-alerts/secure-account",
        signal: "$sessionSignal",
      },
    ],
    $ERROR_CODES: SECURITY_ALERTS_ERROR_CODES,
  } satisfies BetterAuthClientPlugin;
};

export { SECURITY_ALERTS_ERROR_CODES } from "./error-codes";
