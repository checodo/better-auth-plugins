import type { BetterAuthPlugin } from "@better-auth/core";
import { isAdmin } from "@repo/plugin-utils/admin";
import { recordAuditEvent } from "@repo/plugin-utils/audit";
import { runCallback } from "@repo/plugin-utils/callbacks";
import { paginationQuery } from "@repo/plugin-utils/pagination";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import * as z from "zod";
import { WAITLIST_ERROR_CODES } from "../error-codes";
import { approveEntry, TOKEN_LENGTH, toAdminEntry } from "../invite";
import {
  countEntries,
  createEntry,
  deleteEntry,
  findEntryByEmail,
  findEntryById,
  listEntries,
  updateEntryIf,
} from "../store";
import type {
  ResolvedWaitlistOptions,
  WaitlistAdminEntry,
  WaitlistEntry,
  WaitlistEntryStatus,
} from "../types";
import { normalizeEmail } from "../utils/email";
import { newSecret } from "../utils/secret";
import { emailSchema, MAX_EMAIL_LENGTH } from "./join";

const STATUSES = [
  "unconfirmed",
  "pending",
  "approved",
  "rejected",
  "registered",
] as const satisfies readonly WaitlistEntryStatus[];
/** Most entries one list or bulk-approve request handles. */
export const MAX_BATCH_SIZE = 100;

const statusSchema = z.enum(STATUSES).meta({ description: "The status of the entries" });
const idSchema = z.string().min(1).meta({ description: "The id of the waitlist entry" });

