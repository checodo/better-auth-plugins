import { testUtils } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import type { Referral } from "../src/index";
import { referral } from "../src/index";
import { resolveOptions } from "../src/options";
import { recordStep } from "../src/referrals";
import { CODE_ALPHABET, generateCode, isWellFormedCode, normalizeCode } from "../src/utils/code";
import { maskEmail } from "../src/utils/mask";

// Lets a test make a store function fail or miss once, to simulate a
// concurrent request or a database error.
const store = vi.hoisted(() => ({ missNextCodeLookup: false, failNextReferral: false }));
vi.mock("../src/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/store")>();
  return {
    ...original,
    findCodeByUserId: async (...args: Parameters<typeof original.findCodeByUserId>) => {
      if (store.missNextCodeLookup) {
        store.missNextCodeLookup = false;
        return null;
      }
      return original.findCodeByUserId(...args);
    },
    createReferral: async (...args: Parameters<typeof original.createReferral>) => {
      if (store.failNextReferral) {
        store.failNextReferral = false;
        throw new Error("database down");
      }
      return original.createReferral(...args);
    },
  };
});

describe("options", () => {
  it("has defaults", () => {
    expect(resolveOptions({})).toMatchObject({
      codeLength: 8,
      createCodeOnSignUp: false,
      steps: [],
      invalidCode: "ignore",
      maskEmails: true,
      adminRoles: ["admin"],
    });
  });

  it("throws on invalid static configuration", () => {
    expect(() => resolveOptions({ codeLength: 4 })).toThrow(/codeLength/);
    expect(() => resolveOptions({ codeLength: 8.5 })).toThrow(/codeLength/);
    expect(() => resolveOptions({ maxReferralsPerUser: 0 })).toThrow(/maxReferralsPerUser/);
    expect(() => resolveOptions({ rewardRetry: { delay: 10 } })).toThrow(/rewardRetry.delay/);
    expect(() => resolveOptions({ rewardRetry: { maxAttempts: 0 } })).toThrow(
      /rewardRetry.maxAttempts/,
    );
    expect(() => resolveOptions({ steps: ["sign-up"] })).toThrow(/sign-up/);
    expect(() => resolveOptions({ steps: ["a", "a"] })).toThrow(/twice/);
    expect(() => resolveOptions({ steps: ["has space"] })).toThrow(/Invalid step/);
    expect(() => resolveOptions({ steps: ["x".repeat(65)] })).toThrow(/Invalid step/);
  });

  it("renames tables with the schema option", () => {
    const plugin = referral({ schema: { referral: { modelName: "referrals" } } });
    expect((plugin.schema.referral as { modelName?: string }).modelName).toBe("referrals");
    expect(referral().schema.referral).not.toHaveProperty("modelName", "referrals");
  });
});

describe("codes", () => {
  it("are generated from the alphabet, at the given length", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateCode(8);
      expect(code).toHaveLength(8);
      for (const char of code) expect(CODE_ALPHABET).toContain(char);
    }
  });

  it("contain no vowels, so they can't spell words", () => {
    const codes = Array.from({ length: 200 }, () => generateCode(8)).join("");
    expect(codes).not.toMatch(/[AEIOUY]/);
    expect(CODE_ALPHABET).not.toMatch(/[AEIOUY01L]/);
  });

  it("use every symbol of the alphabet", () => {
    const seen = new Set(generateCode(5000));
    expect(seen.size).toBe(CODE_ALPHABET.length);
  });

  it("are normalized and validated", () => {
    expect(normalizeCode(" vip-ada ")).toBe("VIP-ADA");
    expect(isWellFormedCode("VIP_ADA-1")).toBe(true);
    expect(isWellFormedCode("ABC")).toBe(false);
    expect(isWellFormedCode("HAS SPACE")).toBe(false);
    expect(isWellFormedCode("X".repeat(65))).toBe(false);
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("ada@example.com")).toBe("a***@example.com");
    expect(maskEmail("not-an-email")).toBe("***");
  });
});

