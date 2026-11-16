import type { AuthContext } from "@better-auth/core";
import type { Where } from "@better-auth/core/db/adapter";
import type { WaitlistEntry, WaitlistEntryStatus } from "./types";

/** The adapter methods used here; satisfied by the base adapter and a transaction adapter. */
type Adapter = Pick<
  AuthContext["adapter"],
  "findMany" | "findOne" | "create" | "update" | "delete" | "deleteMany" | "count"
>;

const MODEL = "waitlistEntry";

/** `updatedAt` defaults to now. */
export type WaitlistEntryUpdate = Partial<Omit<WaitlistEntry, "id" | "email" | "createdAt">>;

export async function findEntryById(adapter: Adapter, id: string): Promise<WaitlistEntry | null> {
  return adapter.findOne<WaitlistEntry>({ model: MODEL, where: [{ field: "id", value: id }] });
}

export async function findEntryByEmail(
  adapter: Adapter,
  email: string,
): Promise<WaitlistEntry | null> {
  return adapter.findOne<WaitlistEntry>({
    model: MODEL,
    where: [{ field: "email", value: email }],
  });
}

export async function findEntryByTokenHash(
  adapter: Adapter,
  tokenHash: string,
): Promise<WaitlistEntry | null> {
  return adapter.findOne<WaitlistEntry>({
    model: MODEL,
    where: [{ field: "tokenHash", value: tokenHash }],
  });
}

export async function findEntryByInviteCodeHash(
  adapter: Adapter,
  inviteCodeHash: string,
): Promise<WaitlistEntry | null> {
  return adapter.findOne<WaitlistEntry>({
    model: MODEL,
    where: [{ field: "inviteCodeHash", value: inviteCodeHash }],
  });
}

export async function createEntry(
  adapter: Adapter,
  input: {
    email: string;
    status: "unconfirmed" | "pending";
    /** 1 when a confirmation email is sent right away, otherwise 0. */
    confirmationsSent: number;
    tokenHash: string;
    metadata?: string | undefined;
  },
): Promise<WaitlistEntry> {
  const now = new Date();
  return adapter.create<Omit<WaitlistEntry, "id">, WaitlistEntry>({
    model: MODEL,
    data: {
      email: input.email,
      status: input.status,
      tokenHash: input.tokenHash,
      confirmationsSent: input.confirmationsSent,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    },
  });
}

export async function updateEntry(
  adapter: Adapter,
  id: string,
  update: WaitlistEntryUpdate,
): Promise<WaitlistEntry | null> {
  return adapter.update<WaitlistEntry>({
    model: MODEL,
    where: [{ field: "id", value: id }],
    update: { updatedAt: new Date(), ...update },
  });
}

/**
 * Updates the entry only while it still matches `expected` (besides its
 * id), in one conditional write. Returns `null` when it no longer does:
 * another request changed it first. Used for every transition that sends
 * an email or runs a callback, so concurrent requests can't both do it.
 * Compare fields that change with the transition (`status`, `tokenHash`,
 * `inviteCodeHash`), never dates, whose precision differs between
 * databases.
 */
export async function updateEntryIf(
  adapter: Adapter,
  id: string,
  expected: Where[],
  update: WaitlistEntryUpdate,
): Promise<WaitlistEntry | null> {
  return adapter.update<WaitlistEntry>({
    model: MODEL,
    where: [{ field: "id", value: id }, ...expected],
    update: { updatedAt: new Date(), ...update },
  });
}

/**
 * Deletes unconfirmed entries whose confirmation link was last sent
 * before `cutoff`, so emails nobody confirmed aren't kept.
 */
export async function deleteStaleUnconfirmedEntries(adapter: Adapter, cutoff: Date): Promise<void> {
  await adapter.deleteMany({
    model: MODEL,
    where: [
      { field: "status", value: "unconfirmed" },
      { field: "updatedAt", value: cutoff, operator: "lt" },
    ],
  });
}

/**
 * Number of `pending` entries ahead of `entry`: those that joined earlier,
 * and those that joined in the same millisecond with a smaller id (the
 * same order as `listEntries`).
 */
export async function countPendingBefore(
  adapter: Adapter,
  entry: Pick<WaitlistEntry, "id" | "createdAt">,
): Promise<number> {
  const createdAt = new Date(entry.createdAt);
  const [earlier, sameTime] = await Promise.all([
    adapter.count({
      model: MODEL,
      where: [
        { field: "status", value: "pending" },
        { field: "createdAt", value: createdAt, operator: "lt" },
      ],
    }),
    adapter.count({
      model: MODEL,
      where: [
        { field: "status", value: "pending" },
        { field: "createdAt", value: createdAt },
        { field: "id", value: entry.id, operator: "lt" },
      ],
    }),
  ]);
  return earlier + sameTime;
}

export async function deleteEntry(adapter: Adapter, id: string): Promise<void> {
  await adapter.delete({ model: MODEL, where: [{ field: "id", value: id }] });
}

function filters(input: { status?: WaitlistEntryStatus | undefined; search?: string | undefined }) {
  const where: Where[] = [];
  if (input.status) where.push({ field: "status", value: input.status });
  if (input.search) where.push({ field: "email", value: input.search, operator: "contains" });
  return where;
}

/** Entries in the order they joined, oldest first. */
export async function listEntries(
  adapter: Adapter,
  input: {
    status?: WaitlistEntryStatus | undefined;
    search?: string | undefined;
    limit: number;
    offset?: number | undefined;
  },
): Promise<WaitlistEntry[]> {
  return adapter.findMany<WaitlistEntry>({
    model: MODEL,
    where: filters(input),
    limit: input.limit,
    offset: input.offset ?? 0,
    // Entries created in the same millisecond keep the database's order;
    // `countPendingBefore` breaks such ties by id.
    sortBy: { field: "createdAt", direction: "asc" },
  });
}

/**
 * Entries that count toward `maxEntries`: the people waiting, `pending` or
 * `approved` (not yet signed up). Unconfirmed entries may be fake and
 * expire; rejected and registered ones have left the waitlist.
 */
export async function countWaitingEntries(adapter: Adapter): Promise<number> {
  return adapter.count({
    model: MODEL,
    where: [{ field: "status", value: ["pending", "approved"], operator: "in" }],
  });
}

export async function countEntries(
  adapter: Adapter,
  input: { status?: WaitlistEntryStatus | undefined; search?: string | undefined } = {},
): Promise<number> {
  return adapter.count({ model: MODEL, where: filters(input) });
}
