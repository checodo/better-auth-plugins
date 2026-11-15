import { resolveAdminOptions } from "@repo/plugin-utils/admin";
import type { ResolvedWaitlistOptions, WaitlistOptions } from "./types";
import { normalizeDomain, normalizeEmail } from "./utils/email";

const DEFAULT_INVITE_EXPIRES_IN = 60 * 60 * 24 * 7;
const DEFAULT_CONFIRMATION_EXPIRES_IN = 60 * 60 * 24 * 2;

function assertNonNegativeNumber(name: string, value: number | undefined) {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`[waitlist] "${name}" must be a non-negative number, got ${value}.`);
  }
}

/** Resolves defaults and validates the options once, at plugin creation. */
export function resolveOptions(options: WaitlistOptions): ResolvedWaitlistOptions {
  assertNonNegativeNumber("inviteExpiresIn", options.inviteExpiresIn);
  assertNonNegativeNumber("maxEntries", options.maxEntries);
  assertNonNegativeNumber("confirmationExpiresIn", options.confirmationExpiresIn);
  if (options.confirmationExpiresIn === 0) {
    throw new Error("[waitlist] `confirmationExpiresIn` must be greater than 0.");
  }

  const confirmEmail = options.confirmEmail ?? true;
  if (confirmEmail && !options.sendConfirmationEmail) {
    throw new Error(
      "[waitlist] Double opt-in is on by default and needs `sendConfirmationEmail` to send the confirmation link. Pass it, or set `confirmEmail: false`.",
    );
  }

  const allowEmails = new Set<string>();
  const allowDomains: string[] = [];
  for (const value of options.allow ?? []) {
    if (value.trim() === "") throw new Error("[waitlist] Empty entry in `allow`.");
    if (value.includes("@") && !value.trim().startsWith("@")) {
      allowEmails.add(normalizeEmail(value));
    } else {
      allowDomains.push(normalizeDomain(value));
    }
  }

  const autoApprove = options.autoApprove ?? false;

  return {
    enabled: options.enabled ?? true,
    autoApprove: typeof autoApprove === "function" ? autoApprove : () => autoApprove,
    requireInviteCode: options.requireInviteCode ?? false,
    inviteExpiresIn: (options.inviteExpiresIn ?? DEFAULT_INVITE_EXPIRES_IN) * 1000,
    confirmEmail,
    sendConfirmationEmail: options.sendConfirmationEmail,
    confirmationExpiresIn:
      (options.confirmationExpiresIn ?? DEFAULT_CONFIRMATION_EXPIRES_IN) * 1000,
    allowEmails,
    allowDomains,
    bypass: options.bypass ?? ((context) => context?.path === "/admin/create-user"),
    maxEntries: options.maxEntries,
    ...resolveAdminOptions(options),
    onJoin: options.onJoin,
    sendInvite: options.sendInvite,
    onReject: options.onReject,
  };
}
