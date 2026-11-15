import { admin, testUtils } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import { blocklist } from "../src/index";

// Lets a test make the duplicate pre-check miss once, to simulate a
// concurrent request that inserts the same rule in between.
const store = vi.hoisted(() => ({ missNextFind: false }));
vi.mock("../src/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/store")>();
  return {
    ...original,
    findStoredRule: async (...args: Parameters<typeof original.findStoredRule>) => {
      if (store.missNextFind) {
        store.missNextFind = false;
        return null;
      }
      return original.findStoredRule(...args);
    },
  };
});

describe("create-rule race", () => {
  it("answers RULE_ALREADY_EXISTS when the unique index rejects a concurrent duplicate", async () => {
    const { auth } = await getTestInstance(
      { plugins: [blocklist(), admin(), testUtils()] },
      { disableTestUser: true },
    );
    const { test } = await auth.$context;
    const user = await test.saveUser(test.createUser({ email: "root@example.org", role: "admin" }));
    const headers = await test.getAuthHeaders({ userId: user.id });
    const body = { target: "username" as const, value: "dup" };

    await auth.api.createBlocklistRule({ body, headers });
    // The pre-check misses the existing rule, as it would for a request
    // racing the first one; the insert then hits the unique index.
    store.missNextFind = true;
    await expect(auth.api.createBlocklistRule({ body, headers })).rejects.toMatchObject({
      statusCode: 400,
      body: { code: "RULE_ALREADY_EXISTS" },
    });
  });
});
