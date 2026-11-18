import type { AuthContext, BetterAuthOptions, GenericEndpointContext } from "@better-auth/core";
import { getCurrentAdapter } from "@better-auth/core/context";
import { eraseOnUserDelete } from "@repo/plugin-utils/user-data";
import { APIError, getOAuthState } from "better-auth/api";
import { constantTimeEqual } from "better-auth/crypto";
import { WAITLIST_ERROR_CODES } from "../error-codes";
import { isInviteValid } from "../invite";
import { deleteEntryByEmail, findEntryByEmail, updateEntry } from "../store";
import type { ResolvedWaitlistOptions } from "../types";
import { isAllowedEmail, normalizeEmail } from "../utils/email";
import { hashSecret } from "../utils/secret";

export const INVITE_CODE_HEADER = "x-invite-code";

/**
 * The invite code sent with the request that creates the user: the
 * `inviteCode` field of the sign-up body, the `x-invite-code` header, or
 * `additionalData.inviteCode` of an OAuth sign-in (read on the callback).
 */
async function readInviteCode(context: GenericEndpointContext | null): Promise<string | undefined> {
  const body = context?.body as Record<string, unknown> | undefined;
  if (typeof body?.inviteCode === "string" && body.inviteCode) return body.inviteCode;

  const header = context?.headers?.get(INVITE_CODE_HEADER);
  if (header) return header;

  try {
    const state = await getOAuthState<{ inviteCode?: unknown }>();
    if (typeof state?.inviteCode === "string" && state.inviteCode) return state.inviteCode;
  } catch {
    // Not inside an OAuth flow.
  }
  return undefined;
}

/**
 * Lets a user be created only for an approved email (see `enabled`,
 * `allow`, `bypass`, `requireInviteCode`), whichever endpoint creates it:
 * email sign-up, OAuth, magic link, email OTP, anonymous upgrades, or
 * server code. Afterwards, marks the entry `registered` so its invite
 * can't be used again.
 */
export function createDatabaseHooks(
  authContext: AuthContext,
  options: ResolvedWaitlistOptions,
): BetterAuthOptions["databaseHooks"] {
  const adapterFor = (context: GenericEndpointContext | null | undefined) =>
    getCurrentAdapter(context?.context.adapter ?? authContext.adapter);

  return {
    user: {
      create: {
        before: async (user, context) => {
          if (!options.enabled) return;
          const email = typeof user.email === "string" ? normalizeEmail(user.email) : "";
          if (email && isAllowedEmail(email, options)) return;
          if (options.bypass(context ?? null)) return;

          // With requireInviteCode, the code is checked before the entry
          // and every failure looks the same, so sign-up attempts don't
          // reveal whether an email is approved.
          const inviteCode = options.requireInviteCode
            ? await readInviteCode(context ?? null)
            : undefined;
          if (options.requireInviteCode && !inviteCode) {
            throw APIError.from("FORBIDDEN", WAITLIST_ERROR_CODES.INVITE_CODE_REQUIRED);
          }

          const db = await adapterFor(context);
          const entry = email ? await findEntryByEmail(db, email) : null;
          const approved = !!entry && isInviteValid(entry);
          if (inviteCode !== undefined) {
            if (
              !approved ||
              !entry.inviteCodeHash ||
              !constantTimeEqual(await hashSecret(inviteCode), entry.inviteCodeHash)
            ) {
              throw APIError.from("FORBIDDEN", WAITLIST_ERROR_CODES.INVALID_INVITE_CODE);
            }
          } else if (!approved) {
            throw APIError.from("FORBIDDEN", WAITLIST_ERROR_CODES.EMAIL_NOT_APPROVED);
          }
        },
        after: async (user, context) => {
          if (typeof user.email !== "string") return;
          const db = await adapterFor(context);
          const entry = await findEntryByEmail(db, normalizeEmail(user.email));
          if (!entry || entry.status === "registered") return;
          // Recorded even while the gate is off or the email is allowed,
          // so the waitlist shows who has signed up.
          await updateEntry(db, entry.id, {
            status: "registered",
            registeredAt: new Date(),
            inviteCodeHash: null,
            inviteExpiresAt: null,
          });
        },
      },
      // The entry holds the email address: it goes with the user.
      delete: {
        after: eraseOnUserDelete(authContext, "waitlist", "the waitlist entry", async (user) => {
          if (user.email) await deleteEntryByEmail(authContext.adapter, normalizeEmail(user.email));
        }),
      },
    },
  };
}
