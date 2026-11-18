import type { AuthContext } from "@better-auth/core";
import { getCurrentAdapter, queueAfterTransactionHook } from "@better-auth/core/context";
import type { AuditEvent } from "./types";

/** The `previousHash` of the first link. */
export const GENESIS_HASH = "0".repeat(64);
/** How often a link is retried when another writer took the sequence number. */
const MAX_APPEND_ATTEMPTS = 20;
/** Links read per query while verifying. */
const VERIFY_PAGE_SIZE = 500;
/** Most problems one verification reports. */
export const MAX_REPORTED_PROBLEMS = 100;

/** A link of the chain, as stored in the `auditChain` table. */
export interface AuditChainLink {
  id: string;
  /** 1, 2, 3, ...: unique, so concurrent writers can't fork the chain. */
  sequence: number;
  eventId: string;
  previousHash: string;
  hash: string;
  /** The event's `createdAt`, for retention. */
  createdAt: Date;
}

export type ChainProblem =
  /** The event's content or the link changed after it was written. */
  | "hash-mismatch"
  /** The link's event was deleted. */
  | "missing-event"
  /** Links between this one and the previous were deleted. */
  | "sequence-gap"
  /** The link doesn't continue the previous link's hash. */
  | "broken-link";

export interface ChainVerification {
  /** Whether every link checks out and every event since the first link has one. */
  valid: boolean;
  /** How many links were checked. */
  checked: number;
  /** The first remaining link; older ones were deleted by retention. `null` without links. */
  firstSequence: number | null;
  lastSequence: number | null;
  /** The newest hash. Store it elsewhere now and then to detect deleted newest events. */
  lastHash: string | null;
  /** Up to 100 problems, oldest first. */
  problems: { sequence: number; eventId: string; problem: ChainProblem }[];
  /**
   * Events stored since the first checked link that have no link (written
   * around the chain). Counted only when the check reaches the newest
   * link; `0` on earlier pages.
   */
  unchainedEvents: number;
  /**
   * `null` when the check reached the newest link. Otherwise pass it as
   * `afterSequence` to check the next links.
   */
  nextSequence: number | null;
}

/** Which links one verification checks. */
export interface ChainRange {
  /** Start after this link (from a previous `nextSequence`). Defaults to the first link. */
  afterSequence?: number | undefined;
  /** Check at most this many links. Defaults to every link. */
  limit?: number | undefined;
}

type Context = Pick<AuthContext, "adapter" | "logger" | "secret">;
type Adapter = AuthContext["adapter"];

type HmacKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
const keys = new Map<string, Promise<HmacKey>>();
function hmacKey(secret: string): Promise<HmacKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    keys.set(secret, key);
  }
  return key;
}

/**
 * Everything the hash covers, in a fixed order. `createdAt` is in whole
 * seconds, because some databases store dates with less precision than
 * JavaScript, and the hash must match what is read back.
 */
function canonical(event: AuditEvent, sequence: number, previousHash: string): string {
  return JSON.stringify([
    1, // format version
    sequence,
    previousHash,
    event.id,
    event.type,
    event.status,
    event.severity,
    event.userId ?? null,
    event.actorUserId ?? null,
    event.sessionId ?? null,
    event.organizationId ?? null,
    event.ipAddress ?? null,
    event.userAgent ?? null,
    event.errorCode ?? null,
    event.metadata ? JSON.stringify(event.metadata) : null,
    Math.floor(new Date(event.createdAt).getTime() / 1000),
  ]);
}