describe("races and failures", () => {
  it("returns the stored code when a concurrent request created one first", async () => {
    const { auth } = await getTestInstance(
      { plugins: [referral(), testUtils()] },
      { disableTestUser: true },
    );
    const { test } = await auth.$context;
    const user = await test.saveUser(test.createUser({ email: "ada@example.com" }));
    const headers = await test.getAuthHeaders({ userId: user.id });
    const { code } = await auth.api.createReferralCode({ headers });

    // The lookup misses the existing code, as it would for a request
    // racing the first one; the insert then hits the unique index.
    store.missNextCodeLookup = true;
    expect(await auth.api.createReferralCode({ headers })).toEqual({ code });
  });

  it("runs onReferralCompleted once when two requests finish the last step together", async () => {
    const onReferralCompleted = vi.fn();
    const options = resolveOptions({ steps: ["first-purchase"], onReferralCompleted });
    const { auth } = await getTestInstance(
      { plugins: [referral({ steps: ["first-purchase"] }), testUtils()] },
      { disableTestUser: true },
    );
    const context = await auth.$context;
    const ada = await context.test.saveUser(context.test.createUser({ email: "ada@example.com" }));
    const bob = await context.test.saveUser(context.test.createUser({ email: "bob@example.com" }));
    const pending = await context.adapter.create<Record<string, unknown>, Referral>({
      model: "referral",
      data: {
        referrerUserId: ada.id,
        referredUserId: bob.id,
        code: "ADA12345",
        status: "pending",
        createdAt: new Date(),
      },
    });

    // Both requests read the referral while it was still pending.
    await Promise.all([
      recordStep(context.adapter, context, options, pending, "first-purchase"),
      recordStep(context.adapter, context, options, pending, "first-purchase"),
    ]);
    expect(onReferralCompleted).toHaveBeenCalledOnce();
  });

  it("records nothing and pays no reward when the sign-up is rolled back", async () => {
    // better-auth runs `after` hooks once the sign-up's transaction has
    // committed; this guards that the referral relies on it.
    const onReferral = vi.fn();
    const onReferralCompleted = vi.fn();
    // Creating the account row fails after the user row was written, inside
    // the same transaction, so the whole sign-up is rolled back.
    const failingPlugin = {
      id: "fails-on-account-create",
      init: () => ({
        options: {
          databaseHooks: {
            account: {
              create: {
                before: async () => {
                  throw new Error("account could not be created");
                },
              },
            },
          },
        },
      }),
    };
    const { auth } = await getTestInstance(
      {
        plugins: [
          referral({ steps: [], onReferral, onReferralCompleted }),
          testUtils(),
          failingPlugin,
        ],
      },
      { disableTestUser: true, transaction: true },
    );
    const context = await auth.$context;
    const ada = await context.test.saveUser(context.test.createUser({ email: "ada@example.com" }));
    const headers = await context.test.getAuthHeaders({ userId: ada.id });
    const { code } = await auth.api.createReferralCode({ headers });

    await expect(
      auth.api.signUpEmail({
        body: { email: "bob@example.com", password: "password1234", name: "Bob" },
        headers: new Headers({ "x-referral-code": code }),
      }),
    ).rejects.toThrow();

    expect(await context.internalAdapter.findUserByEmail("bob@example.com")).toBeNull();
    expect(await context.adapter.count({ model: "referral" })).toBe(0);
    expect(onReferral).not.toHaveBeenCalled();
    expect(onReferralCompleted).not.toHaveBeenCalled();
  });

  it("logs a failed referral without failing the sign-up", async () => {
    const { auth } = await getTestInstance(
      { plugins: [referral(), testUtils()] },
      { disableTestUser: true },
    );
    const context = await auth.$context;
    const user = await context.test.saveUser(context.test.createUser({ email: "ada@example.com" }));
    const headers = await context.test.getAuthHeaders({ userId: user.id });
    const { code } = await auth.api.createReferralCode({ headers });
    const logError = vi.spyOn(context.logger, "error").mockImplementation(() => {});

    store.failNextReferral = true;
    await expect(
      auth.api.signUpEmail({
        body: { email: "bob@example.com", password: "password1234", name: "Bob" },
        headers: new Headers({ "x-referral-code": code }),
      }),
    ).resolves.toMatchObject({ user: { email: "bob@example.com" } });
    expect(logError).toHaveBeenCalledWith(
      "[referral] failed to record the referral",
      expect.any(Error),
    );
  });
});
