import { resolveAdminOptions } from "@repo/plugin-utils/admin";
import type { ResolvedWaitlistOptions, WaitlistOptions } from "./types";
import { normalizeDomain, normalizeEmail } from "./utils/email";

const DEFAULT_INVITE_EXPIRES_IN = 60 * 60 * 24 * 7;
const DEFAULT_CONFIRMATION_EXPIRES_IN = 60 * 60 * 24 * 2;
const DEFAULT_SWEEP_INTERVAL = 60 * 60;
const DAY = 86_400_000;
/**
 * Longest duration an option may set, in days (about 100 years): a cutoff
 * further back would fall outside the range of a `Date`.
 */
const MAX_DAYS = 36_500;

function assertPositiveNumber(name: string, value: number | undefined, max = Infinity) {
  if (value !== undefined && !(Number.isFinite(value) && value > 0 && value <= max)) {
    const range = max === Infinity ? "a positive number" : `a positive number up to ${max}`;
    throw new Error(`[waitlist] "${name}" must be ${range}, got ${value}.`);
  }
}

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
  // In seconds; also a cutoff into the past (expired unconfirmed entries).
  assertPositiveNumber("confirmationExpiresIn", options.confirmationExpiresIn, MAX_DAYS * 86_400);

  const { rejected, registered, sweepInterval } = options.retention ?? {};
  assertPositiveNumber("retention.rejected", rejected, MAX_DAYS);
  assertPositiveNumber("retention.registered", registered, MAX_DAYS);
  assertPositiveNumber("retention.sweepInterval", sweepInterval);

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
    retention: {
      rejected: rejected === undefined ? undefined : rejected * DAY,
      registered: registered === undefined ? undefined : registered * DAY,
    },
    sweepInterval: (sweepInterval ?? DEFAULT_SWEEP_INTERVAL) * 1000,
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
