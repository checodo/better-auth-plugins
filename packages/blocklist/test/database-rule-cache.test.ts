import { describe, expect, it, vi } from "vitest";
import { DatabaseRuleCache } from "../src/utils/database-rule-cache";
import { RuleSet } from "../src/utils/rule-set";

describe("DatabaseRuleCache", () => {
  it("loads once per target within the TTL", async () => {
    const cache = new DatabaseRuleCache(60_000);
    const load = vi.fn(async () => new RuleSet());
    await cache.get("email", load);
    await cache.get("email", load);
    await cache.get("username", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("loads every time with a TTL of 0", async () => {
    const cache = new DatabaseRuleCache(0);
    const load = vi.fn(async () => new RuleSet());
    await cache.get("email", load);
    await cache.get("email", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("loads again after the TTL or clear()", async () => {
    vi.useFakeTimers();
    try {
      const cache = new DatabaseRuleCache(1000);
      const load = vi.fn(async () => new RuleSet());
      await cache.get("email", load);
      vi.advanceTimersByTime(1001);
      await cache.get("email", load);
      cache.clear();
      await cache.get("email", load);
      expect(load).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not cache a failed load", async () => {
    const cache = new DatabaseRuleCache(60_000);
    const failing = vi.fn(async (): Promise<RuleSet> => {
      throw new Error("database down");
    });
    await expect(cache.get("email", failing)).rejects.toThrow("database down");
    const load = vi.fn(async () => new RuleSet());
    await cache.get("email", load);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
