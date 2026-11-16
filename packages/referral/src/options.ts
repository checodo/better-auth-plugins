import type { AuthContext } from "@better-auth/core";
import { resolveAdminOptions } from "@repo/plugin-utils/admin";
import { createFail } from "@repo/plugin-utils/options";
import type { ReferralOptions, ResolvedReferralOptions } from "./types";

/** The step every referral starts with. Not configurable, and not stored. */
export const SIGN_UP_STEP = "sign-up";
/** A step the plugin records itself, when the referred user's email is verified. */
export const EMAIL_VERIFIED_STEP = "email-verified";
/** Longest step name. Part of a unique index, so bounded. */
export const MAX_STEP_LENGTH = 64;

const fail = createFail("referral");

/** Resolves defaults and validates the options once, at plugin creation. */
export function resolveOptions(options: ReferralOptions): ResolvedReferralOptions {
  const codeLength = options.codeLength ?? 8;
  if (!Number.isInteger(codeLength) || codeLength < 6 || codeLength > 32) {
    fail(`"codeLength" must be an integer between 6 and 32, got ${codeLength}.`);
  }

  const max = options.maxReferralsPerUser;
  if (max !== undefined && (!Number.isInteger(max) || max < 1)) {
    fail(`"maxReferralsPerUser" must be a positive integer, got ${max}.`);
  }

  const delay = options.rewardRetry?.delay ?? 5 * 60_000;
  if (!Number.isInteger(delay) || delay < 1000) {
    fail(`"rewardRetry.delay" must be an integer of at least 1000 (ms), got ${delay}.`);
  }
  const maxAttempts = options.rewardRetry?.maxAttempts ?? 10;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    fail(`"rewardRetry.maxAttempts" must be a positive integer, got ${maxAttempts}.`);
  }

  const steps = [...(options.steps ?? [])];
  for (const step of steps) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(step) || step.length > MAX_STEP_LENGTH) {
      fail(
        `Invalid step ${JSON.stringify(step)}: use letters, digits, "-", and "_", up to ${MAX_STEP_LENGTH} characters.`,
      );
    }
    if (step === SIGN_UP_STEP) {
      fail(`"${SIGN_UP_STEP}" is always the first step; don't list it in "steps".`);
    }
  }
  if (new Set(steps).size !== steps.length) fail(`"steps" lists a step twice.`);

  return {
    codeLength,
    generateCode: options.generateCode,
    createCodeOnSignUp: options.createCodeOnSignUp ?? false,
    steps,
    stepsConfigured: options.steps !== undefined,
    maxReferralsPerUser: max,
    invalidCode: options.invalidCode ?? "ignore",
    allowReferral: options.allowReferral,
    onReferral: options.onReferral,
    onStepCompleted: options.onStepCompleted,
    onReferralCompleted: options.onReferralCompleted,
    rewardRetry: { delay, maxAttempts },
    maskEmails: options.maskEmails ?? true,
    hideNames: options.hideNames ?? false,
    ...resolveAdminOptions(options),
  };
}

/**
 * Defaults that depend on the app's auth config, applied in the plugin's
 * `init`: without explicit `steps`, apps that send verification emails
 * require `email-verified`, so fake sign-ups don't complete referrals.
 * Warns when referrals earn rewards but complete at sign-up.
 */
export function applyAuthDefaults(
  options: ResolvedReferralOptions,
  ctx: Pick<AuthContext, "options" | "logger">,
): void {
  // Settled once per auth instance, before any request reads `steps`.
  if (!options.stepsConfigured && ctx.options.emailVerification?.sendVerificationEmail) {
    options.steps = [EMAIL_VERIFIED_STEP];
  }
  // An explicit `steps: []` is a choice; only warn about the default.
  if (!options.stepsConfigured && options.steps.length === 0 && options.onReferralCompleted) {
    ctx.logger.warn(
      '[referral] Referrals complete at sign-up (no "steps"), so fake sign-ups earn rewards. ' +
        'Require at least "email-verified" (see "Steps and rewards" in the referral plugin docs).',
    );
  }
}
