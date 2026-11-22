import type { AuthContext, BetterAuthPlugin } from "@better-auth/core";
import { mergeSchema } from "better-auth/db";
import { version } from "../package.json";
import { AUDIT_LOG_ERROR_CODES } from "./error-codes";
import { createDatabaseHooks } from "./hooks/database";
import { createPathHooks } from "./hooks/paths";
import { resolveOptions } from "./options";
import { createRecordEvent } from "./record-event";
import { createRecorder } from "./recorder";
import { createEventEndpoints } from "./routes/events";
import { createExportEndpoints, exportRateLimit } from "./routes/export";
import { auditChainSchema, auditLogSchema } from "./schema";
import type { AuditLogOptions } from "./types";
import { createExportUserData } from "./user-data";

export type { AuditChainLink, ChainProblem, ChainRange, ChainVerification } from "./chain";
export { AUDIT_LOG_ERROR_CODES, type AuditLogErrorCode } from "./error-codes";
export { memoryStorage } from "./memory";
export type { PluginEventDetails } from "./record-event";
export type {
  AdminAuditAction,
  AuditEvent,
  AuditEventInput,
  AuditEventQuery,
  AuditEventSeverity,
  AuditEventStatus,
  AuditEventType,
  AuditLogDestination,
  AuditLogDestinationBatch,
  AuditLogDestinationContext,
  AuditLogDestinationEntry,
  AuditLogOptions,
  AuditLogRetention,
  AuditLogStorage,
  BuiltInAuditEventType,
} from "./types";

/** Plugins whose after-hooks clear `ctx.context.newSession` (a sign-in that isn't done yet). */
const CLEARS_NEW_SESSION = new Set(["two-factor"]);

/**
 * Sign-ins are read from `ctx.context.newSession` after the endpoint ran,
 * which plugins such as `twoFactor` clear in their own after-hooks (the
 * sign-in isn't done until the second factor). Hooks run in plugin order,
 * so the audit log must come after them.
 */
function warnAboutOrder(ctx: Pick<AuthContext, "options" | "logger">) {
  const plugins = ctx.options.plugins ?? [];
  const index = plugins.findIndex((plugin) => plugin.id === "audit-log");
  const later = plugins
    .slice(index + 1)
    .filter((plugin) => CLEARS_NEW_SESSION.has(plugin.id))
    .map((plugin) => plugin.id);
  if (later.length > 0) {
    ctx.logger.warn(
      `[audit-log] Put auditLog() after ${later.join(", ")} in "plugins", so sign-ins are recorded once they are complete.`,
    );
  }
}

/**
 * Records security-relevant events: sign-ins (any method) and failed
 * sign-ins, sign-ups, sign-outs, revoked sessions, password and email
 * changes, linked accounts, deleted users, and the actions of better-auth's
 * `admin` plugin. Users can list their own events, admins everyone's.
 *
 * @example
 * ```ts
 * import { betterAuth } from "better-auth";
 * import { auditLog } from "@checodo/better-auth-audit-log";
 *
 * export const auth = betterAuth({
 *   plugins: [
 *     // ...other plugins, then:
 *     auditLog({ retention: { days: 90 } }),
 *   ],
 * });
 * ```
 */
export const auditLog = (options: AuditLogOptions = {}) => {
  const resolved = resolveOptions(options);
  const recorder = createRecorder(resolved);

  const plugin = {
    id: "audit-log",
    version,
    init(ctx) {
      warnAboutOrder(ctx);
      return { options: { databaseHooks: createDatabaseHooks(ctx, recorder) } };
    },
    // Custom storage keeps events elsewhere, so no table is needed.
    // mergeSchema changes the object it gets, so each instance gets a copy.
    ...(resolved.storage
      ? {}
      : {
          schema: mergeSchema(
            structuredClone({ ...auditLogSchema, ...(resolved.hashChain ? auditChainSchema : {}) }),
            options.schema,
          ),
        }),
    endpoints: {
      ...createEventEndpoints(resolved, recorder),
      ...createExportEndpoints(resolved, recorder),
    },
    // Apps can change this with better-auth's `rateLimit.customRules`.
    rateLimit: [exportRateLimit],
    hooks: createPathHooks(resolved, recorder),
    $ERROR_CODES: AUDIT_LOG_ERROR_CODES,
    options,
  } satisfies BetterAuthPlugin;

  return Object.assign(plugin, {
    /**
     * Records an event from another plugin or your own server code, with
     * the current request's user, session, IP address, and user agent:
     * `ctx.context.getPlugin("audit-log")?.recordEvent({ type: "x.y", userId })`.
     * Never throws.
     */
    recordEvent: createRecordEvent(recorder),
    /**
     * The user's events, for `@checodo/better-auth-data-export`: the
     * events about them and the ones they did.
     */
    exportUserData: createExportUserData(resolved.storage),
  });
};

export type AuditLogPlugin = ReturnType<typeof auditLog>;

/** Lets `auth.$context.getPlugin("audit-log")` infer this plugin's exact type. */
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    "audit-log": {
      creator: typeof auditLog;
    };
  }
}
