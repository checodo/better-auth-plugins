import type { BetterAuthPlugin, GenericEndpointContext } from "@better-auth/core";
import { BASE_ERROR_CODES } from "@better-auth/core/error";
import type { ResolvedAdminOptions } from "@repo/plugin-utils/admin";
import { isAdmin, resolveAdminOptions } from "@repo/plugin-utils/admin";
import { recordAuditEvent } from "@repo/plugin-utils/audit";
import { createFail } from "@repo/plugin-utils/options";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import * as z from "zod";
import { version } from "../package.json";
import type { CollectOptions } from "./collect";
import { collectUserData } from "./collect";
import { DATA_EXPORT_ERROR_CODES } from "./error-codes";
import type { DataExport, DataExportOptions, DataExportVia } from "./types";

export { isSecretField } from "./collect";
export { DATA_EXPORT_ERROR_CODES, type DataExportErrorCode } from "./error-codes";
export type {
  DataExport,
  DataExportAdminOptions,
  DataExportContributor,
  DataExportEvent,
  DataExportOptions,
  DataExportUser,
  DataExportVia,
} from "./types";

const PLUGIN_ID = "data-export";
const fail: (message: string) => never = createFail(PLUGIN_ID);

/** Default most rows per export. */
export const DEFAULT_MAX_ROWS = 50_000;

interface ResolvedOptions extends CollectOptions {
  admin: ResolvedAdminOptions | null;
  freshAge: number | undefined;
  rateLimit: { window: number; max: number };
  onExport: DataExportOptions["onExport"];
}

function resolveOptions(options: DataExportOptions): ResolvedOptions {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    fail(`"maxRows" must be a positive integer, got ${JSON.stringify(options.maxRows)}.`);
  }
  for (const [model, fields] of Object.entries(options.omit ?? {})) {
    if (fields !== true && !Array.isArray(fields)) {
      fail(`"omit.${model}" must be a list of fields or true.`);
    }
  }
  for (const [name, contributor] of Object.entries(options.contributors ?? {})) {
    if (typeof contributor !== "function") fail(`"contributors.${name}" must be a function.`);
  }
  if (options.onExport !== undefined && typeof options.onExport !== "function") {
    fail('"onExport" must be a function.');
  }
  if (
    options.freshAge !== undefined &&
    (!Number.isInteger(options.freshAge) || options.freshAge < 0)
  ) {
    fail(`"freshAge" must be a whole number of seconds, got ${JSON.stringify(options.freshAge)}.`);
  }
  const rateLimit = options.rateLimit ?? { window: 3600, max: 3 };
  if (!(rateLimit.window > 0) || !(rateLimit.max > 0)) {
    fail('"rateLimit" needs a positive "window" (seconds) and "max".');
  }
  const admin = options.admin
    ? resolveAdminOptions(options.admin === true ? {} : options.admin)
    : null;
  return {
    omit: options.omit ?? {},
    contributors: options.contributors ?? {},
    maxRows,
    admin,
    freshAge: options.freshAge,
    rateLimit,
    onExport: options.onExport,
  };
}

/** Failure codes recorded as `data-export.failed`. */
const FAILURES = new Set(["EXPORT_TOO_LARGE", "EXPORT_FAILED"]);

/** The download is a file the browser saves, never cached on the way. */
function setDownloadHeaders(ctx: GenericEndpointContext) {
  const date = new Date().toISOString().slice(0, 10);
  ctx.setHeader("Content-Disposition", `attachment; filename="data-export-${date}.json"`);
  ctx.setHeader("Cache-Control", "no-store");
}

/**
 * Data access requests (GDPR Art. 15 and 20): every signed-in user can
 * download what is stored about them as one JSON document, with
 * passwords, tokens, and other secrets left out. Finds the data through
 * better-auth's schema (core, official plugins, the app's models), what
 * plugins add, and the app's `contributors`.
 *
 * @example
 * ```ts
 * import { betterAuth } from "better-auth";
 * import { dataExport } from "@checodo/better-auth-data-export";
 *
 * export const auth = betterAuth({
 *   plugins: [dataExport()],
 * });
 * ```
 */