export function createAdminEndpoints(options: ResolvedWaitlistOptions) {
  const assertCanManage = (user: { id: string; role?: unknown }) => {
    if (!isAdmin(user, options)) {
      throw APIError.from("FORBIDDEN", WAITLIST_ERROR_CODES.YOU_ARE_NOT_ALLOWED_TO_MANAGE_WAITLIST);
    }
  };

  return {
    listWaitlistEntries: createAuthEndpoint(
      "/waitlist/list-entries",
      {
        method: "GET",
        use: [sessionMiddleware],
        query: z.optional(
          z.object({
            status: statusSchema.optional(),
            search: z
              .string()
              .max(MAX_EMAIL_LENGTH)
              .optional()
              .meta({ description: "Only entries whose email contains this text" }),
            ...paginationQuery({ defaultLimit: 50, maxLimit: MAX_BATCH_SIZE }),
          }),
        ),
        metadata: {
          openapi: { description: "List waitlist entries in the order they joined, oldest first" },
        },
      },
      async (ctx) => {
        assertCanManage(ctx.context.session.user);
        const query = {
          status: ctx.query?.status,
          search: ctx.query?.search ? normalizeEmail(ctx.query.search) : undefined,
        };
        const [entries, total] = await Promise.all([
          listEntries(ctx.context.adapter, {
            ...query,
            limit: ctx.query?.limit ?? 50,
            offset: ctx.query?.offset ?? 0,
          }),
          countEntries(ctx.context.adapter, query),
        ]);
        return ctx.json({ entries: entries.map((entry) => toAdminEntry(entry)), total });
      },
    ),
    getWaitlistStats: createAuthEndpoint(
      "/waitlist/get-stats",
      {
        method: "GET",
        use: [sessionMiddleware],
        metadata: { openapi: { description: "Count the waitlist entries per status" } },
      },
      async (ctx) => {
        assertCanManage(ctx.context.session.user);
        const counts = await Promise.all(
          STATUSES.map((status) => countEntries(ctx.context.adapter, { status })),
        );
        const stats = Object.fromEntries(STATUSES.map((status, i) => [status, counts[i] ?? 0]));
        return ctx.json({
          ...(stats as Record<WaitlistEntryStatus, number>),
          total: counts.reduce((sum, count) => sum + (count ?? 0), 0),
        });
      },
    ),
    approveWaitlistEntries: createAuthEndpoint(
      "/waitlist/approve-entries",
      {
        method: "POST",
        use: [sessionMiddleware],
        body: z
          .object({
            ids: z
              .array(idSchema)
              .min(1)
              .max(MAX_BATCH_SIZE)
              .optional()
              .meta({ description: "Approve these entries" }),
            count: z
              .number()
              .int()
              .min(1)
              .max(MAX_BATCH_SIZE)
              .optional()
              .meta({ description: "Approve the next `count` pending entries, oldest first" }),
          })
          .refine((body) => (body.ids === undefined) !== (body.count === undefined), {
            message: "Pass either `ids` or `count`",
          }),
        metadata: {
          openapi: {
            description:
              "Approve waitlist entries and send their invites. Approving an approved entry renews its invite; unconfirmed and registered entries are skipped",
          },
        },
      },
      async (ctx) => {
        const admin = ctx.context.session.user;
        assertCanManage(admin);
        const { adapter } = ctx.context;

        let candidates: WaitlistEntry[];
        if (ctx.body.ids) {
          const found = await Promise.all(ctx.body.ids.map((id) => findEntryById(adapter, id)));
          candidates = found.filter((entry): entry is WaitlistEntry => entry !== null);
        } else {
          candidates = await listEntries(adapter, {
            status: "pending",
            limit: ctx.body.count ?? 1,
          });
        }

        // Each with the invite code just issued: only its hash is stored.
        const entries: WaitlistAdminEntry[] = [];
        for (const entry of candidates) {
          // Unconfirmed emails haven't agreed to be contacted yet.
          if (entry.status === "registered" || entry.status === "unconfirmed") continue;
          const approved = await approveEntry(ctx.context, options, entry, admin.id);
          // `null`: changed by another request meanwhile (approved by
          // another admin, signed up, ...); skipped like the cases above.
          if (approved) entries.push(toAdminEntry(approved.entry, approved.inviteCode));
        }
        return ctx.json({ entries });
      },
    ),
    rejectWaitlistEntry: createAuthEndpoint(
      "/waitlist/reject-entry",
      {
        method: "POST",
        use: [sessionMiddleware],
        body: z.object({ id: idSchema }),
        metadata: {
          openapi: { description: "Reject a waitlist entry and invalidate its invite" },
        },
      },
      async (ctx) => {
        assertCanManage(ctx.context.session.user);
        const { adapter } = ctx.context;
        const entry = await findEntryById(adapter, ctx.body.id);
        if (!entry) throw APIError.from("NOT_FOUND", WAITLIST_ERROR_CODES.ENTRY_NOT_FOUND);
        if (entry.status === "registered") return ctx.json({ entry: toAdminEntry(entry) });

        // Only while the entry is as read, so a sign-up or approval that
        // happened meanwhile isn't overwritten.
        const updated = await updateEntryIf(
          adapter,
          entry.id,
          [{ field: "status", value: entry.status }],
          { status: "rejected", inviteCodeHash: null, inviteExpiresAt: null },
        );
        if (!updated) throw APIError.from("CONFLICT", WAITLIST_ERROR_CODES.ENTRY_CHANGED);
        await recordAuditEvent({
          type: "waitlist.rejected",
          severity: "medium",
          metadata: { entryId: updated.id, email: updated.email },
        });
        const rejected = toAdminEntry(updated);
        const { onReject } = options;
        if (onReject)
          await runCallback(ctx.context, "waitlist", "onReject", () => onReject(rejected));
        return ctx.json({ entry: rejected });
      },
    ),
    deleteWaitlistEntry: createAuthEndpoint(
      "/waitlist/delete-entry",
      {
        method: "POST",
        use: [sessionMiddleware],
        body: z.object({ id: idSchema }),
        metadata: { openapi: { description: "Delete a waitlist entry" } },
      },
      async (ctx) => {
        assertCanManage(ctx.context.session.user);
        const entry = await findEntryById(ctx.context.adapter, ctx.body.id);
        if (!entry) throw APIError.from("NOT_FOUND", WAITLIST_ERROR_CODES.ENTRY_NOT_FOUND);
        await deleteEntry(ctx.context.adapter, ctx.body.id);
        await recordAuditEvent({
          type: "waitlist.entry-deleted",
          severity: "medium",
          metadata: { entryId: entry.id, email: entry.email, status: entry.status },
        });
        return ctx.json({ success: true });
      },
    ),
    createWaitlistInvite: createAuthEndpoint(
      "/waitlist/create-invite",
      {
        method: "POST",
        use: [sessionMiddleware],
        body: z.object({
          email: emailSchema.meta({ description: "The email to invite" }),
        }),
        metadata: {
          openapi: {
            description:
              "Invite an email directly: adds it to the waitlist if needed, approves it (even if unconfirmed), and sends the invite",
          },
        },
      },
      async (ctx) => {
        const admin = ctx.context.session.user;
        assertCanManage(admin);
        const { adapter } = ctx.context;
        const email = normalizeEmail(ctx.body.email);

        let entry = await findEntryByEmail(adapter, email);
        if (!entry) {
          try {
            // The token is replaced on approval below, which emails it.
            entry = await createEntry(adapter, {
              email,
              status: "pending",
              tokenHash: (await newSecret(TOKEN_LENGTH)).hash,
              confirmationsSent: 0,
            });
          } catch (error) {
            // A concurrent request added the same email first (unique index).
            entry = await findEntryByEmail(adapter, email);
            if (!entry) throw error;
          }
        }
        if (entry.status === "registered") return ctx.json({ entry: toAdminEntry(entry) });
        const approved = await approveEntry(ctx.context, options, entry, admin.id);
        if (!approved) throw APIError.from("CONFLICT", WAITLIST_ERROR_CODES.ENTRY_CHANGED);
        return ctx.json({ entry: toAdminEntry(approved.entry, approved.inviteCode) });
      },
    ),
  } satisfies BetterAuthPlugin["endpoints"];
}
