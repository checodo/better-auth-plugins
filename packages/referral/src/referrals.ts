import type { AuthContext } from "@better-auth/core";
import { recordAuditEvent } from "@repo/plugin-utils/audit";
import { runCallback } from "@repo/plugin-utils/callbacks";
import { APIError } from "better-auth/api";
import { REFERRAL_ERROR_CODES } from "./error-codes";
import type { Adapter } from "./store";
import {
  completeReferral,
  countReferrals,
  countSlots,
  createCode,
  createSlot,
  createStep,
  findCodeByCode,
  findCodeByUserId,
  findSlotByKey,
  findStep,
  isReferrerBlocked,
  markRewarded,
  replaceCode,
  slotKey,
  stepsByReferral,
  takenSlotKeys,
} from "./store";
import type { Referral, ReferralCode, ResolvedReferralOptions } from "./types";
import { generateCode, isWellFormedCode, normalizeCode } from "./utils/code";

type Callbacks = Pick<AuthContext, "logger" | "runInBackgroundOrAwait">;

/** How often a colliding generated code is replaced before giving up. */
const MAX_CODE_ATTEMPTS = 5;

/** A new, unused, well-formed code from `generateCode` or the built-in generator. */
async function newCode(adapter: Adapter, options: ResolvedReferralOptions): Promise<string | null> {
  const code = normalizeCode(
    options.generateCode ? await options.generateCode() : generateCode(options.codeLength),
  );
  if (!isWellFormedCode(code)) {
    throw new Error(
      `[referral] generateCode returned ${JSON.stringify(code)}: use 4 to 64 letters, digits, "-", or "_".`,
    );
  }
  return (await findCodeByCode(adapter, code)) ? null : code;
}

/**
 * The code `userId` refers with, created on first use. Safe to call
 * concurrently: a second creation hits the unique index and returns the
 * code the first one stored.
 */
export async function getOrCreateCode(
  adapter: Adapter,
  options: ResolvedReferralOptions,
  userId: string,
): Promise<ReferralCode> {
  const existing = await findCodeByUserId(adapter, userId);
  if (existing) return existing;

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = await newCode(adapter, options);
    if (!code) continue;
    try {
      return await createCode(adapter, { userId, code });
    } catch (error) {
      // Either this user got a code concurrently, or the code was taken.
      const raced = await findCodeByUserId(adapter, userId);
      if (raced) return raced;
      if (!(await findCodeByCode(adapter, code))) throw error;
    }
  }
  throw APIError.from("INTERNAL_SERVER_ERROR", REFERRAL_ERROR_CODES.CODE_GENERATION_FAILED);
}

/**
 * Gives `userId` a new code; the old one stops working. Referrals made
 * with the old code keep counting (they store the code they used).
 */
export async function regenerateCode(
  adapter: Adapter,
  options: ResolvedReferralOptions,
  userId: string,
): Promise<ReferralCode> {
  const existing = await findCodeByUserId(adapter, userId);
  if (!existing) return getOrCreateCode(adapter, options, userId);

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = await newCode(adapter, options);
    if (!code) continue;
    try {
      return (await replaceCode(adapter, existing.id, code)) ?? { ...existing, code };
    } catch (error) {
      // The code was taken concurrently (unique index): try another.
      if (!(await findCodeByCode(adapter, code))) throw error;
    }
  }
  throw APIError.from("INTERNAL_SERVER_ERROR", REFERRAL_ERROR_CODES.CODE_GENERATION_FAILED);
}

/**
 * The stored code for `rawCode` if it can still refer someone: it exists,
 * its owner isn't banned, and hasn't reached `maxReferralsPerUser`. `null`
 * otherwise.
 */
export async function findUsableCode(
  adapter: Adapter,
  options: Pick<ResolvedReferralOptions, "maxReferralsPerUser">,
  rawCode: string,
): Promise<ReferralCode | null> {
  const code = normalizeCode(rawCode);
  if (!isWellFormedCode(code)) return null;
  const stored = await findCodeByCode(adapter, code);
  if (!stored) return null;
  if (await isReferrerBlocked(adapter, stored.userId)) return null;
  if (
    options.maxReferralsPerUser !== undefined &&
    (await countReferrals(adapter, { referrerUserId: stored.userId })) >=
      options.maxReferralsPerUser
  ) {
    return null;
  }
  return stored;
}

/**
 * Takes one of the referrer's `max` places for `referral`, once its
 * sign-up is committed. Returns `false` when they are all taken; the
 * caller then deletes the referral.
 *
 * A place is a row with a unique key (`referralSlot`), so two sign-ups
 * can't take the same one, whatever order their transactions commit in.
 * Referrals without a place (made before `maxReferralsPerUser` was set or
 * before this version, or another sign-up's that isn't settled yet) take
 * up places too, so the limit also holds for referrers who already have
 * referrals. When sign-ups race for the last place, the first to settle
 * gets it; at worst all of them lose it, and the place stays free for the
 * next sign-up.
 */
