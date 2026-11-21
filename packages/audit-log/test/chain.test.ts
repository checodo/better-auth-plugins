import { resetTestDatabase, testDatabase } from "@repo/tooling/test-helpers";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import { GENESIS_HASH, linkHash } from "../src/chain";
import type { AuditChainLink, AuditEvent, AuditLogOptions } from "../src/index";
import { auditLog, memoryStorage } from "../src/index";
import { resolveOptions } from "../src/options";

const PASSWORD = "password1234";

/** An instance with the hash chain on, and helpers to tamper with the tables. */
async function setup(options: AuditLogOptions = {}) {
  const { auth, client } = await getTestInstance(
    { plugins: [auditLog({ hashChain: true, ...options })] },
    { ...testDatabase(), disableTestUser: true },
  );
  const context = await auth.$context;
  await resetTestDatabase(context);
  const record = (type: string) => auth.api.recordAuditEvent({ body: { type } });
  const links = () =>
    context.adapter.findMany<AuditChainLink>({
      model: "auditChain",
      sortBy: { field: "sequence", direction: "asc" },
    });
  const verify = () => auth.api.verifyAuditChain({});
  return { auth, client, context, record, links, verify };
}

describe("hash chain", () => {
  it("links every event in order and verifies", async () => {
    const { auth, record, links, verify } = await setup();
    await auth.api.signUpEmail({
      body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
    });
    await record("billing.plan-changed");

    const chain = await links();
    expect(chain.map((link) => link.sequence)).toEqual([1, 2, 3]); // sign-up, sign-in, custom
    expect(chain[0]?.previousHash).toBe(GENESIS_HASH);
    expect(chain[1]?.previousHash).toBe(chain[0]?.hash);

    expect(await verify()).toEqual({
      valid: true,
      checked: 3,
      firstSequence: 1,
      lastSequence: 3,
      lastHash: chain[2]?.hash,
      problems: [],
      unchainedEvents: 0,
      nextSequence: null,
    });
  });

  it("detects a changed event", async () => {
    const { context, record, verify } = await setup();
    await record("one");
    const { event } = await record("two");
    await record("three");
    await context.adapter.update({
      model: "auditEvent",
      where: [{ field: "id", value: event?.id as string }],
      update: { ipAddress: "203.0.113.1" },
    });

    expect(await verify()).toMatchObject({
      valid: false,
      problems: [{ sequence: 2, eventId: event?.id, problem: "hash-mismatch" }],
    });
  });

  it("detects a deleted event", async () => {
    const { context, record, verify } = await setup();
    await record("one");
    const { event } = await record("two");
    await context.adapter.delete({
      model: "auditEvent",
      where: [{ field: "id", value: event?.id as string }],
    });
    expect(await verify()).toMatchObject({
      valid: false,
      problems: [{ sequence: 2, problem: "missing-event" }],
    });
  });

  it("detects a deleted event together with its link", async () => {
    const { context, record, links, verify } = await setup();
    await record("one");
    const { event } = await record("two");
    await record("three");
    await context.adapter.delete({
      model: "auditEvent",
      where: [{ field: "id", value: event?.id as string }],
    });
    await context.adapter.delete({
      model: "auditChain",
      where: [{ field: "sequence", value: 2 }],
    });
    expect((await links()).map((link) => link.sequence)).toEqual([1, 3]);
    expect(await verify()).toMatchObject({
      valid: false,
      problems: [{ sequence: 3, problem: "sequence-gap" }],
    });
  });

  it("detects a link rewritten without the key", async () => {
    const { context, record, verify } = await setup();
    await record("one");
    const { event } = await record("two");
    await context.adapter.update({
      model: "auditEvent",
      where: [{ field: "id", value: event?.id as string }],
      update: { type: "forged" },
    });
    // A plain SHA-256 over the changed event doesn't help without the HMAC key.
    await context.adapter.update({
      model: "auditChain",
      where: [{ field: "sequence", value: 2 }],
      update: { hash: "f".repeat(64) },
    });
    const result = await verify();
    expect(result.valid).toBe(false);
    expect(result.problems[0]).toMatchObject({ sequence: 2, problem: "hash-mismatch" });
  });

  it("detects events written around the chain", async () => {
    const { context, record, verify } = await setup();
    await record("one");
    await context.adapter.create({
      model: "auditEvent",
      data: {
        type: "inserted",
        status: "success",
        severity: "low",
        createdAt: new Date(Date.now() + 1000),
      },
    });
    expect(await verify()).toMatchObject({ valid: false, problems: [], unchainedEvents: 1 });
  });

  it("stays valid after retention deletes the oldest events and their links", async () => {
    const { auth, context, record, verify } = await setup();
    await record("old-1");
    await record("old-2");
    await record("new");
    const old = new Date(Date.now() - 40 * 86_400_000);
    // Make the two oldest events, and their links, 40 days old.
    const rows = await context.adapter.findMany<AuditEvent>({
      model: "auditEvent",
      sortBy: { field: "createdAt", direction: "asc" },
    });
    for (const row of rows.slice(0, 2)) {
      await context.adapter.update({
        model: "auditEvent",
        where: [{ field: "id", value: row.id }],
        update: { createdAt: old },
      });
    }
    await context.adapter.updateMany({
      model: "auditChain",
      where: [{ field: "sequence", value: 3, operator: "lt" }],
      update: { createdAt: old },
    });

    expect(await auth.api.deleteExpiredAuditEvents({ body: { days: 30 } })).toEqual({
      deleted: 2,
    });
    expect(await verify()).toMatchObject({
      valid: true,
      checked: 1,
      firstSequence: 3,
      lastSequence: 3,
    });
  });

  it("retries when a concurrent writer took the sequence number", async () => {
    const { context, record, links, verify } = await setup();
    await record("one");
    const [stale] = await links();
    // The next writer reads the chain's end before another writer adds to it.
    const findMany = context.adapter.findMany.bind(context.adapter);
    let raced = false;
    vi.spyOn(context.adapter, "findMany").mockImplementation(async (query) => {
      if (query.model === "auditChain" && query.limit === 1 && !raced) {
        raced = true;
        await record("concurrent");
        return [stale] as never;
      }
      return findMany(query as never) as never;
    });
    await record("two");
    vi.restoreAllMocks();

    expect((await links()).map((link) => link.sequence)).toEqual([1, 2, 3]);
    expect(await verify()).toMatchObject({ valid: true, checked: 3 });
  });

  it("verifies more links than an adapter returns at once", async () => {
    const { record, verify } = await setup();
    for (let i = 0; i < 150; i++) await record(`event-${i}`);
    expect(await verify()).toMatchObject({ valid: true, checked: 150, problems: [] });
  });

  it("keeps up with many concurrent events", async () => {
    const { record, verify } = await setup();
    await Promise.all(Array.from({ length: 20 }, (_, i) => record(`event-${i}`)));
    expect(await verify()).toMatchObject({ valid: true, checked: 20, lastSequence: 20 });
  });

  it("uses a secret of its own when given one", async () => {
    const event = {
      id: "e-1",
      type: "sign-in",
      status: "success",
      severity: "low",
      userId: null,
      actorUserId: null,
      sessionId: null,
      organizationId: null,
      ipAddress: null,
      userAgent: null,
      errorCode: null,
      metadata: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    } satisfies AuditEvent;
    const a = await linkHash("a".repeat(32), event, 1, GENESIS_HASH);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await linkHash("b".repeat(32), event, 1, GENESIS_HASH)).not.toBe(a);
    expect(
      await linkHash("a".repeat(32), { ...event, type: "sign-out" }, 1, GENESIS_HASH),
    ).not.toBe(a);

    const { record, verify } = await setup({ hashChain: { secret: "s".repeat(32) } });
    await record("one");
    expect((await verify()).valid).toBe(true);
  });
});

describe("hash chain options and access", () => {
  it("refuses invalid configuration", () => {
    expect(() => resolveOptions({ hashChain: true, storage: memoryStorage() })).toThrow(
      /hashChain/,
    );
    expect(() => resolveOptions({ hashChain: { secret: "short" } })).toThrow(/32 characters/);
  });

  it("adds the auditChain table only when on", () => {
    expect(auditLog({ hashChain: true }).schema).toHaveProperty("auditChain");
    expect(auditLog().schema).not.toHaveProperty("auditChain");
  });

  it("reports when it is off", async () => {
    const { auth } = await getTestInstance(
      { plugins: [auditLog()] },
      { ...testDatabase(), disableTestUser: true },
    );
    await resetTestDatabase(await auth.$context);
    await expect(auth.api.verifyAuditChain({})).rejects.toMatchObject({
      body: { code: "HASH_CHAIN_NOT_ENABLED" },
    });
  });
});
