import { admin, testUtils } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it } from "vitest";
import type { AuditChainLink, AuditEvent, AuditLogOptions } from "../src/index";
import { AUDIT_LOG_ERROR_CODES, auditLog, memoryStorage } from "../src/index";
import { decodeCursor, encodeCursor, nextCursor, toCsv } from "../src/utils/export";

const BASE = "http://localhost:3000/api/auth";

async function setup(options: AuditLogOptions = {}) {
  const { auth } = await getTestInstance(
    { plugins: [admin(), testUtils(), auditLog(options)] },
    { disableTestUser: true },
  );
  const context = await auth.$context;
  const { test } = context;
  const userHeaders = async (email: string, role?: string) => {
    const user = await test.saveUser(test.createUser({ email, ...(role ? { role } : {}) }));
    return test.getAuthHeaders({ userId: user.id });
  };
  const record = (type: string, extra: Record<string, unknown> = {}) =>
    auth.api.recordAuditEvent({ body: { type, ...extra } });
  /** A request through the HTTP handler, as a browser or script would send it. */
  const http = (path: string, init: RequestInit & { headers?: Headers } = {}) => {
    const headers = new Headers(init.headers);
    if (init.body) headers.set("content-type", "application/json");
    return auth.handler(new Request(`${BASE}${path}`, { ...init, headers }));
  };
  return { auth, context, userHeaders, record, http };
}

/** Every page of an NDJSON export, following `x-next-cursor`. */
async function exportAll(fetchPage: (cursor?: string) => Promise<Response>) {
  const pages: AuditEvent[][] = [];
  let cursor: string | undefined;
  do {
    const response = await fetchPage(cursor);
    expect(response.status).toBe(200);
    const text = await response.text();
    pages.push(
      text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditEvent),
    );
    cursor = response.headers.get("x-next-cursor") ?? undefined;
  } while (cursor);
  return pages;
}

const event = (overrides: Partial<AuditEvent>): AuditEvent => ({
  id: crypto.randomUUID(),
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
  ...overrides,
});

