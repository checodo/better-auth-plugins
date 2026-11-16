import type { AuthContext } from "@better-auth/core";
import type { Where } from "@better-auth/core/db/adapter";
import type { Referral, ReferralCode, ReferralSlot, ReferralStatus, ReferralStep } from "./types";

/** The adapter methods used here; satisfied by the base adapter and a transaction adapter. */
export type Adapter = Pick<
  AuthContext["adapter"],
  "findMany" | "findOne" | "create" | "update" | "count" | "delete"
>;

// ----- codes -----

export async function findCodeByUserId(
  adapter: Adapter,
  userId: string,
): Promise<ReferralCode | null> {
  return adapter.findOne<ReferralCode>({
    model: "referralCode",
    where: [{ field: "userId", value: userId }],
  });
}

export async function findCodeByCode(adapter: Adapter, code: string): Promise<ReferralCode | null> {
  return adapter.findOne<ReferralCode>({
    model: "referralCode",
    where: [{ field: "code", value: code }],
  });
}

export async function createCode(
  adapter: Adapter,
  input: { userId: string; code: string },
): Promise<ReferralCode> {
  return adapter.create<Omit<ReferralCode, "id">, ReferralCode>({
    model: "referralCode",
    data: { userId: input.userId, code: input.code, createdAt: new Date() },
  });
}

export async function replaceCode(
  adapter: Adapter,
  id: string,
  code: string,
): Promise<ReferralCode | null> {
  return adapter.update<ReferralCode>({
    model: "referralCode",
    where: [{ field: "id", value: id }],
    update: { code, createdAt: new Date() },
  });
}

// ----- referrals -----

export async function findReferralByReferredUserId(
  adapter: Adapter,
  referredUserId: string,
): Promise<Referral | null> {
  return adapter.findOne<Referral>({
    model: "referral",
    where: [{ field: "referredUserId", value: referredUserId }],
  });
}

/**
 * `trackReward`: the referral is created completed and `onReferralCompleted`
 * is about to be called, its first attempt (see `firstRewardAttempt`).
 */
export async function createReferral(
  adapter: Adapter,
  input: Pick<Referral, "referrerUserId" | "referredUserId" | "code" | "status">,
  { trackReward = false }: { trackReward?: boolean } = {},
): Promise<Referral> {
  const now = new Date();
  return adapter.create<Omit<Referral, "id">, Referral>({
    model: "referral",
    data: {
      ...input,
      completedAt: input.status === "completed" ? now : null,
      createdAt: now,
      ...(trackReward && input.status === "completed" ? firstRewardAttempt(now) : {}),
    },
  });
}

// ----- reward delivery (`onReferralCompleted`) -----

/** The fields of a referral whose `onReferralCompleted` call starts now, its first. */
export function firstRewardAttempt(now = new Date()) {
  return { rewardStatus: "pending", rewardAttempts: 1, rewardAttemptAt: now } as const;
}

/**
 * Completed referrals whose `onReferralCompleted` hasn't succeeded, whose
 * last call started before `before`, and that have attempts left. Oldest
 * attempts first.
 */
export async function listDueRewards(
  adapter: Adapter,
  input: { before: Date; maxAttempts: number; limit: number },
): Promise<Referral[]> {
  return adapter.findMany<Referral>({
    model: "referral",
    where: [
      { field: "status", value: "completed" },
      { field: "rewardStatus", value: "pending" },
      { field: "rewardAttemptAt", value: input.before, operator: "lt" },
      { field: "rewardAttempts", value: input.maxAttempts, operator: "lt" },
    ],
    sortBy: { field: "rewardAttemptAt", direction: "asc" },
    limit: input.limit,
  });
}

/**
 * Starts another attempt for a due referral, in one conditional update:
 * only while its attempt count is still the one read, so of concurrent
 * retries only one calls `onReferralCompleted`. `null` if another took it.
 */
export async function claimRewardAttempt(
  adapter: Adapter,
  referral: Pick<Referral, "id" | "rewardAttempts">,
  before: Date,
): Promise<Referral | null> {
  const attempts = referral.rewardAttempts ?? 0;
  return adapter.update<Referral>({
    model: "referral",
    where: [
      { field: "id", value: referral.id },
      { field: "rewardStatus", value: "pending" },
      { field: "rewardAttempts", value: attempts },
      { field: "rewardAttemptAt", value: before, operator: "lt" },
    ],
    update: { rewardAttempts: attempts + 1, rewardAttemptAt: new Date() },
  });
}

/** Records that `onReferralCompleted` returned without an error for the referral. */
export async function markRewarded(adapter: Adapter, id: string): Promise<void> {
  await adapter.update<Referral>({
    model: "referral",
    where: [
      { field: "id", value: id },
      { field: "rewardStatus", value: "pending" },
    ],
    update: { rewardStatus: "rewarded" },
  });
}

export async function deleteReferral(adapter: Adapter, id: string): Promise<void> {
  await adapter.delete({ model: "referral", where: [{ field: "id", value: id }] });
}

// ----- places (`maxReferralsPerUser`) -----

export function slotKey(referrerUserId: string, place: number): string {
  return `${referrerUserId}:${place}`;
}

export async function countSlots(adapter: Adapter, referrerUserId: string): Promise<number> {
  return adapter.count({
    model: "referralSlot",
    where: [{ field: "referrerUserId", value: referrerUserId }],
  });
}

