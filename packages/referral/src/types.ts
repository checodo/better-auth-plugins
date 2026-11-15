import type { GenericEndpointContext } from "@better-auth/core";
import type { InferOptionSchema } from "better-auth";
import type { ReferralSchema } from "./schema";

/**
 * - `pending`    the referred user signed up; required `steps` are still open
 * - `completed`  every required step is done; `onReferralCompleted` has run
 */
export type ReferralStatus = "pending" | "completed";

/** A user's referral code, as stored in the `referralCode` table. */
export interface ReferralCode {
  id: string;
  userId: string;
  /** Uppercase. */
  code: string;
  createdAt: Date;
}

/** A referral, as stored in the `referral` table. */
export interface Referral {
  id: string;
  /** The user whose code was used. */
  referrerUserId: string;
  /** The user who signed up with it. Unique: a user is referred at most once. */
  referredUserId: string;
  /** The code used at sign-up. */
  code: string;
  status: ReferralStatus;
  completedAt?: Date | null | undefined;
  createdAt: Date;
}

/** A completed step of a referral, as stored in the `referralStep` table. */
export interface ReferralStep {
  id: string;
  referralId: string;
  step: string;
  /** JSON-encoded `metadata` passed when the step was completed. */
  metadata?: string | null | undefined;
  completedAt: Date;
}

/** A referral with the steps completed so far. */
export interface ReferralWithSteps extends Referral {
  steps: string[];
}

/** What `allowReferral` decides on. */
export interface ReferralCandidate {
  referrerUserId: string;
  referredUser: { id: string; email: string };
  code: string;
  /** The request that created the user, `null` outside a request. */
  context: GenericEndpointContext | null;
}

export interface ReferralOptions {
  /** Length of generated codes. Between 6 and 32. Defaults to `8`. */
  codeLength?: number | undefined;
  /**
   * Generates codes instead of the built-in generator (random, without
   * look-alike characters such as `0`/`O` and `1`/`I`). Codes may use
   * letters, digits, `-`, and `_` (4 to 64 characters) and are stored in
   * uppercase. Collisions are retried.
   */
  generateCode?: (() => string | Promise<string>) | undefined;
  /** Give every new user a code when they sign up, not only on `createCode`. Defaults to `false`. */
  createCodeOnSignUp?: boolean | undefined;
  /**
   * Steps a referred user must complete before the referral counts, after
   * signing up, e.g. `["email-verified", "first-purchase"]`.
   * `"email-verified"` is recorded automatically when the user's email is
   * verified; record your own steps with `auth.api.completeReferralStep`.
   * With `[]`, a referral completes at sign-up, which makes fake sign-ups
   * worth rewards.
   *
   * Defaults to `["email-verified"]` when the app sends verification emails
   * (`emailVerification.sendVerificationEmail`), otherwise to `[]`.
   */
  steps?: readonly string[] | undefined;
  /**
   * How many users one user can refer, across all their codes:
   * `regenerateCode` doesn't reset the count. Unlimited by default.
   */
  maxReferralsPerUser?: number | undefined;
  /**
   * What happens when someone signs up with a code that doesn't exist or
   * whose owner has reached `maxReferralsPerUser`: `"ignore"` signs them up without a
   * referral, `"reject"` fails the sign-up with `INVALID_REFERRAL_CODE`.
   * Defaults to `"ignore"`.
   */
  invalidCode?: "ignore" | "reject" | undefined;
  /**
   * Decides whether a sign-up with a valid code counts as a referral, e.g.
   * to skip sign-ups from the referrer's own IP address. Returning `false`
   * (or throwing, which is logged) signs the user up without a referral.
   */
  allowReferral?: ((candidate: ReferralCandidate) => boolean | Promise<boolean>) | undefined;
  /** Called when a referral is recorded at sign-up. Errors are logged. */
  onReferral?: ((referral: Referral) => void | Promise<void>) | undefined;
  /** Called when a step of a referral is completed for the first time. Errors are logged. */
  onStepCompleted?:
    | ((details: { referral: Referral; step: string }) => void | Promise<void>)
    | undefined;
  /**
   * Called once per referral, when every required step is done: grant
   * rewards here. Errors are logged.
   */
  onReferralCompleted?: ((referral: Referral) => void | Promise<void>) | undefined;
  /**
   * Show referrers the emails of the users they referred only masked
   * (`a***@example.com`). Defaults to `true`.
   */
  maskEmails?: boolean | undefined;
  /** Don't show referrers the names of the users they referred. Defaults to `false`. */
  hideNames?: boolean | undefined;
  /**
   * Users with one of these roles (the `role` field of better-auth's
   * `admin` plugin) may list all referrals. Defaults to `["admin"]`.
   */
  adminRoles?: readonly string[] | undefined;
  /** Users with these ids may list all referrals, whatever their role. */
  adminUserIds?: readonly string[] | undefined;
  /**
   * Rename the plugin's tables or their columns, like better-auth's own
   * plugins: `{ referral: { modelName: "referrals" } }`.
   */
  schema?: InferOptionSchema<ReferralSchema> | undefined;
}

export interface ResolvedReferralOptions {
  codeLength: number;
  generateCode: ReferralOptions["generateCode"];
  createCodeOnSignUp: boolean;
  /** Settled in `init`, see `applyAuthDefaults`. */
  steps: readonly string[];
  /** Whether `steps` was passed, rather than defaulted. */
  stepsConfigured: boolean;
  maxReferralsPerUser: number | undefined;
  invalidCode: "ignore" | "reject";
  allowReferral: ReferralOptions["allowReferral"];
  onReferral: ReferralOptions["onReferral"];
  onStepCompleted: ReferralOptions["onStepCompleted"];
  onReferralCompleted: ReferralOptions["onReferralCompleted"];
  maskEmails: boolean;
  hideNames: boolean;
  adminRoles: readonly string[];
  adminUserIds: readonly string[];
}
