import type { BetterAuthOptions } from "better-auth";
import { getTestInstance } from "better-auth/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consoleDestination, httpDestination } from "../src/destinations";
import type { AuditEvent, AuditLogDestinationEntry, AuditLogOptions } from "../src/index";
import { AUDIT_LOG_ERROR_CODES, auditLog, memoryStorage } from "../src/index";
import { resolveOptions } from "../src/options";

const PASSWORD = "password1234";

async function setup(options: AuditLogOptions = {}, config: Partial<BetterAuthOptions> = {}) {
  const { auth } = await getTestInstance(
    { ...config, emailAndPassword: { enabled: true }, plugins: [auditLog(options)] },
    { disableTestUser: true },
  );
  const context = await auth.$context;
  const error = vi.spyOn(context.logger, "error").mockImplementation(() => {});
  let count = 0;
  /** Signs up a new user: a `sign-up` and a `sign-in` event. */
  const signUp = () =>
    auth.api.signUpEmail({
      body: { email: `user${++count}@example.com`, password: PASSWORD, name: "User" },
    });
  return { auth, context, error, signUp };
}

/** A destination that keeps what it gets. */
function collector(extra: Partial<AuditLogDestinationEntry> = {}) {
  const batches: AuditEvent[][] = [];
  const destination = {
    name: "collector",
    send: (batch: AuditEvent[]) => {
      batches.push(batch);
    },
    ...extra,
  } as AuditLogDestinationEntry;
  return { batches, destination, types: () => batches.flat().map((event) => event.type) };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function expectError(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toMatchObject({ statusCode: status, body: { code } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("destination options", () => {
  const send = () => {};

  it("validates destinations at startup", () => {
    expect(resolveOptions({}).destinations).toEqual([]);
    expect(() => resolveOptions({ destinations: [{ name: "", send }] })).toThrow(/name/);
    expect(() =>
      resolveOptions({
        destinations: [
          { name: "a", send },
          { name: "a", send },
        ],
      }),
    ).toThrow(/Two destinations are named "a"/);
    expect(() =>
      resolveOptions({ destinations: [{ name: "a" } as unknown as AuditLogDestinationEntry] }),
    ).toThrow(/"send" of destinations "a"/);
    expect(() =>
      resolveOptions({ destinations: [{ name: "a", send, events: ["has space"] }] }),
    ).toThrow(/destinations "a".events/);
    expect(() =>
      resolveOptions({ destinations: [{ name: "a", send, batch: { size: 0 } }] }),
    ).toThrow(/batch.size/);
    expect(() =>
      resolveOptions({ destinations: [{ name: "a", send, batch: { size: 1001 } }] }),
    ).toThrow(/batch.size/);
    expect(() =>
      resolveOptions({ destinations: [{ name: "a", send, batch: { wait: -1 } }] }),
    ).toThrow(/batch.wait/);
    expect(() => resolveOptions({ destinations: [{ name: "a", send, timeout: 0 }] })).toThrow(
      /timeout/,
    );
  });

  it("defaults to one event per send, at once, and waits a second for bigger batches", () => {
    const [single, batched] = resolveOptions({
      destinations: [
        { name: "a", send },
        { name: "b", send, batch: { size: 10 } },
      ],
    }).destinations;
    expect(single).toMatchObject({ size: 1, wait: 0, timeout: 10_000, events: null });
    expect(batched).toMatchObject({ size: 10, wait: 1000 });
  });

  it("types send from transform", () => {
    auditLog({
      destinations: [
        { name: "plain", send: (batch) => void batch[0]?.type },
        {
          name: "flat",
          transform: (event) => ({ kind: event.type }),
          send: (batch: { kind: string }[]) => void batch[0]?.kind,
        },
      ],
    });
  });
});

describe("destinations", () => {
  it("get every stored event, after it is stored", async () => {
    const storage = memoryStorage();
    const stored: string[] = [];
    const { batches, destination } = collector({
      send: (batch: AuditEvent[]) => {
        stored.push(...batch.map((event) => (storage.events.includes(event) ? "stored" : "not")));
        batches.push(batch);
      },
    });
    const { auth, signUp } = await setup({ storage, destinations: [destination] });
    await signUp();
    await auth.api.flushAuditDestinations();
    expect(batches.map((batch) => batch.map((event) => event.type))).toEqual([
      ["sign-up"],
      ["sign-in"],
    ]);
    expect(batches[0]?.[0]?.id).toBeTruthy();
    expect(stored).toEqual(["stored", "stored"]);
  });

  it("work with the default database storage, and never carry passwords", async () => {
    const { destination, batches, types } = collector();
    const { auth, signUp } = await setup({ destinations: [destination] });
    await signUp();
    await auth.api.flushAuditDestinations();
    expect(types()).toEqual(["sign-up", "sign-in"]);
    expect(JSON.stringify(batches)).not.toContain(PASSWORD);
  });

  it("filter, transform, and skip events per destination", async () => {
    const signIns = collector({ name: "sign-ins", events: ["sign-in"] });
    const flat = collector({
      name: "flat",
      transform: (event: AuditEvent) =>
        event.type === "sign-up" ? null : { kind: event.type, user: event.userId },
    });
    const { auth, signUp } = await setup({
      destinations: [signIns.destination, flat.destination],
    });
    await signUp();
    await auth.api.flushAuditDestinations();
    expect(signIns.types()).toEqual(["sign-in"]);
    expect(flat.batches).toEqual([[{ kind: "sign-in", user: expect.any(String) }]]);
  });

  it("skip an event for one destination when its transform throws", async () => {
    const broken = collector({
      name: "broken",
      transform: () => {
        throw new Error("bad mapping");
      },
    });
    const working = collector({ name: "working" });
    const { auth, error, signUp } = await setup({
      destinations: [broken.destination, working.destination],
    });
    await signUp();
    await auth.api.flushAuditDestinations();
    expect(broken.batches).toEqual([]);
    expect(working.types()).toEqual(["sign-up", "sign-in"]);
    expect(error).toHaveBeenCalledWith(
      '[audit-log] destination "broken" failed',
      expect.objectContaining({ message: "bad mapping" }),
    );
  });

  it("never fail or slow down the request, or the other destinations", async () => {
    const working = collector({ name: "working" });
    const waiting: (() => void)[] = [];
    const { auth, error, signUp } = await setup({
      destinations: [
        {
          name: "down",
          send: () => {
            throw new Error("SIEM down");
          },
        },
        { name: "slow", send: () => new Promise<void>((resolve) => void waiting.push(resolve)) },
        working.destination,
      ],
    });
    await expect(signUp()).resolves.toMatchObject({ user: { email: "user1@example.com" } });
    const flushed = auth.api.flushAuditDestinations();
    await sleep(10);
    expect(working.types()).toEqual(["sign-up", "sign-in"]);
    expect(waiting).toHaveLength(2);
    for (const resolve of waiting) resolve();
    await flushed;
    expect(error).toHaveBeenCalledWith(
      '[audit-log] destination "down" failed',
      expect.objectContaining({ message: "SIEM down" }),
    );
  });

  it("abort a send after its timeout", async () => {
    let signal: AbortSignal | undefined;
    const { auth, error, signUp } = await setup({
      events: ["sign-up"],
      destinations: [
        {
          name: "hangs",
          timeout: 20,
          send: (_batch, context) => {
            signal = context.signal;
            return new Promise<void>(() => {});
          },
        },
      ],
    });
    await signUp();
    await auth.api.flushAuditDestinations();
    expect(signal?.aborted).toBe(true);
    expect(error).toHaveBeenCalledWith(
      '[audit-log] destination "hangs" failed',
      expect.objectContaining({ message: "timed out after 20 ms" }),
    );
  });

  it("batch by size, and send the rest on flush", async () => {
    const { destination, batches } = collector({ batch: { size: 3, wait: 60_000 } });
    const { auth, signUp } = await setup({ destinations: [destination] });
    await signUp();
    await signUp();
    await sleep(10);
    expect(batches.map((batch) => batch.length)).toEqual([3]);
    await auth.api.flushAuditDestinations();
    expect(batches.map((batch) => batch.length)).toEqual([3, 1]);
  });

  it("batch by time", async () => {
    const { destination, batches } = collector({ batch: { size: 100, wait: 30 } });
    const { signUp } = await setup({ destinations: [destination] });
    await signUp();
    await sleep(5);
    expect(batches).toEqual([]);
    await sleep(60);
    expect(batches.map((batch) => batch.map((event) => event.type))).toEqual([
      ["sign-up", "sign-in"],
    ]);
  });

  it("keep a waiting batch alive through background tasks", async () => {
    const tasks: Promise<unknown>[] = [];
    const { destination, batches } = collector({ batch: { size: 100, wait: 30 } });
    const { signUp } = await setup(
      { destinations: [destination] },
      { advanced: { backgroundTasks: { handler: (task) => void tasks.push(task) } } },
    );
    await signUp();
    expect(batches).toEqual([]);
    // What a platform's `waitUntil` does: wait for every background task.
    while (tasks.length > 0) await Promise.all(tasks.splice(0));
    expect(batches.map((batch) => batch.length)).toEqual([2]);
  });

  it("keep onEvent working", async () => {
    const seen: string[] = [];
    const { destination, types } = collector();
    const { auth, signUp } = await setup({
      destinations: [destination],
      onEvent: (event) => void seen.push(event.type),
    });
    await signUp();
    await auth.api.flushAuditDestinations();
    expect(seen).toEqual(["sign-up", "sign-in"]);
    expect(types()).toEqual(seen);
  });
});

describe("write-only storage", () => {
  const writeOnly = () => {
    const events: AuditEvent[] = [];
    return {
      events,
      write: async (input: Omit<AuditEvent, "id">) => {
        const event = { ...input, id: crypto.randomUUID() };
        events.push(event);
        return event;
      },
    };
  };

  it("records events, and answers the list and delete endpoints with an error", async () => {
    const storage = writeOnly();
    const { auth } = await setup({ storage });
    const { headers } = await auth.api
      .signUpEmail({
        body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
        returnHeaders: true,
      })
      .then((result) => ({
        headers: new Headers({
          cookie: result.headers
            .getSetCookie()
            .map((cookie) => cookie.split(";")[0])
            .join("; "),
        }),
      }));
    expect(storage.events.map((event) => event.type)).toEqual(["sign-up", "sign-in"]);
    await expectError(
      auth.api.listAuditEvents({ headers }),
      501,
      AUDIT_LOG_ERROR_CODES.READ_NOT_SUPPORTED.code,
    );
    await expectError(
      auth.api.deleteExpiredAuditEvents({ body: { days: 30 } }),
      501,
      AUDIT_LOG_ERROR_CODES.DELETE_NOT_SUPPORTED.code,
    );
  });

  it("can't be combined with retention", () => {
    expect(() => auditLog({ storage: writeOnly(), retention: { days: 30 } })).toThrow(
      /"retention" needs a storage that can delete events/,
    );
  });
});

describe("httpDestination", () => {
  const SECRET = `whsec_${btoa("a".repeat(32))}`;

  function stubFetch(status = 200) {
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL, init: RequestInit) => {
        requests.push(new Request(input, init));
        return new Response("ok", { status });
      }),
    );
    return requests;
  }

  it("validates its options", () => {
    expect(() => httpDestination({ url: "not a url" })).toThrow(/absolute URL/);
    expect(() => httpDestination({ url: "ftp://example.com" })).toThrow(/https:/);
    expect(() => httpDestination({ url: "https://example.com", secret: "short" })).toThrow(
      /secret/,
    );
    expect(() =>
      httpDestination({ url: "https://example.com", format: "xml" as unknown as "json" }),
    ).toThrow(/format/);
  });

  it("posts a JSON array, signed the Standard Webhooks way", async () => {
    const requests = stubFetch();
    const { auth, signUp } = await setup({
      destinations: [
        httpDestination({
          url: "https://siem.example.com/intake?token=abc",
          headers: { authorization: "Bearer key" },
          secret: SECRET,
          batch: { size: 2 },
        }),
      ],
    });
    await signUp();
    await auth.api.flushAuditDestinations();
    expect(requests).toHaveLength(1);
    const request = requests[0] as Request;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://siem.example.com/intake?token=abc");
    expect(request.headers.get("authorization")).toBe("Bearer key");
    expect(request.headers.get("content-type")).toBe("application/json");
    const body = await request.text();
    expect((JSON.parse(body) as AuditEvent[]).map((event) => event.type)).toEqual([
      "sign-up",
      "sign-in",
    ]);

    const id = request.headers.get("webhook-id");
    const timestamp = request.headers.get("webhook-timestamp");
    expect(id).toMatch(/^msg_/);
    expect(Math.abs(Number(timestamp) - Date.now() / 1000)).toBeLessThan(60);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("a".repeat(32)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${id}.${timestamp}.${body}`),
    );
    expect(request.headers.get("webhook-signature")).toBe(
      `v1,${btoa(String.fromCharCode(...new Uint8Array(expected)))}`,
    );
  });

  it("posts NDJSON, transformed", async () => {
    const requests = stubFetch();
    const { auth, signUp } = await setup({
      destinations: [
        httpDestination({
          url: "https://logs.example.com",
          format: "ndjson",
          transform: (event) => ({ message: event.type }),
          batch: { size: 2 },
        }),
      ],
    });
    await signUp();
    await auth.api.flushAuditDestinations();
    const request = requests[0] as Request;
    expect(request.headers.get("content-type")).toBe("application/x-ndjson");
    expect(request.headers.get("webhook-signature")).toBeNull();
    expect(await request.text()).toBe('{"message":"sign-up"}\n{"message":"sign-in"}\n');
  });

  it("logs a non-2xx answer with the origin only", async () => {
    stubFetch(503);
    const { auth, error, signUp } = await setup({
      events: ["sign-up"],
      destinations: [httpDestination({ name: "siem", url: "https://siem.example.com/?token=abc" })],
    });
    await signUp();
    await auth.api.flushAuditDestinations();
    expect(error).toHaveBeenCalledWith(
      '[audit-log] destination "siem" failed',
      expect.objectContaining({ message: "https://siem.example.com answered 503" }),
    );
  });
});

describe("consoleDestination", () => {
  it("logs one JSON line per event", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { auth, signUp } = await setup({ destinations: [consoleDestination()] });
    await signUp();
    await auth.api.flushAuditDestinations();
    // better-auth's own logger writes to the console too.
    const lines = log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as AuditEvent);
    expect(lines.map((event) => event.type)).toEqual(["sign-up", "sign-in"]);
  });
});
