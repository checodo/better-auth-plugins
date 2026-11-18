import type { BetterAuthPlugin, GenericEndpointContext } from "@better-auth/core";
import { isAdmin } from "@repo/plugin-utils/admin";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import * as z from "zod";
import { AUDIT_LOG_ERROR_CODES } from "../error-codes";
import { isValidEventType, MAX_TYPE_LENGTH } from "../options";
import type { Recorder } from "../recorder";
import { databaseStorage } from "../store";
import type { ResolvedAuditLogOptions } from "../types";
import { decodeCursor, encodeCursor, nextCursor, toCsv, toNdjson } from "../utils/export";

/** Most events one export request returns. */
export const MAX_EXPORT_SIZE = 10_000;
/** Most links one verification over HTTP checks. */
export const MAX_VERIFY_LINKS = 10_000;
/** Requests per minute and client to the export and verify endpoints. */
const RATE_LIMIT = 10;
export const EXPORT_PATHS = ["/audit-log/export", "/audit-log/verify-chain"];
export const exportRateLimit = {
  pathMatcher: (path: string) => EXPORT_PATHS.includes(path),
  window: 60,
  max: RATE_LIMIT,
};

const idSchema = z.string().min(1).max(255);

/**
 * Admins only over HTTP. A call through `auth.api` without headers is
 * your own server code (a job), so it needs no session; with headers, the
 * session they carry must be an admin's.
 */
async function requireAdmin(
  ctx: GenericEndpointContext,
  options: ResolvedAuditLogOptions,
  code: (typeof AUDIT_LOG_ERROR_CODES)[keyof typeof AUDIT_LOG_ERROR_CODES],
): Promise<void> {
  if (!ctx.request && !ctx.headers) return;
  const session = await getSessionFromCtx(ctx);
  if (!session) throw new APIError("UNAUTHORIZED");
  if (!isAdmin(session.user, options)) throw APIError.from("FORBIDDEN", code);
}

export function createExportEndpoints(options: ResolvedAuditLogOptions, recorder: Recorder) {
  return {
    /**
     * Exports events as NDJSON or CSV, newest first, a page at a time:
     * the `x-next-cursor` response header, when present, continues the
     * export. Admins only; on the server, `auth.api.exportAuditEvents`
     * without headers.
     */
    exportAuditEvents: createAuthEndpoint(
      "/audit-log/export",
      {
        method: "GET",
        query: z.optional(
          z.object({
            format: z
              .enum(["ndjson", "csv"])
              .optional()
              .meta({ description: "`ndjson` (default) or `csv`" }),
            userId: idSchema.optional().meta({ description: "Events about this user" }),
            actorUserId: idSchema.optional().meta({ description: "Events done by this user" }),
            type: z
              .string()
              .max(MAX_TYPE_LENGTH)
              .refine(isValidEventType, { message: "Invalid event type" })
              .optional()
              .meta({ description: "Only events of this type" }),
            status: z
              .enum(["success", "failure"])
              .optional()
              .meta({ description: "Only events with this status" }),
            from: z.coerce.date().optional().meta({ description: "Events at or after this time" }),
            to: z.coerce.date().optional().meta({ description: "Events before this time" }),
            limit: z.coerce
              .number()
              .int()
              .min(1)
              .max(MAX_EXPORT_SIZE)
              .optional()
              .meta({
                description: `How many events to return, at most ${MAX_EXPORT_SIZE}. Defaults to 1000`,
              }),
            cursor: z
              .string()
              .max(200)
              .optional()
              .meta({ description: "The previous response's `x-next-cursor` header" }),
          }),
        ),
        metadata: {
          openapi: {
            description: "Export audit events as NDJSON or CSV, newest first. Admins only",
          },
        },
      },
      async (ctx): Promise<Response> => {
        await requireAdmin(
          ctx,
          options,
          AUDIT_LOG_ERROR_CODES.YOU_ARE_NOT_ALLOWED_TO_EXPORT_EVENTS,
        );
        const query = ctx.query ?? {};
        const storage = recorder.storageFor(ctx.context);
        if (!storage.read) {
          throw APIError.from("NOT_IMPLEMENTED", AUDIT_LOG_ERROR_CODES.READ_NOT_SUPPORTED);
        }
        const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
        if (query.cursor !== undefined && !cursor) {
          throw APIError.from("BAD_REQUEST", AUDIT_LOG_ERROR_CODES.INVALID_CURSOR);
        }
        const limit = query.limit ?? 1000;
        const offset = cursor?.skip ?? 0;
        const { events, total } = await storage.read({
          userId: query.userId,
          actorUserId: query.actorUserId,
          type: query.type,
          status: query.status,
          from: query.from,
          to: cursor ? new Date(cursor.before) : query.to,
          limit,
          offset,
        });

        const format = query.format ?? "ndjson";
        const headers = new Headers({
          "content-type":
            format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8",
          "content-disposition": `attachment; filename="audit-events.${format}"`,
          "cache-control": "no-store",
        });
        if (events.length > 0 && offset + events.length < total) {
          headers.set("x-next-cursor", encodeCursor(nextCursor(events, cursor)));
        }
        const body = format === "csv" ? toCsv(events, !cursor) : toNdjson(events);
        return new Response(body, { status: 200, headers });
      },
    ),
    /**
     * Re-computes the hash chain and reports changed, deleted, and
     * unchained events. Over HTTP: admins only, at most 10,000 links per
     * call (continue with `nextSequence`). On the server, without a
     * `limit`, it checks every link: run it from a job.
     */
    verifyAuditChain: createAuthEndpoint(
      "/audit-log/verify-chain",
      {
        method: "POST",
        body: z.optional(
          z.object({
            afterSequence: z
              .number()
              .int()
              .min(0)
              .optional()
              .meta({ description: "Start after this link: a previous result's `nextSequence`" }),
            limit: z
              .number()
              .int()
              .min(1)
              .max(MAX_VERIFY_LINKS)
              .optional()
              .meta({
                description: `Check at most this many links. Over HTTP at most and by default ${MAX_VERIFY_LINKS}`,
              }),
          }),
        ),
        metadata: {
          openapi: {
            description: "Verify the audit log's hash chain. Admins only",
          },
        },
      },
      async (ctx) => {
        await requireAdmin(
          ctx,
          options,
          AUDIT_LOG_ERROR_CODES.YOU_ARE_NOT_ALLOWED_TO_VERIFY_THE_CHAIN,
        );
        const { chain } = recorder;
        if (!chain) {
          throw APIError.from("BAD_REQUEST", AUDIT_LOG_ERROR_CODES.HASH_CHAIN_NOT_ENABLED);
        }
        const storage = databaseStorage(ctx.context.adapter);
        return ctx.json(
          await chain.verify(ctx.context, (ids) => storage.readByIds(ids), {
            afterSequence: ctx.body?.afterSequence,
            limit: ctx.body?.limit ?? (ctx.request ? MAX_VERIFY_LINKS : undefined),
          }),
        );
      },
    ),
  } satisfies BetterAuthPlugin["endpoints"];
}