export async function linkHash(
  secret: string,
  event: AuditEvent,
  sequence: number,
  previousHash: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(canonical(event, sequence, previousHash)),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function latestLink(adapter: Adapter): Promise<AuditChainLink | null> {
  const [link] = await adapter.findMany<AuditChainLink>({
    model: "auditChain",
    limit: 1,
    sortBy: { field: "sequence", direction: "desc" },
  });
  return link ?? null;
}

export function createChain(secretOption: string | undefined) {
  const secretFor = (ctx: Context) => secretOption ?? ctx.secret;

  /**
   * Adds a link for `event`. Concurrent writers compete for the next
   * sequence number through its unique index; the loser reads the new
   * latest link and tries again.
   */
  async function append(ctx: Context, event: AuditEvent): Promise<void> {
    const adapter = ctx.adapter;
    for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt++) {
      const previous = await latestLink(adapter);
      const sequence = (previous?.sequence ?? 0) + 1;
      const previousHash = previous?.hash ?? GENESIS_HASH;
      const hash = await linkHash(secretFor(ctx), event, sequence, previousHash);
      try {
        await adapter.create<Omit<AuditChainLink, "id">, AuditChainLink>({
          model: "auditChain",
          data: { sequence, eventId: event.id, previousHash, hash, createdAt: event.createdAt },
        });
        return;
      } catch (error) {
        // Not taken: a real failure.
        const taken = await adapter.findOne<AuditChainLink>({
          model: "auditChain",
          where: [{ field: "sequence", value: sequence }],
        });
        if (!taken) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5 * (attempt + 1)));
      }
    }
    throw new Error(`[audit-log] could not chain event ${event.id}: too many concurrent writers`);
  }

  /**
   * `append`, but never inside a database transaction: a failed write
   * there (a taken sequence number) would abort the transaction on some
   * databases, and with it the sign-up being recorded. Inside one, the
   * link is added after the commit, and dropped with a rollback like its
   * event. Errors are logged: the event is stored, and verification
   * reports it as unchained.
   */
  async function link(ctx: Context, event: AuditEvent): Promise<void> {
    const run = async () => {
      try {
        await append(ctx, event);
      } catch (error) {
        ctx.logger.error("[audit-log] failed to chain an event", error);
      }
    };
    if ((await getCurrentAdapter(ctx.adapter)) === ctx.adapter) await run();
    else await queueAfterTransactionHook(run);
  }

  /** Deletes links of events created before `date` (retention). */
  async function deleteOlderThan(ctx: Pick<Context, "adapter">, date: Date): Promise<number> {
    return ctx.adapter.deleteMany({
      model: "auditChain",
      where: [{ field: "createdAt", value: date, operator: "lt" }],
    });
  }

  /** Re-computes the links of `range` (default: all), oldest first, against the stored events. */
  async function verify(
    ctx: Context,
    readEvents: (ids: string[]) => Promise<Map<string, AuditEvent>>,
    range: ChainRange = {},
  ): Promise<ChainVerification> {
    const { adapter } = ctx;
    const secret = secretFor(ctx);
    const problems: ChainVerification["problems"] = [];
    const report = (link: AuditChainLink, problem: ChainProblem) => {
      if (problems.length < MAX_REPORTED_PROBLEMS) {
        problems.push({ sequence: link.sequence, eventId: link.eventId, problem });
      }
    };

    const limit = range.limit ?? Number.POSITIVE_INFINITY;
    let checked = 0;
    let first: AuditChainLink | null = null;
    // The link before the range, to check that the range continues it:
    // the newest one up to `afterSequence`. If that link was deleted, an
    // older one shows the gap; with none older, retention deleted the
    // start of the chain, which isn't a problem.
    let previous: AuditChainLink | null =
      range.afterSequence === undefined
        ? null
        : ((
            await adapter.findMany<AuditChainLink>({
              model: "auditChain",
              where: [{ field: "sequence", value: range.afterSequence, operator: "lte" }],
              limit: 1,
              sortBy: { field: "sequence", direction: "desc" },
            })
          )[0] ?? null);
    let after = range.afterSequence ?? null;
    let problemCount = 0;
    let more = false;
    for (;;) {
      const pageSize = Math.min(VERIFY_PAGE_SIZE, limit - checked);
      if (pageSize <= 0) {
        more = true;
        break;
      }
      const links: AuditChainLink[] = await adapter.findMany<AuditChainLink>({
        model: "auditChain",
        where: after === null ? [] : [{ field: "sequence", value: after, operator: "gt" }],
        limit: pageSize,
        sortBy: { field: "sequence", direction: "asc" },
      });
      if (links.length === 0) break;
      const events = await readEvents(links.map((link) => link.eventId));

      for (const link of links) {
        checked++;
        first ??= link;
        if (previous) {
          if (link.sequence !== previous.sequence + 1) {
            report(link, "sequence-gap");
            problemCount++;
          } else if (link.previousHash !== previous.hash) {
            report(link, "broken-link");
            problemCount++;
          }
        }
        const event = events.get(link.eventId);
        if (!event) {
          report(link, "missing-event");
          problemCount++;
        } else if (
          (await linkHash(secret, event, link.sequence, link.previousHash)) !== link.hash
        ) {
          report(link, "hash-mismatch");
          problemCount++;
        }
        previous = link;
        after = link.sequence;
      }
      if (links.length < pageSize) break;
    }
    // The limit was reached: there may be more links.
    if (more && previous) {
      const [next] = await adapter.findMany<AuditChainLink>({
        model: "auditChain",
        where: [{ field: "sequence", value: previous.sequence, operator: "gt" }],
        limit: 1,
        sortBy: { field: "sequence", direction: "asc" },
      });
      more = !!next;
    }

    let unchainedEvents = 0;
    if (!more && first && previous) {
      // Every event from the first linked one on should have a link.
      const firstEvent = (await readEvents([first.eventId])).get(first.eventId);
      if (firstEvent) {
        const stored = await adapter.count({
          model: "auditEvent",
          where: [{ field: "createdAt", value: firstEvent.createdAt, operator: "gte" }],
        });
        unchainedEvents = Math.max(0, stored - checked);
      }
    }

    return {
      valid: problemCount === 0 && unchainedEvents === 0,
      checked,
      firstSequence: first?.sequence ?? null,
      lastSequence: first ? (previous?.sequence ?? null) : null,
      lastHash: first ? (previous?.hash ?? null) : null,
      problems,
      unchainedEvents,
      nextSequence: more && previous ? previous.sequence : null,
    };
  }

  return { link, verify, deleteOlderThan };
}

export type Chain = ReturnType<typeof createChain>;
