import type { BetterAuthPlugin } from "@better-auth/core";
import { isAdmin } from "@repo/plugin-utils/admin";
import { paginationQuery } from "@repo/plugin-utils/pagination";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import * as z from "zod";
import { AUDIT_LOG_ERROR_CODES } from "../error-codes";
import { isValidEventType, MAX_TYPE_LENGTH } from "../options";
import type { Recorder } from "../recorder";
import { MAX_METADATA_LENGTH } from "../recorder";
import { databaseStorage } from "../store";
import type { ResolvedAuditLogOptions } from "../types";

/** Most events one list request returns. */
export const MAX_PAGE_SIZE = 100;

const statusSchema = z.enum(["success", "failure"]);
const severitySchema = z.enum(["low", "medium", "high", "critical"]);
const typeSchema = z
  .string()
  .max(MAX_TYPE_LENGTH)
  .refine(isValidEventType, { message: "Invalid event type" });
const idSchema = z.string().min(1).max(255);

export function createEventEndpoints(options: ResolvedAuditLogOptions, recorder: Recorder) {
  return {
    listAuditEvents: createAuthEndpoint(
      "/audit-log/list-events",
      {
        method: "GET",
        use: [sessionMiddleware],
        query: z.optional(
          z.object({
            userId: idSchema
              .optional()
              .meta({ description: "Events about this user. Admins only, except for yourself" }),
            actorUserId: idSchema
              .optional()
              .meta({ description: "Events done by this user. Admins only" }),
            type: typeSchema.optional().meta({ description: "Only events of this type" }),
            status: statusSchema.optional().meta({ description: "Only events with this status" }),
            from: z.coerce.date().optional().meta({ description: "Events at or after this time" }),
            to: z.coerce.date().optional().meta({ description: "Events before this time" }),
            ...paginationQuery({ defaultLimit: 20, maxLimit: MAX_PAGE_SIZE }),
          }),
        ),
        metadata: {
          openapi: {
            description: "List audit events, newest first: your own, or any user's for admins",
          },
        },
      },
      async (ctx) => {
        const me = ctx.context.session.user;
        const query = ctx.query ?? { limit: 20, offset: 0 };
        const admin = isAdmin(me, options);
        if (!admin && ((query.userId && query.userId !== me.id) || query.actorUserId)) {
          throw APIError.from(
            "FORBIDDEN",
            AUDIT_LOG_ERROR_CODES.YOU_ARE_NOT_ALLOWED_TO_LIST_OTHER_USERS_EVENTS,
          );
        }
        const storage = recorder.storageFor(ctx.context);
        if (!storage.read) {
          throw APIError.from("NOT_IMPLEMENTED", AUDIT_LOG_ERROR_CODES.READ_NOT_SUPPORTED);
        }
        const { events, total } = await storage.read({
          userId: admin ? query.userId : me.id,
          actorUserId: query.actorUserId,
          type: query.type,
          status: query.status,
          from: query.from,
          to: query.to,
          limit: query.limit ?? 20,
          offset: query.offset ?? 0,
        });
        // Users see where and how they did something, but not the IP address,
        // user agent, or session of someone else acting on their account
        // (an admin, or whoever failed to sign in as them).
        return ctx.json({
          events: admin
            ? events
            : events.map((event) =>
                event.actorUserId === me.id
                  ? event
                  : { ...event, ipAddress: null, userAgent: null, sessionId: null },
              ),
          total,
        });
      },
    ),
    /**
     * Server only (no path, so not reachable over HTTP): records an event
     * of your own, e.g. `auth.api.recordAuditEvent({ body: { type:
     * "billing.plan-changed", userId } })`.
     */
    recordAuditEvent: createAuthEndpoint(
      {
        method: "POST",
        body: z.object({
          type: typeSchema.meta({ description: "The event type, e.g. `billing.plan-changed`" }),
          status: statusSchema.optional(),
          severity: severitySchema.optional(),
          userId: idSchema.optional().meta({ description: "The user the event is about" }),
          actorUserId: idSchema.optional().meta({ description: "The user who did it" }),
          organizationId: idSchema.optional(),
          errorCode: z.string().max(255).optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
        metadata: {
          openapi: { description: "Record an audit event. Server only" },
        },
      },
      async (ctx) => {
        const { metadata } = ctx.body;
        if (metadata && JSON.stringify(metadata).length > MAX_METADATA_LENGTH) {
          throw APIError.from("BAD_REQUEST", AUDIT_LOG_ERROR_CODES.METADATA_TOO_LARGE);
        }
        const event = await recorder.recordNow(
          ctx.context,
          ctx.body,
          ctx.request?.headers ?? ctx.headers,
        );
        return ctx.json({ event });
      },
    ),
    /**
     * Server only: deletes old events, for a cron job. Uses `retention.days`
     * unless `days` is passed.
     */
    deleteExpiredAuditEvents: createAuthEndpoint(
      {
        method: "POST",
        body: z.optional(
          z.object({
            days: z
              .number()
              .positive()
              .optional()
              .meta({ description: "Delete events older than this" }),
          }),
        ),
        metadata: {
          openapi: {
            description: "Delete audit events older than the retention period. Server only",
          },
        },
      },
      async (ctx) => {
        const days = ctx.body?.days ?? options.retention?.days;
        if (!days) {
          throw APIError.from("BAD_REQUEST", AUDIT_LOG_ERROR_CODES.RETENTION_NOT_CONFIGURED);
        }
        const deleted = await recorder.deleteOlderThan(
          ctx.context,
          new Date(Date.now() - days * 86_400_000),
        );
        if (deleted === null) {
          throw APIError.from("NOT_IMPLEMENTED", AUDIT_LOG_ERROR_CODES.DELETE_NOT_SUPPORTED);
        }
        return ctx.json({ deleted });
      },
    ),
    /**
     * Server only: sends every event still waiting in a destination's
     * batch and waits for running sends. Call it before the process
     * stops, or at the end of a serverless function without
     * `advanced.backgroundTasks`.
     */
    flushAuditDestinations: createAuthEndpoint(
      {
        method: "POST",
        metadata: {
          openapi: {
            description: "Send the events waiting for the audit log's destinations. Server only",
          },
        },
      },
      async (ctx) => {
        await recorder.destinations.flush();
        return ctx.json({ success: true });
      },
    ),
    /**
     * Server only: re-computes the hash chain and reports changed, deleted,
     * and unchained events. Reads every link, so run it from a job, not on
     * every request.
     */
    verifyAuditChain: createAuthEndpoint(
      {
        method: "POST",
        metadata: {
          openapi: {
            description: "Verify the audit log's hash chain. Server only",
          },
        },
      },
      async (ctx) => {
        const { chain } = recorder;
        if (!chain) {
          throw APIError.from("BAD_REQUEST", AUDIT_LOG_ERROR_CODES.HASH_CHAIN_NOT_ENABLED);
        }
        const storage = databaseStorage(ctx.context.adapter);
        return ctx.json(await chain.verify(ctx.context, (ids) => storage.readByIds(ids)));
      },
    ),
  } satisfies BetterAuthPlugin["endpoints"];
}
