import type { BetterAuthPlugin } from "@better-auth/core";
import { recordAuditEvent } from "@repo/plugin-utils/audit";
import { APIError, createAuthEndpoint } from "better-auth/api";
import * as z from "zod";
import { WAITLIST_ERROR_CODES } from "../error-codes";
import {
  completeJoin,
  isConfirmationValid,
  isInviteValid,
  sendConfirmation,
  TOKEN_LENGTH,
} from "../invite";
import {
  countPendingBefore,
  countWaitingEntries,
  createEntry,
  deleteEntry,
  deleteStaleUnconfirmedEntries,
  findEntryByEmail,
  findEntryByInviteCodeHash,
  findEntryByTokenHash,
  updateEntryIf,
} from "../store";
import type { ResolvedWaitlistOptions, WaitlistEntry } from "../types";
import { normalizeEmail } from "../utils/email";
import { hashSecret, newSecret } from "../utils/secret";

/** Longest stored email. The unique index makes the column a bounded string on MySQL and SQL Server. */
export const MAX_EMAIL_LENGTH = 255;
/** An email, trimmed before it is validated (normalized later with `normalizeEmail`). */
export const emailSchema = z.string().trim().pipe(z.email().max(MAX_EMAIL_LENGTH));

/** Longest JSON-encoded `metadata`. */
export const MAX_METADATA_LENGTH = 2000;

/**
 * Joining again with an unconfirmed email resends the confirmation link,
 * but at most once per this many milliseconds...
 */
export const CONFIRMATION_RESEND_INTERVAL = 5 * 60_000;
/**
 * ...and at most this many confirmation emails per entry in total (the
 * first one plus 3 resends). Whoever types an email into the join form
 * needn't own it, so this caps what anyone can make the app send to an
 * address: 4 emails until the entry expires (`confirmationExpiresIn`).
 */
export const MAX_CONFIRMATION_EMAILS = 4;

const tokenSchema = z
  .string()
  .min(1)
  .max(64)
  .meta({ description: "The token from the link sent to the email" });