describe("export", () => {
  it("is for admins over HTTP, and for server code without headers", async () => {
    const { auth, userHeaders, http } = await setup();
    const adminHeaders = await userHeaders("admin@example.com", "admin");
    const user = await userHeaders("user@example.com");

    expect((await http("/audit-log/export", { headers: adminHeaders })).status).toBe(200);
    const forbidden = await http("/audit-log/export", { headers: user });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({
      code: AUDIT_LOG_ERROR_CODES.YOU_ARE_NOT_ALLOWED_TO_EXPORT_EVENTS.code,
    });
    expect((await http("/audit-log/export")).status).toBe(401);

    // Server code: no headers, no session needed; headers are checked.
    const response = (await auth.api.exportAuditEvents({ query: {} })) as Response;
    expect(response.status).toBe(200);
    await expect(auth.api.exportAuditEvents({ query: {}, headers: user })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("exports NDJSON, newest first, with the list filters", async () => {
    const { userHeaders, record, http } = await setup({ events: ["billing.*", "other"] });
    const headers = await userHeaders("admin@example.com", "admin");
    await record("billing.one");
    await record("billing.two");
    await record("other");

    const all = await http("/audit-log/export", { headers });
    expect(all.headers.get("content-type")).toContain("application/x-ndjson");
    expect(all.headers.get("content-disposition")).toBe(
      'attachment; filename="audit-events.ndjson"',
    );
    expect(all.headers.get("x-next-cursor")).toBeNull();
    const types = (await all.text())
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as AuditEvent).type);
    expect(types).toEqual(["other", "billing.two", "billing.one"]);

    const filtered = await http("/audit-log/export?type=billing.one", { headers });
    expect((await filtered.text()).trim().split("\n")).toHaveLength(1);
  });

  it("pages with a cursor, unaffected by new events", async () => {
    const { userHeaders, record, http } = await setup({ events: ["page.*"] });
    const headers = await userHeaders("admin@example.com", "admin");
    for (let i = 0; i < 7; i++) await record(`page.${i}`);

    let added = false;
    const pages = await exportAll(async (cursor) => {
      if (cursor && !added) {
        added = true;
        await record("page.newer");
      }
      return http(`/audit-log/export?limit=3${cursor ? `&cursor=${cursor}` : ""}`, { headers });
    });
    expect(pages.map((page) => page.length)).toEqual([3, 3, 1]);
    expect(pages.flat().map((event) => event.type)).toEqual(
      Array.from({ length: 7 }, (_, i) => `page.${6 - i}`),
    );
  });

  it("never splits or repeats events with the same time across pages", async () => {
    const storage = memoryStorage();
    const { auth } = await setup({ storage });
    const createdAt = new Date("2026-01-01T00:00:00Z");
    storage.events.push(
      event({ type: "older", createdAt: new Date("2025-12-31T00:00:00Z") }),
      ...Array.from({ length: 5 }, (_, i) => event({ type: `same-${i}`, createdAt })),
      event({ type: "newer", createdAt: new Date("2026-01-02T00:00:00Z") }),
    );
    const pages = await exportAll(
      async (cursor) =>
        (await auth.api.exportAuditEvents({ query: { limit: 2, cursor } })) as Response,
    );
    const types = pages.flat().map((event) => event.type);
    expect(types).toHaveLength(7);
    expect(new Set(types).size).toBe(7);
    expect(types[0]).toBe("newer");
    expect(types.at(-1)).toBe("older");
  });

  it("rejects a cursor it didn't make", async () => {
    const { auth } = await setup();
    await expect(
      auth.api.exportAuditEvents({ query: { cursor: "not-a-cursor" } }),
    ).rejects.toMatchObject({
      statusCode: 400,
      body: { code: AUDIT_LOG_ERROR_CODES.INVALID_CURSOR.code },
    });
  });

  it("exports CSV, header on the first page, safe for spreadsheets", async () => {
    const { auth, record } = await setup();
    await record("billing.changed", {
      errorCode: '=HYPERLINK("https://evil.example")',
      metadata: { plan: "pro, yearly" },
    });
    await record("other");
    const first = (await auth.api.exportAuditEvents({
      query: { format: "csv", limit: 1 },
    })) as Response;
    expect(first.headers.get("content-type")).toContain("text/csv");
    const [header, row] = (await first.text()).trim().split("\r\n");
    expect(header).toBe(
      "id,createdAt,type,status,severity,userId,actorUserId,sessionId,organizationId,ipAddress,userAgent,errorCode,metadata",
    );
    expect(row).toContain(",other,");

    const cursor = first.headers.get("x-next-cursor") ?? "";
    const second = (await auth.api.exportAuditEvents({
      query: { format: "csv", limit: 1, cursor },
    })) as Response;
    const lines = (await second.text()).trim().split("\r\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`,"'=HYPERLINK(""https://evil.example"")",`);
    expect(lines[0]).toContain(`"{""plan"":""pro, yearly""}"`);
  });

  it("needs a storage that can be read", async () => {
    const { auth } = await setup({
      storage: { write: async (input) => ({ ...input, id: crypto.randomUUID() }) },
    });
    await expect(auth.api.exportAuditEvents({ query: {} })).rejects.toMatchObject({
      statusCode: 501,
      body: { code: AUDIT_LOG_ERROR_CODES.READ_NOT_SUPPORTED.code },
    });
  });

  it("is rate limited, with the verification", () => {
    const [rule] = auditLog().rateLimit;
    expect(rule?.pathMatcher("/audit-log/export")).toBe(true);
    expect(rule?.pathMatcher("/audit-log/verify-chain")).toBe(true);
    expect(rule?.pathMatcher("/audit-log/list-events")).toBe(false);
  });
});

describe("export helpers", () => {
  it("round-trips cursors and rejects others", () => {
    expect(decodeCursor(encodeCursor({ before: 1_767_225_600_001, skip: 2 }))).toEqual({
      before: 1_767_225_600_001,
      skip: 2,
    });
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(btoa("[1,-1]"))).toBeNull();
    expect(decodeCursor(btoa('{"before":1}'))).toBeNull();
  });

  it("counts the events of the last time to skip, across pages", () => {
    const t = new Date("2026-01-01T00:00:00Z");
    const page = [event({ createdAt: new Date(t.getTime() + 5) }), event({ createdAt: t })];
    expect(nextCursor(page, null)).toEqual({ before: t.getTime() + 1, skip: 1 });
    const same = [event({ createdAt: t }), event({ createdAt: t })];
    expect(nextCursor(same, { before: t.getTime() + 1, skip: 1 })).toEqual({
      before: t.getTime() + 1,
      skip: 3,
    });
  });

  it("prefixes every cell a spreadsheet would run", () => {
    const csv = toCsv(
      [event({ userAgent: "+cmd", errorCode: "-1", ipAddress: "@sum", sessionId: "\tx" })],
      false,
    );
    expect(csv).toContain(",'+cmd,");
    expect(csv).toContain(",'-1,");
    expect(csv).toContain(",'@sum,");
    expect(csv).toContain(",'\tx,");
  });
});

describe("verify-chain over HTTP", () => {
  it("is for admins", async () => {
    const { userHeaders, record, http } = await setup({ hashChain: true });
    await record("one");
    const adminHeaders = await userHeaders("admin@example.com", "admin");
    const user = await userHeaders("user@example.com");

    const ok = await http("/audit-log/verify-chain", {
      method: "POST",
      headers: adminHeaders,
      body: "{}",
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ valid: true, nextSequence: null });

    const forbidden = await http("/audit-log/verify-chain", {
      method: "POST",
      headers: user,
      body: "{}",
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({
      code: AUDIT_LOG_ERROR_CODES.YOU_ARE_NOT_ALLOWED_TO_VERIFY_THE_CHAIN.code,
    });
    expect((await http("/audit-log/verify-chain", { method: "POST", body: "{}" })).status).toBe(
      401,
    );
    const tooMany = await http("/audit-log/verify-chain", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ limit: 10_001 }),
    });
    expect(tooMany.status).toBe(400);
  });

  it("checks a range at a time, and continues with nextSequence", async () => {
    const { auth, record } = await setup({ hashChain: true });
    for (let i = 0; i < 5; i++) await record(`event-${i}`);

    const first = await auth.api.verifyAuditChain({ body: { limit: 2 } });
    expect(first).toMatchObject({
      valid: true,
      checked: 2,
      firstSequence: 1,
      lastSequence: 2,
      nextSequence: 2,
    });
    const second = await auth.api.verifyAuditChain({ body: { afterSequence: 2, limit: 2 } });
    expect(second).toMatchObject({ checked: 2, firstSequence: 3, nextSequence: 4 });
    const last = await auth.api.verifyAuditChain({ body: { afterSequence: 4, limit: 2 } });
    expect(last).toMatchObject({
      valid: true,
      checked: 1,
      firstSequence: 5,
      lastSequence: 5,
      nextSequence: null,
      unchainedEvents: 0,
    });
    // A limit that ends exactly at the newest link: nothing more.
    expect(await auth.api.verifyAuditChain({ body: { afterSequence: 3, limit: 2 } })).toMatchObject(
      { checked: 2, nextSequence: null },
    );
  });

  it("finds a broken link at the start of a range", async () => {
    const { auth, context, record } = await setup({ hashChain: true });
    for (let i = 0; i < 3; i++) await record(`event-${i}`);
    await context.adapter.update<AuditChainLink>({
      model: "auditChain",
      where: [{ field: "sequence", value: 2 }],
      update: { hash: "f".repeat(64) },
    });
    const result = await auth.api.verifyAuditChain({ body: { afterSequence: 2 } });
    expect(result).toMatchObject({
      valid: false,
      problems: [{ sequence: 3, problem: "broken-link" }],
    });
  });
});