export async function claimReferralPlace(
  adapter: Adapter,
  max: number,
  referral: Pick<Referral, "id" | "referrerUserId">,
): Promise<boolean> {
  const { referrerUserId } = referral;
  // Places first, then referrals: a referral that takes a place in
  // between counts as one without a place, which only frees fewer places.
  const slots = await countSlots(adapter, referrerUserId);
  const referrals = await countReferrals(adapter, { referrerUserId });
  const withoutPlace = Math.max(0, referrals - slots - 1);
  const places = max - withoutPlace;
  if (places <= 0) return false;

  const taken = await takenSlotKeys(adapter, referrerUserId, places);
  for (let place = 0; place < places; place++) {
    const key = slotKey(referrerUserId, place);
    if (taken.has(key)) continue;
    try {
      await createSlot(adapter, { referrerUserId, referralId: referral.id, key });
      return true;
    } catch (error) {
      // Taken by a concurrent sign-up since it was read: try the next one.
      if (await findSlotByKey(adapter, key)) continue;
      throw error;
    }
  }
  return false;
}

/** Records a completed referral in the audit log, for the referrer it rewards. */
function recordCompleted(referral: Referral): Promise<void> {
  return recordAuditEvent({
    type: "referral.completed",
    severity: "medium",
    userId: referral.referrerUserId,
    metadata: { referralId: referral.id, referredUserId: referral.referredUserId },
  });
}

/**
 * Calls `onReferralCompleted` for a referral that was just completed, and
 * records it as rewarded once the call returns without an error. A call
 * that fails (or never finishes) is retried by `retryReferralRewards`.
 */
async function deliverReward(
  adapter: Adapter,
  context: Callbacks,
  options: ResolvedReferralOptions,
  referral: Referral,
): Promise<void> {
  const { onReferralCompleted } = options;
  if (!onReferralCompleted) return;
  await runCallback(
    context,
    "referral",
    "onReferralCompleted",
    () => onReferralCompleted(referral),
    () => markRewarded(adapter, referral.id),
  );
}

/**
 * Marks `referral` completed once all required steps are done. Only the
 * request whose conditional update completes it calls `onReferralCompleted`
 * (see `deliverReward`).
 */
async function completeIfDone(
  adapter: Adapter,
  context: Callbacks,
  options: ResolvedReferralOptions,
  referral: Referral,
): Promise<Referral> {
  if (referral.status === "completed") return referral;
  const done = new Set((await stepsByReferral(adapter, [referral.id])).get(referral.id));
  if (!options.steps.every((step) => done.has(step))) return referral;

  const completed = await completeReferral(adapter, referral.id, {
    trackReward: !!options.onReferralCompleted,
  });
  // null: another request completed it first and runs the callback.
  if (!completed) return { ...referral, status: "completed" };
  await recordCompleted(completed);
  await deliverReward(adapter, context, options, completed);
  return completed;
}

/**
 * Records `step` for `referral` (once; repeating it changes nothing) and
 * completes the referral when it was the last required step.
 */
export async function recordStep(
  adapter: Adapter,
  context: Callbacks,
  options: ResolvedReferralOptions,
  referral: Referral,
  step: string,
  metadata?: string | undefined,
): Promise<Referral> {
  if (!options.steps.includes(step)) {
    throw APIError.from("BAD_REQUEST", REFERRAL_ERROR_CODES.UNKNOWN_REFERRAL_STEP);
  }

  let isNew = false;
  if (!(await findStep(adapter, referral.id, step))) {
    try {
      await createStep(adapter, { referralId: referral.id, step, metadata });
      isNew = true;
    } catch (error) {
      // Recorded concurrently (unique index on referral and step).
      if (!(await findStep(adapter, referral.id, step))) throw error;
    }
  }

  const { onStepCompleted } = options;
  if (isNew && onStepCompleted) {
    await runCallback(context, "referral", "onStepCompleted", () =>
      onStepCompleted({ referral, step }),
    );
  }
  return completeIfDone(adapter, context, options, referral);
}

/**
 * Runs once a referral is created: `onReferral`, then `onReferralCompleted`
 * if it was created completed (no steps required).
 */
export async function referralCreated(
  adapter: Adapter,
  context: Callbacks,
  options: ResolvedReferralOptions,
  referral: Referral,
): Promise<void> {
  await recordAuditEvent({
    type: "referral.created",
    userId: referral.referredUserId,
    actorUserId: referral.referredUserId,
    metadata: {
      referralId: referral.id,
      referrerUserId: referral.referrerUserId,
      code: referral.code,
    },
  });
  if (referral.status === "completed") await recordCompleted(referral);
  const { onReferral } = options;
  if (onReferral) await runCallback(context, "referral", "onReferral", () => onReferral(referral));
  if (referral.status === "completed") await deliverReward(adapter, context, options, referral);
}
