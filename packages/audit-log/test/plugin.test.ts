import { describe, expect, it } from "vitest";
import type { AuditEventInput } from "../src/index";
import { auditLog, memoryStorage } from "../src/index";
import { compileEventFilter, resolveOptions } from "../src/options";
import { signInMethod } from "../src/utils/method";
import { redact } from "../src/utils/redact";
import { severityOf } from "../src/utils/severity";

describe("options", () => {
  it("has defaults", () => {
    expect(resolveOptions({})).toMatchObject({
      events: null,
      paths: {},
      captureIp: true,
      captureUserAgent: true,
      retention: undefined,
      adminRoles: ["admin"],
      adminUserIds: [],
    });
    expect(resolveOptions({ retention: { days: 30 } }).retention).toEqual({
      days: 30,
      sweepInterval: 3600,
    });
  });

  it("throws on invalid static configuration", () => {
    expect(() => resolveOptions({ events: ["has space"] })).toThrow(/events/);
    expect(() => resolveOptions({ paths: { "no-slash": "x" } })).toThrow(/must start with/);
    expect(() => resolveOptions({ paths: { "/x": "bad type!" } })).toThrow(/Invalid event type/);
    expect(() =>
      resolveOptions({ severity: { "sign-in": "urgent" as unknown as "high" } }),
    ).toThrow(/severity/);
    expect(() => resolveOptions({ retention: { days: 0 } })).toThrow(/retention.days/);
    expect(() => resolveOptions({ retention: { days: 1, sweepInterval: -1 } })).toThrow(
      /sweepInterval/,
    );
  });

  it("renames the table with the schema option", () => {
    const plugin = auditLog({ schema: { auditEvent: { modelName: "audit_events" } } });
    expect(plugin.schema).toMatchObject({ auditEvent: { modelName: "audit_events" } });
    expect(auditLog().schema).not.toMatchObject({ auditEvent: { modelName: "audit_events" } });
  });

  it("has no table with custom storage", () => {
    expect(auditLog({ storage: memoryStorage() })).not.toHaveProperty("schema");
  });
});

describe("compileEventFilter", () => {
  it("matches exact types and groups", () => {
    const matches = compileEventFilter(["sign-in", "admin.*"]);
    expect(matches("sign-in")).toBe(true);
    expect(matches("admin.ban-user")).toBe(true);
    expect(matches("sign-up")).toBe(false);
    expect(matches("administrator")).toBe(false);
  });
});

describe("signInMethod", () => {
  it("names the method from the endpoint", () => {
    expect(signInMethod("/sign-in/email")).toBe("email");
    expect(signInMethod("/sign-up/email")).toBe("email");
    expect(signInMethod("/callback/:id", { id: "github" })).toBe("github");
    expect(signInMethod("/oauth2/callback/:providerId", { providerId: "okta" })).toBe("okta");
    expect(signInMethod("/sign-in/social", {}, { provider: "google" })).toBe("google");
    expect(signInMethod("/magic-link/verify")).toBe("magic-link");
    expect(signInMethod("/two-factor/verify-totp")).toBe("two-factor");
    expect(signInMethod(undefined)).toBeNull();
  });
});

describe("redact", () => {
  it("hides secret-looking keys at any depth, and keeps the rest", () => {
    expect(
      redact({
        plan: "pro",
        newPassword: "x",
        accessToken: "x",
        nested: [{ clientSecret: "x", otp: "123456", count: 2 }],
        passkeyId: "kept",
        at: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toEqual({
      plan: "pro",
      newPassword: "[redacted]",
      accessToken: "[redacted]",
      nested: [{ clientSecret: "[redacted]", otp: "[redacted]", count: 2 }],
      passkeyId: "kept",
      at: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("severityOf", () => {
  it("uses overrides, then built-in severities", () => {
    expect(severityOf("sign-in", "success", {})).toBe("low");
    expect(severityOf("sign-in", "failure", {})).toBe("medium");
    expect(severityOf("admin.set-role", "success", {})).toBe("critical");
    expect(severityOf("admin.ban-user", "success", {})).toBe("high");
    expect(severityOf("billing.paid", "success", {})).toBe("low");
    expect(severityOf("sign-in", "success", { "sign-in": "high" })).toBe("high");
  });
});

describe("memoryStorage", () => {
  const event = (overrides: Partial<AuditEventInput>): AuditEventInput => ({
    type: "sign-in",
    status: "success",
    severity: "low",
    userId: "u-1",
    actorUserId: "u-1",
    sessionId: null,
    organizationId: null,
    ipAddress: null,
    userAgent: null,
    errorCode: null,
    metadata: null,
    createdAt: new Date(),
    ...overrides,
  });

  it("reads newest first, filtered and paginated, and deletes old events", async () => {
    const storage = memoryStorage();
    await storage.write(event({ createdAt: new Date("2026-01-01") }));
    await storage.write(event({ type: "sign-out", createdAt: new Date("2026-02-01") }));
    await storage.write(event({ userId: "u-2", createdAt: new Date("2026-03-01") }));

    const all = await storage.read({ limit: 10, offset: 0 });
    expect(all.events.map((e) => e.createdAt.getMonth())).toEqual([2, 1, 0]);
    expect(
      (await storage.read({ userId: "u-1", type: "sign-in", limit: 10, offset: 0 })).total,
    ).toBe(1);
    expect(
      (
        await storage.read({
          from: new Date("2026-02-01"),
          to: new Date("2026-03-01"),
          limit: 10,
          offset: 0,
        })
      ).events,
    ).toHaveLength(1);
    expect((await storage.read({ limit: 1, offset: 1 })).events[0]?.type).toBe("sign-out");

    expect(await storage.deleteOlderThan(new Date("2026-02-15"))).toBe(2);
    expect(storage.events).toHaveLength(1);
  });
});
