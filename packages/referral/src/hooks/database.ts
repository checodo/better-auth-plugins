import type { AuthContext, BetterAuthOptions, GenericEndpointContext } from "@better-auth/core";
import { getCurrentAdapter, queueAfterTransactionHook } from "@better-auth/core/context";
import { APIError, getOAuthState } from "better-auth/api";
import { REFERRAL_ERROR_CODES } from "../error-codes";
import { EMAIL_VERIFIED_STEP } from "../options";
import {
  claimReferralPlace,
  findUsableCode,
  getOrCreateCode,
  recordStep,
  referralCreated,
} from "../referrals";
import { createReferral, deleteReferral, findReferralByReferredUserId } from "../store";
import type { Referral, ResolvedReferralOptions } from "../types";

export const REFERRAL_CODE_HEADER = "x-referral-code";
/** Longest code read from a request; longer values are ignored. */
const MAX_CODE_INPUT_LENGTH = 128;

/**
 * The referral code sent with the request that creates the user: the
 * `referralCode` field of the sign-up body, the `x-referral-code` header,
 * or `additionalData.referralCode` of a social sign-in (read on the
 * callback).
 */
async function readReferralCode(
  context: GenericEndpointContext | null | undefined,
): Promise<string | undefined> {
  const valid = (value: unknown): value is string =>
    typeof value === "string" && value.trim() !== "" && value.length <= MAX_CODE_INPUT_LENGTH;

  const body = context?.body as Record<string, unknown> | undefined;
  if (valid(body?.referralCode)) return body.referralCode;

  const header = context?.headers?.get(REFERRAL_CODE_HEADER);
  if (valid(header)) return header;

  try {
    const state = await getOAuthState<{ referralCode?: unknown }>();
    if (valid(state?.referralCode)) return state.referralCode;
  } catch {
    // Not inside an OAuth flow.
  }
  return undefined;
}

/**
 * Attributes new users to the code they signed up with, whichever way
 * they sign up, and records the `email-verified` step. Failures after the
 * user exists are logged, never returned: a referral problem must not
 * fail a sign-up that already happened.
 */
export function createDatabaseHooks(
  authContext: AuthContext,
  options: ResolvedReferralOptions,
): BetterAuthOptions["databaseHooks"] {
  const contextFor = (context: GenericEndpointContext | null | undefined) =>
    context?.context ?? authContext;
  const tracksEmailVerified = options.steps.includes(EMAIL_VERIFIED_STEP);
  /** Requests whose user update sets `emailVerified: true` (see `update.before`). */
  const verifying = new WeakSet<object>();

  const attribute = async (
    user: { id: string; email: string; emailVerified?: boolean },
    context: GenericEndpointContext | null | undefined,
  ) => {
    const ctx = contextFor(context);
    const adapter = await getCurrentAdapter(ctx.adapter);

    if (options.createCodeOnSignUp) await getOrCreateCode(adapter, options, user.id);

    const rawCode = await readReferralCode(context);
    if (!rawCode) return;
    const code = await findUsableCode(adapter, options, rawCode);
    if (!code || code.userId === user.id) return;

    if (options.allowReferral) {
      let allowed = false;
      try {
        allowed = await options.allowReferral({
          referrerUserId: code.userId,
          referredUser: { id: user.id, email: user.email },
          code: code.code,
          context: context ?? null,
        });
      } catch (error) {
        ctx.logger.error("[referral] allowReferral threw an error", error);
      }
      if (!allowed) return;
    }

    let referral: Referral;
    try {
      referral = await createReferral(adapter, {
        referrerUserId: code.userId,
        referredUserId: user.id,
        code: code.code,
        status: options.steps.length === 0 ? "completed" : "pending",
      });
    } catch (error) {
      // Already referred (unique index): keep the first referral.
      if (await findReferralByReferredUserId(adapter, user.id)) return;
      throw error;
    }

    // Settled once the user's transaction (if any) is committed, so
    // nothing is announced for a sign-up that was rolled back, and a
    // place of `maxReferralsPerUser` is taken outside it: a conflict on
    // the place's unique key can't abort the sign-up.
    const settle = async () => {
      try {
        const max = options.maxReferralsPerUser;
        if (max !== undefined && !(await claimReferralPlace(ctx.adapter, max, referral))) {
          // Signed up while the last free places were taken: no referral.
          await deleteReferral(ctx.adapter, referral.id);
          return;
        }
        await referralCreated(ctx, options, referral);
        if (tracksEmailVerified && user.emailVerified) {
          await recordStep(ctx.adapter, ctx, options, referral, EMAIL_VERIFIED_STEP);
        }
      } catch (error) {
        ctx.logger.error("[referral] failed to record the referral", error);
      }
    };
    if (adapter === ctx.adapter) await settle();
    else await queueAfterTransactionHook(settle);
  };

  return {
    user: {
      create: {
        before: async (_user, context) => {
          if (options.invalidCode !== "reject") return;
          const rawCode = await readReferralCode(context);
          if (rawCode === undefined) return;
          const adapter = await getCurrentAdapter(contextFor(context).adapter);
          if (!(await findUsableCode(adapter, options, rawCode))) {
            throw APIError.from("BAD_REQUEST", REFERRAL_ERROR_CODES.INVALID_REFERRAL_CODE);
          }
        },
        after: async (user, context) => {
          try {
            await attribute(user, context);
          } catch (error) {
            contextFor(context).logger.error("[referral] failed to record the referral", error);
          }
        },
      },
      update: {
        before: async (data, context) => {
          // Note the updates that verify an email, so `after` looks for a
          // referral only then, not on every update of a verified user.
          if (tracksEmailVerified && context && data.emailVerified === true) {
            verifying.add(context);
          }
        },
        after: async (user, context) => {
          if (!tracksEmailVerified || user.emailVerified !== true) return;
          // Requests: only updates that set emailVerified. Server code
          // outside a request: always (rare, and its data isn't tracked).
          if (context && !verifying.delete(context)) return;
          const ctx = contextFor(context);
          try {
            const adapter = await getCurrentAdapter(ctx.adapter);
            const referral = await findReferralByReferredUserId(adapter, user.id);
            if (referral) await recordStep(adapter, ctx, options, referral, EMAIL_VERIFIED_STEP);
          } catch (error) {
            ctx.logger.error("[referral] failed to record the email-verified step", error);
          }
        },
      },
    },
  };
}