/** The keys of the referrer's places below `limit`, the ones that can still be taken. */
export async function takenSlotKeys(
  adapter: Adapter,
  referrerUserId: string,
  limit: number,
): Promise<Set<string>> {
  const keys = Array.from({ length: limit }, (_, place) => slotKey(referrerUserId, place));
  const slots = await adapter.findMany<ReferralSlot>({
    model: "referralSlot",
    where: [{ field: "key", value: keys, operator: "in" }],
    limit,
  });
  return new Set(slots.map((slot) => slot.key));
}

/** Takes the place `key` for `referralId`. Throws if it is taken (unique index). */
export async function createSlot(
  adapter: Adapter,
  input: Pick<ReferralSlot, "referrerUserId" | "referralId" | "key">,
): Promise<ReferralSlot> {
  return adapter.create<Omit<ReferralSlot, "id">, ReferralSlot>({
    model: "referralSlot",
    data: { ...input, createdAt: new Date() },
  });
}

export async function findSlotByKey(adapter: Adapter, key: string): Promise<ReferralSlot | null> {
  return adapter.findOne<ReferralSlot>({
    model: "referralSlot",
    where: [{ field: "key", value: key }],
  });
}

/**
 * Marks a pending referral completed. Returns `null` if it wasn't pending
 * (anymore), so only one caller gets to run `onReferralCompleted`.
 * `trackReward`: that call is about to start, its first attempt.
 */
export async function completeReferral(
  adapter: Adapter,
  id: string,
  { trackReward = false }: { trackReward?: boolean } = {},
): Promise<Referral | null> {
  const now = new Date();
  return adapter.update<Referral>({
    model: "referral",
    where: [
      { field: "id", value: id },
      { field: "status", value: "pending" },
    ],
    update: {
      status: "completed",
      completedAt: now,
      ...(trackReward ? firstRewardAttempt(now) : {}),
    },
  });
}

function referralFilters(input: {
  referrerUserId?: string | undefined;
  status?: ReferralStatus | undefined;
}): Where[] {
  const where: Where[] = [];
  if (input.referrerUserId) where.push({ field: "referrerUserId", value: input.referrerUserId });
  if (input.status) where.push({ field: "status", value: input.status });
  return where;
}

/** Newest first. */
export async function listReferrals(
  adapter: Adapter,
  input: {
    referrerUserId?: string | undefined;
    status?: ReferralStatus | undefined;
    limit: number;
    offset: number;
  },
): Promise<Referral[]> {
  return adapter.findMany<Referral>({
    model: "referral",
    where: referralFilters(input),
    limit: input.limit,
    offset: input.offset,
    sortBy: { field: "createdAt", direction: "desc" },
  });
}

export async function countReferrals(
  adapter: Adapter,
  input: { referrerUserId?: string | undefined; status?: ReferralStatus | undefined },
): Promise<number> {
  return adapter.count({ model: "referral", where: referralFilters(input) });
}

// ----- steps -----

export async function createStep(
  adapter: Adapter,
  input: { referralId: string; step: string; metadata?: string | undefined },
): Promise<ReferralStep> {
  return adapter.create<Omit<ReferralStep, "id">, ReferralStep>({
    model: "referralStep",
    data: {
      referralId: input.referralId,
      step: input.step,
      metadata: input.metadata ?? null,
      completedAt: new Date(),
    },
  });
}

export async function findStep(
  adapter: Adapter,
  referralId: string,
  step: string,
): Promise<ReferralStep | null> {
  return adapter.findOne<ReferralStep>({
    model: "referralStep",
    where: [
      { field: "referralId", value: referralId },
      { field: "step", value: step },
    ],
  });
}

/** The completed steps of these referrals, by referral id. */
export async function stepsByReferral(
  adapter: Adapter,
  referralIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>(referralIds.map((id) => [id, []]));
  if (referralIds.length === 0) return result;
  const steps = await adapter.findMany<ReferralStep>({
    model: "referralStep",
    where: [{ field: "referralId", value: referralIds, operator: "in" }],
    sortBy: { field: "completedAt", direction: "asc" },
  });
  for (const { referralId, step } of steps) result.get(referralId)?.push(step);
  return result;
}

// ----- users -----

/**
 * Whether a user can't refer anyone: deleted, or banned with better-auth's
 * `admin` plugin (until `banExpires`, if set). Without the admin plugin,
 * nobody is banned.
 */
export async function isReferrerBlocked(adapter: Adapter, userId: string): Promise<boolean> {
  const user = await adapter.findOne<{ banned?: boolean | null; banExpires?: Date | null }>({
    model: "user",
    where: [{ field: "id", value: userId }],
  });
  if (!user) return true;
  if (user.banned !== true) return false;
  return !user.banExpires || new Date(user.banExpires).getTime() > Date.now();
}

export async function findUsers(
  adapter: Adapter,
  ids: string[],
): Promise<Map<string, { id: string; name: string; email: string }>> {
  if (ids.length === 0) return new Map();
  const users = await adapter.findMany<{ id: string; name: string; email: string }>({
    model: "user",
    where: [{ field: "id", value: ids, operator: "in" }],
  });
  return new Map(users.map((user) => [user.id, user]));
}
