/**
 * What a docs code sample may use without importing it: the imports a
 * page's setup steps already showed, an `auth` and `authClient` with every
 * plugin, and placeholders for values the prose explains (a `token` from
 * an email, the signed-in `user`, ...).
 *
 * `scripts/check-snippets.mts` imports these into every sample that has no
 * imports of its own, then type-checks it. Samples with imports are
 * checked as they are.
 */
import { auditLog } from "@checodo/better-auth-audit-log";
import { auditLogClient } from "@checodo/better-auth-audit-log/client";
import { authentication } from "@checodo/better-auth-authentication";
import { authenticationClient } from "@checodo/better-auth-authentication/client";
import { blocklist } from "@checodo/better-auth-blocklist";
import { blocklistClient } from "@checodo/better-auth-blocklist/client";
import { referral } from "@checodo/better-auth-referral";
import { referralClient } from "@checodo/better-auth-referral/client";
import { securityAlerts } from "@checodo/better-auth-security-alerts";
import { securityAlertsClient } from "@checodo/better-auth-security-alerts/client";
import { waitlist } from "@checodo/better-auth-waitlist";
import { waitlistClient } from "@checodo/better-auth-waitlist/client";
import type { GenericEndpointContext } from "better-auth";
import { betterAuth } from "better-auth";
import { createAuthClient } from "better-auth/client";
import { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";
import { admin, emailOTP, magicLink, organization, username } from "better-auth/plugins";

export {
  AUDIT_LOG_ERROR_CODES,
  type AuditEvent,
  auditLog,
  memoryStorage,
} from "@checodo/better-auth-audit-log";
export { auditLogClient } from "@checodo/better-auth-audit-log/client";
export {
  AUTHENTICATION_CALLBACK_ERRORS,
  AUTHENTICATION_ERROR_CODES,
  authentication,
} from "@checodo/better-auth-authentication";
export { authenticationClient } from "@checodo/better-auth-authentication/client";
export { BLOCKLIST_ERROR_CODES, blocklist } from "@checodo/better-auth-blocklist";
export { blocklistClient } from "@checodo/better-auth-blocklist/client";
export { disposableEmailDomains, reservedUsernames } from "@checodo/better-auth-blocklist/lists";
export {
  EMAIL_VERIFIED_STEP,
  REFERRAL_ERROR_CODES,
  referral,
} from "@checodo/better-auth-referral";
export { referralClient } from "@checodo/better-auth-referral/client";
export {
  SECURITY_ALERTS_ERROR_CODES,
  securityAlerts,
} from "@checodo/better-auth-security-alerts";
export { securityAlertsClient } from "@checodo/better-auth-security-alerts/client";
export { WAITLIST_ERROR_CODES, waitlist } from "@checodo/better-auth-waitlist";
export { waitlistClient } from "@checodo/better-auth-waitlist/client";
export { betterAuth } from "better-auth";
export { createAuthClient } from "better-auth/client";
export { admin, organization, username } from "better-auth/plugins";

/** The server instance the samples call `auth.api` on. */
export const auth = betterAuth({
  plugins: [
    blocklist(),
    waitlist(),
    referral(),
    authentication({ steam: {} }),
    username(),
    admin(),
    organization({ teams: { enabled: true } }),
    magicLink({ sendMagicLink: async () => {} }),
    emailOTP({ sendVerificationOTP: async () => {} }),
    auditLog(),
    securityAlerts({ sendAlert: async () => {} }),
  ],
});

/** The client the samples call `authClient` on. */
export const authClient = createAuthClient({
  plugins: [
    blocklistClient(),
    waitlistClient(),
    referralClient(),
    authenticationClient(),
    auditLogClient(),
    securityAlertsClient(),
    magicLinkClient(),
    emailOTPClient(),
  ],
});

// Values the samples take from context (an email link, a form, the session).
export declare const token: string;
export declare const otp: string;
/** The `error` of a client call, as in `const { data, error } = await authClient...`. */
export declare const error: { code?: string; message?: string; status: number } | null;
export declare const code: string;
export declare const inviteCode: string;
export declare const referralCode: string;
export declare const email: string;
export declare const password: string;
export declare const name: string;
export declare const userId: string;
export declare const thingId: string;
export declare const user: { id: string; email: string };
export declare const headers: Headers;
export declare const request: Request;
export declare const ctx: GenericEndpointContext;
export declare const order: { id: string; userId: string };
export declare function alertSecurityTeam(event: unknown): Promise<void>;
export declare function saveFailures(rows: { at: Date; type: string }[]): Promise<void>;
export declare function storeEvents(events: unknown[]): Promise<void>;
export declare function grantCredit(
  userId: string,
  options?: { idempotencyKey?: string },
): Promise<void>;
export declare function looksLikeSelfReferral(
  referrerUserId: string,
  referredUser: { id: string; email: string },
  headers: Headers | null | undefined,
): Promise<boolean>;
export declare function sendEmail(message: {
  to: string;
  subject: string;
  text: string;
}): Promise<void>;
