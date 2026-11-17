import type { BetterAuthPlugin } from "@better-auth/core";
import { mergeSchema } from "better-auth/db";
import { version } from "../package.json";
import { createAlerter, PLUGIN_ID } from "./alerts";
import { SECURITY_ALERTS_ERROR_CODES } from "./error-codes";
import { createDatabaseHooks } from "./hooks/database";
import { createPathHooks } from "./hooks/paths";
import { resolveOptions } from "./options";
import { createDeviceEndpoints } from "./routes/devices";
import { createSecureAccountEndpoints } from "./routes/secure-account";
import { securityAlertsSchema } from "./schema";
import type { SecurityAlertsOptions } from "./types";

export { SECURITY_ALERTS_ERROR_CODES, type SecurityAlertsErrorCode } from "./error-codes";
export type { SecurityAlertsKnownDevice } from "./routes/devices";
export type {
  SecurityAlert,
  SecurityAlertDetails,
  SecurityAlertDevice,
  SecurityAlertsAdminActionsOptions,
  SecurityAlertsDeviceCheck,
  SecurityAlertsEmailChangeAction,
  SecurityAlertsNewDeviceOptions,
  SecurityAlertsOptions,
  SecurityAlertsPasswordAction,
  SecurityAlertsSecureAccountOptions,
  SecurityAlertsSecuredAccount,
  SecurityAlertType,
} from "./types";

/** Endpoints anyone can call with a token: limited per IP. */
const TOKEN_PATHS = ["/security-alerts/secure-account"];

/**
 * Tells users about security-relevant changes to their account: sign-ins
 * from new devices, password and email changes, password resets, passkeys,
 * two-factor turned off, linked accounts, and API keys. Each alert can come
 * with a "This wasn't me" link that signs out every session and blocks the
 * password.
 *
 * @example
 * ```ts
 * import { betterAuth } from "better-auth";
 * import { securityAlerts } from "@checodo/better-auth-security-alerts";
 *
 * export const auth = betterAuth({
 *   plugins: [
 *     securityAlerts({
 *       sendAlert: async ({ type, email, details, secureAccountUrl }) => {
 *         await sendEmail({ to: email, template: type, data: { details, secureAccountUrl } });
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
export const securityAlerts = (options: SecurityAlertsOptions) => {
  const resolved = resolveOptions(options);
  const alert = createAlerter(resolved);

  return {
    id: PLUGIN_ID,
    version,
    init(ctx) {
      const password = resolved.secureAccount?.password;
      if (password && password !== "none" && !ctx.options.emailAndPassword?.sendResetPassword) {
        ctx.logger.warn(
          `[${PLUGIN_ID}] secureAccount.password is "${password}", but emailAndPassword.sendResetPassword isn't configured: the "This wasn't me" link only signs out every session.`,
        );
      }
      if (resolved.alerts["password-reset-requested"] && !ctx.options.advanced?.backgroundTasks) {
        ctx.logger.warn(
          `[${PLUGIN_ID}] advanced.backgroundTasks isn't configured: password reset requests for existing emails answer slower than for unknown ones (better-auth's reset email and the password-reset-requested alert are sent first), which tells who has an account. Configure background tasks, or turn the alert off.`,
        );
      }
      return { options: { databaseHooks: createDatabaseHooks(ctx, alert) } };
    },
    // mergeSchema changes the object it gets, so each instance gets a copy.
    schema: mergeSchema(structuredClone(securityAlertsSchema), options.schema),
    endpoints: {
      ...createSecureAccountEndpoints(resolved),
      ...createDeviceEndpoints(resolved),
    },
    hooks: createPathHooks(resolved, alert),
    // Apps can change this with better-auth's `rateLimit.customRules`.
    rateLimit: [{ pathMatcher: (path) => TOKEN_PATHS.includes(path), window: 60, max: 5 }],
    $ERROR_CODES: SECURITY_ALERTS_ERROR_CODES,
    options,
  } satisfies BetterAuthPlugin;
};

export type SecurityAlertsPlugin = ReturnType<typeof securityAlerts>;

/** Lets `auth.$context.getPlugin("security-alerts")` infer this plugin's exact type. */
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    "security-alerts": {
      creator: typeof securityAlerts;
    };
  }
}