export function createJoinEndpoints(options: ResolvedWaitlistOptions) {
  /** The entry for a link token, or `INVALID_TOKEN`. Unconfirmed entries expire. */
  const entryForToken = async (
    adapter: Parameters<typeof findEntryByTokenHash>[0],
    token: string,
  ): Promise<WaitlistEntry> => {
    const entry = await findEntryByTokenHash(adapter, await hashSecret(token));
    if (!entry || (entry.status === "unconfirmed" && !isConfirmationValid(entry, options))) {
      throw APIError.from("BAD_REQUEST", WAITLIST_ERROR_CODES.INVALID_TOKEN);
    }
    return entry;
  };

  const isFull = async (adapter: Parameters<typeof countWaitingEntries>[0]) =>
    options.maxEntries !== undefined && (await countWaitingEntries(adapter)) >= options.maxEntries;
  /**
   * Checked again after an entry is added: concurrent requests can all
   * pass `isFull` for the last place. Each one that finds the waitlist
   * over `maxEntries` takes its entry back, so it never holds more; under
   * a race, all of them may (the waitlist then has room for a retry).
   */
  const isOverfilled = async (adapter: Parameters<typeof countWaitingEntries>[0]) =>
    options.maxEntries !== undefined && (await countWaitingEntries(adapter)) > options.maxEntries;

  return {
    joinWaitlist: createAuthEndpoint(
      "/waitlist/join",
      {
        method: "POST",
        body: z.object({
          email: emailSchema.meta({ description: "The email to put on the waitlist" }),
          metadata: z
            .record(z.string(), z.unknown())
            .optional()
            .meta({ description: "Extra data to keep with the entry, e.g. a referral source" }),
        }),
        metadata: {
          openapi: {
            description:
              "Join the waitlist. Answers the same way whether the email is new, already on the waitlist, or already has an account",
          },
        },
      },
      async (ctx) => {
        const email = normalizeEmail(ctx.body.email);
        const metadata = ctx.body.metadata ? JSON.stringify(ctx.body.metadata) : undefined;
        if (metadata && metadata.length > MAX_METADATA_LENGTH) {
          throw APIError.from("BAD_REQUEST", WAITLIST_ERROR_CODES.METADATA_TOO_LARGE);
        }
        const { adapter, internalAdapter } = ctx.context;

        if (options.confirmEmail) {
          await deleteStaleUnconfirmedEntries(
            adapter,
            new Date(Date.now() - options.confirmationExpiresIn),
          );
        }

        // Checked first and for every email, so a full waitlist doesn't
        // reveal which emails are already on it. Unconfirmed entries don't
        // count: they expire, and fake sign-ups must not fill the waitlist.
        if (await isFull(adapter)) {
          throw APIError.from("FORBIDDEN", WAITLIST_ERROR_CODES.WAITLIST_FULL);
        }

        const existing = await findEntryByEmail(adapter, email);
        if (existing?.status === "unconfirmed") {
          // Joining again sends the confirmation link again, valid for
          // another `confirmationExpiresIn`, within the resend limits.
          // The answer is the same whether an email goes out or not.
          const lastSent = new Date(existing.updatedAt).getTime();
          const sent = existing.confirmationsSent ?? 1;
          if (
            sent < MAX_CONFIRMATION_EMAILS &&
            Date.now() - lastSent >= CONFIRMATION_RESEND_INTERVAL
          ) {
            // Only the hash of the old token is stored: the new email gets
            // a new token, and the old link stops working. The update only
            // applies while the old token is current, so of concurrent
            // joins exactly one renews the link and sends the email.
            const token = await newSecret(TOKEN_LENGTH);
            const renewed = await updateEntryIf(
              adapter,
              existing.id,
              [
                { field: "status", value: "unconfirmed" },
                { field: "tokenHash", value: existing.tokenHash },
              ],
              { confirmationsSent: sent + 1, tokenHash: token.hash },
            );
            if (renewed) await sendConfirmation(ctx.context, options, renewed, token.value);
          }
          return ctx.json({ success: true });
        }
        if (existing || (await internalAdapter.findUserByEmail(email))) {
          return ctx.json({ success: true });
        }

        const token = await newSecret(TOKEN_LENGTH);
        let entry: WaitlistEntry;
        try {
          entry = await createEntry(adapter, {
            email,
            status: options.confirmEmail ? "unconfirmed" : "pending",
            tokenHash: token.hash,
            confirmationsSent: options.confirmEmail ? 1 : 0,
            metadata,
          });
        } catch (error) {
          // A concurrent request added the same email first (unique index).
          if (await findEntryByEmail(adapter, email)) return ctx.json({ success: true });
          throw error;
        }

        if (options.confirmEmail) {
          await sendConfirmation(ctx.context, options, entry, token.value);
        } else {
          if (await isOverfilled(adapter)) {
            await deleteEntry(adapter, entry.id);
            throw APIError.from("FORBIDDEN", WAITLIST_ERROR_CODES.WAITLIST_FULL);
          }
          await completeJoin(ctx.context, options, entry, token.value);
        }
        return ctx.json({ success: true });
      },
    ),
    confirmWaitlistEmail: createAuthEndpoint(
      "/waitlist/confirm",
      {
        method: "POST",
        body: z.object({ token: tokenSchema }),
        metadata: {
          openapi: {
            description:
              "Confirm the email of a waitlist entry with the token from the confirmation link (double opt-in)",
          },
        },
      },
      async (ctx) => {
        const { adapter } = ctx.context;
        const entry = await entryForToken(adapter, ctx.body.token);
        // Confirming twice (e.g. the link opened again) is fine.
        if (entry.status !== "unconfirmed") return ctx.json({ success: true });
        if (await isFull(adapter)) {
          throw APIError.from("FORBIDDEN", WAITLIST_ERROR_CODES.WAITLIST_FULL);
        }

        // Only applies while the entry is unconfirmed with this token: of
        // concurrent confirmations, exactly one goes on to `completeJoin`;
        // the others answer like a repeated confirmation.
        const sameToken = { field: "tokenHash", value: entry.tokenHash } as const;
        const confirmed = await updateEntryIf(
          adapter,
          entry.id,
          [{ field: "status", value: "unconfirmed" }, sameToken],
          { status: "pending", confirmedAt: new Date() },
        );
        if (!confirmed) return ctx.json({ success: true });
        if (await isOverfilled(adapter)) {
          // Back to unconfirmed, with the link's expiry unchanged. Only if
          // nothing else (an admin's approval) changed the entry since.
          await updateEntryIf(
            adapter,
            entry.id,
            [{ field: "status", value: "pending" }, sameToken],
            {
              status: "unconfirmed",
              confirmedAt: null,
              updatedAt: new Date(entry.updatedAt),
            },
          );
          throw APIError.from("FORBIDDEN", WAITLIST_ERROR_CODES.WAITLIST_FULL);
        }
        // A second record of the confirmation, apart from the entry (and
        // tamper-evident with the audit log's hash chain). Nobody is signed in.
        await recordAuditEvent({
          type: "waitlist.confirmed",
          severity: "low",
          userId: null,
          actorUserId: null,
          metadata: { entryId: confirmed.id, email: confirmed.email },
        });
        await completeJoin(ctx.context, options, confirmed, ctx.body.token);
        return ctx.json({ success: true });
      },
    ),
    getWaitlistStatus: createAuthEndpoint(
      "/waitlist/get-status",
      {
        method: "GET",
        query: z.object({ token: tokenSchema }),
        metadata: {
          openapi: {
            description:
              "Get the status of a waitlist entry, and its position while pending, with the token from a link sent to its email",
          },
        },
      },
      async (ctx) => {
        const entry = await entryForToken(ctx.context.adapter, ctx.query.token);
        const position =
          entry.status === "pending"
            ? (await countPendingBefore(ctx.context.adapter, entry)) + 1
            : null;
        return ctx.json({
          email: entry.email,
          status: entry.status,
          position,
          inviteExpiresAt: entry.status === "approved" ? (entry.inviteExpiresAt ?? null) : null,
        });
      },
    ),
    leaveWaitlist: createAuthEndpoint(
      "/waitlist/leave",
      {
        method: "POST",
        body: z.object({ token: tokenSchema }),
        metadata: {
          openapi: {
            description:
              "Leave the waitlist: deletes the entry, with the token from a link sent to its email",
          },
        },
      },
      async (ctx) => {
        const entry = await entryForToken(ctx.context.adapter, ctx.body.token);
        // The entry is gone; the event is what's left of the person leaving.
        // Once, also when the link is opened several times at once.
        if (!(await deleteEntry(ctx.context.adapter, entry.id))) return ctx.json({ success: true });
        await recordAuditEvent({
          type: "waitlist.left",
          severity: "low",
          userId: null,
          actorUserId: null,
          metadata: { entryId: entry.id, email: entry.email, status: entry.status },
        });
        return ctx.json({ success: true });
      },
    ),
    checkWaitlistInvite: createAuthEndpoint(
      "/waitlist/check-invite",
      {
        method: "GET",
        query: z.object({
          code: z.string().min(1).max(64).meta({ description: "The invite code" }),
        }),
        metadata: {
          openapi: {
            description:
              "Check whether an invite code is valid, e.g. before showing a sign-up form",
          },
        },
      },
      async (ctx) => {
        const entry = await findEntryByInviteCodeHash(
          ctx.context.adapter,
          await hashSecret(ctx.query.code),
        );
        // The email isn't returned: the code alone must not reveal who it belongs to.
        return ctx.json({ valid: !!entry && isInviteValid(entry) });
      },
    ),
  } satisfies BetterAuthPlugin["endpoints"];
}
