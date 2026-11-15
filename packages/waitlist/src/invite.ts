import type { AuthContext } from "@better-auth/core";
import { recordAuditEvent } from "@repo/plugin-utils/audit";
import { runCallback } from "@repo/plugin-utils/callbacks";
import { updateEntry } from "./store";
import type { ResolvedWaitlistOptions, WaitlistAdminEntry, WaitlistEntry } from "./types";
import { newSecret } from "./utils/secret";

type Context = Pick<AuthContext, "adapter" | "logger" | "runInBackgroundOrAwait">;

export const INVITE_CODE_LENGTH = 32;
export const TOKEN_LENGTH = 32;

/**
 * An entry as admins and `onReject` see it: without the token, which only
 * the person on the waitlist gets (by email), so admins can't act as them,
 * and with `inviteCode` only when it was just issued (only its hash is
 * stored).
 */
export function toAdminEntry(
  { tokenHash: _tokenHash, inviteCodeHash: _inviteCodeHash, ...entry }: WaitlistEntry,
  inviteCode: string | null = null,
): WaitlistAdminEntry {
  return { ...entry, inviteCode };
}

/** Whether an approved entry's invite is still valid at `now`. */
export function isInviteValid(entry: WaitlistEntry, now = new Date()): boolean {
  if (entry.status !== "approved") return false;
  return !entry.inviteExpiresAt || new Date(entry.inviteExpiresAt).getTime() > now.getTime();
}

/**
 * Approves `entry` with a fresh invite code and expiry, then calls
 * `sendInvite`. Approving an already approved entry renews its invite.
 *
 * The invite email carries the entry's token for status and leave links.
 * Only its hash is stored, so unless the caller still has it (`token`,
 * right after joining or confirming), the entry gets a new token and
 * links from earlier emails stop working.
 */
export async function approveEntry(
  context: Context,
  options: ResolvedWaitlistOptions,
  entry: WaitlistEntry,
  approvedBy: string | null,
  token?: string | undefined,
): Promise<{ entry: WaitlistEntry; inviteCode: string }> {
  const now = new Date();
  const invite = await newSecret(INVITE_CODE_LENGTH);
  const newToken = token === undefined ? await newSecret(TOKEN_LENGTH) : null;
  const expiresAt =
    options.inviteExpiresIn > 0 ? new Date(now.getTime() + options.inviteExpiresIn) : null;
  const changes = {
    status: "approved" as const,
    inviteCodeHash: invite.hash,
    inviteExpiresAt: expiresAt,
    approvedAt: now,
    approvedBy,
    ...(newToken ? { tokenHash: newToken.hash } : {}),
  };

  const updated = (await updateEntry(context.adapter, entry.id, changes)) ?? {
    ...entry,
    ...changes,
  };

  await recordAuditEvent({
    type: "waitlist.approved",
    severity: "medium",
    // `null` when approved automatically (`autoApprove`): nobody acted.
    actorUserId: approvedBy,
    metadata: { entryId: updated.id, email: updated.email, renewed: entry.status === "approved" },
  });

  const { sendInvite } = options;
  if (sendInvite) {
    const linkToken = token ?? (newToken as { value: string }).value;
    await runCallback(context, "waitlist", "sendInvite", () =>
      sendInvite({ email: updated.email, inviteCode: invite.value, expiresAt, token: linkToken }),
    );
  }
  return { entry: updated, inviteCode: invite.value };
}

/**
 * Runs what follows once an email is really on the waitlist (confirmed,
 * or just joined without `confirmEmail`): `onJoin`, then `autoApprove`.
 * `token` is the entry's token, which the caller still has.
 */
export async function completeJoin(
  context: Context,
  options: ResolvedWaitlistOptions,
  entry: WaitlistEntry,
  token: string,
): Promise<void> {
  const { onJoin } = options;
  if (onJoin) {
    const { tokenHash: _tokenHash, inviteCodeHash: _inviteCodeHash, ...rest } = entry;
    await runCallback(context, "waitlist", "onJoin", () => onJoin({ ...rest, token }));
  }
  if (await options.autoApprove(entry.email)) {
    await approveEntry(context, options, entry, null, token);
  }
}

/** Whether the confirmation link of an `unconfirmed` entry still works at `now`. */
export function isConfirmationValid(
  entry: WaitlistEntry,
  options: Pick<ResolvedWaitlistOptions, "confirmationExpiresIn">,
  now = new Date(),
): boolean {
  // `updatedAt` is when the confirmation link was last sent.
  return new Date(entry.updatedAt).getTime() + options.confirmationExpiresIn > now.getTime();
}

/** Calls `sendConfirmationEmail` for an `unconfirmed` entry, with its (plain) `token`. */
export async function sendConfirmation(
  context: Pick<AuthContext, "logger" | "runInBackgroundOrAwait">,
  options: ResolvedWaitlistOptions,
  entry: WaitlistEntry,
  token: string,
): Promise<void> {
  const { sendConfirmationEmail } = options;
  if (!sendConfirmationEmail) return;
  const expiresAt = new Date(new Date(entry.updatedAt).getTime() + options.confirmationExpiresIn);
  await runCallback(context, "waitlist", "sendConfirmationEmail", () =>
    sendConfirmationEmail({ email: entry.email, token, expiresAt }),
  );
}