export const dataExport = (options: DataExportOptions = {}) => {
  const resolved = resolveOptions(options);

  /** Collects one user's data, records it, and calls `onExport`. */
  const exportFor = async (
    ctx: GenericEndpointContext,
    userId: string,
    via: DataExportVia,
    actorUserId: string | null,
  ): Promise<DataExport> => {
    let result: Awaited<ReturnType<typeof collectUserData>>;
    try {
      result = await collectUserData(ctx.context, userId, resolved);
    } catch (error) {
      const code = isAPIError(error) ? error.body?.code : undefined;
      if (code && FAILURES.has(code)) {
        await recordAuditEvent({
          type: "data-export.failed",
          status: "failure",
          severity: "medium",
          userId,
          actorUserId,
          errorCode: code,
          metadata: { via },
        });
      }
      throw error;
    }
    await recordAuditEvent({
      type: "data-export.completed",
      severity: via === "admin" ? "medium" : "low",
      userId,
      actorUserId,
      metadata: { via, rows: result.rows },
    });
    const onExport = resolved.onExport;
    if (onExport) {
      const event = { user: result.user, via, actorUserId, rows: result.rows };
      const task = (async () => {
        try {
          await onExport(event, ctx.request);
        } catch (error) {
          ctx.context.logger.error(`[${PLUGIN_ID}] onExport failed`, error);
        }
      })();
      await ctx.context.runInBackgroundOrAwait(task);
    }
    return result.document;
  };

  /**
   * A signed-in session from within `freshAge` (or better-auth's
   * `session.freshAge`): an export is the most sensitive read there is.
   */
  const freshSession = createAuthMiddleware(async (ctx) => {
    const session = await getSessionFromCtx(ctx);
    if (!session?.session) {
      throw APIError.from("UNAUTHORIZED", { message: "Unauthorized", code: "UNAUTHORIZED" });
    }
    const freshAge = resolved.freshAge ?? ctx.context.sessionConfig.freshAge;
    const age = Date.now() - new Date(session.session.createdAt).getTime();
    if (freshAge !== 0 && age >= freshAge * 1000) {
      throw APIError.from("FORBIDDEN", BASE_ERROR_CODES.SESSION_NOT_FRESH);
    }
    return { session };
  });

  /** Whether a user may export other users' data (the `admin` option). */
  const mayExportOthers = (user: { id: string; role?: unknown }) =>
    !!resolved.admin && isAdmin(user, resolved.admin);

  const userIdBody = z.object({
    userId: z.string().min(1).meta({ description: "The user whose data is exported" }),
  });

  return {
    id: PLUGIN_ID,
    version,
    endpoints: {
      /**
       * The signed-in user's data, as a JSON download. Needs a fresh
       * session (`freshAge`) and a request from this site.
       */
      downloadDataExport: createAuthEndpoint(
        "/data-export/download",
        {
          method: "GET",
          use: [freshSession],
          metadata: {
            openapi: {
              description:
                "Download everything stored about the signed-in user as JSON (GDPR Art. 15 and 20)",
            },
          },
        },
        async (ctx) => {
          // A GET from another site (an image or a link on a page the user
          // visits) can't read the file, but would record exports and call
          // `onExport`. Same-site and direct requests are fine.
          if (ctx.request?.headers.get("sec-fetch-site") === "cross-site") {
            throw APIError.from("FORBIDDEN", DATA_EXPORT_ERROR_CODES.CROSS_SITE_REQUEST);
          }
          const { session, user } = ctx.context.session;
          // An admin impersonating the user (better-auth's admin plugin)
          // exports as an admin: allowed only with the `admin` option, and
          // recorded with the admin as the actor.
          const impersonatedBy = (session as { impersonatedBy?: unknown }).impersonatedBy;
          if (typeof impersonatedBy === "string" && impersonatedBy) {
            const impersonator = await ctx.context.adapter.findOne<{ id: string; role?: unknown }>({
              model: "user",
              where: [{ field: "id", value: impersonatedBy }],
            });
            if (!impersonator || !mayExportOthers(impersonator)) {
              throw APIError.from("FORBIDDEN", DATA_EXPORT_ERROR_CODES.NOT_ALLOWED);
            }
            const document = await exportFor(ctx, user.id, "admin", impersonator.id);
            setDownloadHeaders(ctx);
            return ctx.json(document);
          }
          const document = await exportFor(ctx, user.id, "user", user.id);
          setDownloadHeaders(ctx);
          return ctx.json(document);
        },
      ),
      /**
       * Another user's data, for admins (the `admin` option). Needs a
       * fresh session, like the user's own download.
       */
      adminDataExport: createAuthEndpoint(
        "/data-export/admin",
        {
          method: "POST",
          use: [freshSession],
          body: userIdBody,
          metadata: {
            openapi: { description: "Export another user's data as JSON. Admins only" },
          },
        },
        async (ctx) => {
          const actor = ctx.context.session.user;
          if (!mayExportOthers(actor)) {
            throw APIError.from("FORBIDDEN", DATA_EXPORT_ERROR_CODES.NOT_ALLOWED);
          }
          const document = await exportFor(ctx, ctx.body.userId, "admin", actor.id);
          setDownloadHeaders(ctx);
          return ctx.json(document);
        },
      ),
      /**
       * Server only: a user's data, for requests that come in by email or
       * support, after you have checked the person's identity.
       */
      exportUserData: createAuthEndpoint(
        {
          method: "POST",
          body: userIdBody,
          metadata: { openapi: { description: "Export a user's data as JSON. Server only" } },
        },
        async (ctx) => ctx.json(await exportFor(ctx, ctx.body.userId, "server", null)),
      ),
    },
    // Apps can change this with better-auth's `rateLimit.customRules`.
    rateLimit: [
      {
        pathMatcher: (path: string) => path.startsWith("/data-export/"),
        window: resolved.rateLimit.window,
        max: resolved.rateLimit.max,
      },
    ],
    $ERROR_CODES: DATA_EXPORT_ERROR_CODES,
    options,
  } satisfies BetterAuthPlugin;
};

export type DataExportPlugin = ReturnType<typeof dataExport>;

/** Lets `auth.$context.getPlugin("data-export")` infer this plugin's exact type. */
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    "data-export": {
      creator: typeof dataExport;
    };
  }
}
