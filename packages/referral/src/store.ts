import type { AuthContext } from "@better-auth/core";
import type { Where } from "@better-auth/core/db/adapter";
import type { Referral, ReferralCode, ReferralStatus, ReferralStep } from "./types";

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

export async function createReferral(
  adapter: Adapter,
  input: Pick<Referral, "referrerUserId" | "referredUserId" | "code" | "status">,
): Promise<Referral> {
  const now = new Date();
  return adapter.create<Omit<Referral, "id">, Referral>({
    model: "referral",
    data: {
      ...input,
      completedAt: input.status === "completed" ? now : null,
      createdAt: now,
    },
  });
}

export async function deleteReferral(adapter: Adapter, id: string): Promise<void> {
  await adapter.delete({ model: "referral", where: [{ field: "id", value: id }] });
}

/**
 * Number of the referrer's referrals made before `referral`: earlier ones,
 * and those made in the same millisecond with a smaller id. Gives every
 * referral of a referrer a fixed place, so concurrent sign-ups agree on
 * which of them are over `maxReferralsPerUser`.
 */
export async function countReferralsBefore(
  adapter: Adapter,
  referral: Pick<Referral, "id" | "referrerUserId" | "createdAt">,
): Promise<number> {
  const createdAt = new Date(referral.createdAt);
  const referrer = { field: "referrerUserId", value: referral.referrerUserId } satisfies Where;
  const [earlier, sameTime] = await Promise.all([
    adapter.count({
      model: "referral",
      where: [referrer, { field: "createdAt", value: createdAt, operator: "lt" }],
    }),
    adapter.count({
      model: "referral",
      where: [
        referrer,
        { field: "createdAt", value: createdAt },
        { field: "id", value: referral.id, operator: "lt" },
      ],
    }),
  ]);
  return earlier + sameTime;
}

/**
 * Marks a pending referral completed. Returns `null` if it wasn't pending
 * (anymore), so only one caller gets to run `onReferralCompleted`.
 */
export async function completeReferral(adapter: Adapter, id: string): Promise<Referral | null> {
  return adapter.update<Referral>({
    model: "referral",
    where: [
      { field: "id", value: id },
      { field: "status", value: "pending" },
    ],
    update: { status: "completed", completedAt: new Date() },
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
