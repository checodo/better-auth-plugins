import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import { waitlist } from "../src/index";
import { resolveOptions } from "../src/options";
import { isAllowedEmail, normalizeDomain, normalizeEmail } from "../src/utils/email";

// Lets a test make the duplicate pre-check miss once, to simulate a
// concurrent request that inserts the same email in between.
const store = vi.hoisted(() => ({ missNextFind: 0 }));
vi.mock("../src/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/store")>();
  return {
    ...original,
    findEntryByEmail: async (...args: Parameters<typeof original.findEntryByEmail>) => {
      if (store.missNextFind > 0) {
        store.missNextFind--;
        return null;
      }
      return original.findEntryByEmail(...args);
    },
  };
});

/** Most tests don't exercise double opt-in, which needs `sendConfirmationEmail`. */
const base = { confirmEmail: false } as const;

describe("options", () => {
  it("splits allow into emails and domains", () => {
    const resolved = resolveOptions({
      ...base,
      allow: ["Ada@Example.com", "@acme.com", "Corp.io."],
    });
    expect([...resolved.allowEmails]).toEqual(["ada@example.com"]);
    expect(resolved.allowDomains).toEqual(["acme.com", "corp.io"]);
  });

  it("throws on invalid static configuration", () => {
    expect(() => resolveOptions({ ...base, inviteExpiresIn: -1 })).toThrow(/inviteExpiresIn/);
    expect(() => resolveOptions({ ...base, maxEntries: Number.NaN })).toThrow(/maxEntries/);
    expect(() => resolveOptions({ ...base, allow: [" "] })).toThrow(/allow/);
    expect(() => resolveOptions({ ...base, retention: { rejected: 0 } })).toThrow(
      /retention\.rejected/,
    );
    expect(() => resolveOptions({ ...base, retention: { registered: -1 } })).toThrow(
      /retention\.registered/,
    );
    expect(() => resolveOptions({ ...base, retention: { sweepInterval: Number.NaN } })).toThrow(
      /retention\.sweepInterval/,
    );
    expect(() => resolveOptions({ ...base, confirmationExpiresIn: 0 })).toThrow(
      /confirmationExpiresIn/,
    );
  });

  it("requires sendConfirmationEmail while double opt-in is on, as it is by default", () => {
    expect(() => resolveOptions({})).toThrow(/sendConfirmationEmail/);
    expect(resolveOptions({ sendConfirmationEmail: () => {} }).confirmEmail).toBe(true);
    expect(resolveOptions({ confirmEmail: false }).confirmEmail).toBe(false);
  });

  it("has defaults", () => {
    const resolved = resolveOptions({ sendConfirmationEmail: () => {} });
    expect(resolved).toMatchObject({
      enabled: true,
      confirmEmail: true,
      confirmationExpiresIn: 2 * 24 * 60 * 60 * 1000,
      requireInviteCode: false,
      inviteExpiresIn: 7 * 24 * 60 * 60 * 1000,
      adminRoles: ["admin"],
    });
    expect(resolved.bypass(null)).toBe(false);
  });

  it("renames the table with the schema option", () => {
    const plugin = waitlist({ ...base, schema: { waitlistEntry: { modelName: "waitlist" } } });
    expect((plugin.schema.waitlistEntry as { modelName?: string }).modelName).toBe("waitlist");
    expect(waitlist(base).schema.waitlistEntry).not.toHaveProperty("modelName", "waitlist");
  });
});

describe("email helpers", () => {
  it("normalize", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(normalizeDomain("@Example.COM.")).toBe("example.com");
  });

  it("match exact emails and domains with subdomains", () => {
    const allow = { allowEmails: new Set(["vip@example.com"]), allowDomains: ["acme.com"] };
    expect(isAllowedEmail("vip@example.com", allow)).toBe(true);
    expect(isAllowedEmail("ada@acme.com", allow)).toBe(true);
    expect(isAllowedEmail("ada@eu.acme.com", allow)).toBe(true);
    expect(isAllowedEmail("ada@notacme.com", allow)).toBe(false);
    expect(isAllowedEmail("other@example.com", allow)).toBe(false);
  });
});

describe("join race", () => {
  it("answers success when the unique index rejects a concurrent duplicate", async () => {
    const onJoin = vi.fn();
    const { auth } = await getTestInstance(
      { plugins: [waitlist({ ...base, onJoin })] },
      { disableTestUser: true },
    );
    const body = { email: "ada@example.com" };
    await auth.api.joinWaitlist({ body });
    // The pre-check misses the existing entry, as it would for a request
    // racing the first one; the insert then hits the unique index.
    store.missNextFind = 1;
    await expect(auth.api.joinWaitlist({ body })).resolves.toEqual({ success: true });
    expect(onJoin).toHaveBeenCalledTimes(1);
  });
});
