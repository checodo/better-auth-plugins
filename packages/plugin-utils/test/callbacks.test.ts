import { describe, expect, it, vi } from "vitest";
import { runCallback } from "../src/callbacks";

function context(background: boolean) {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    logger: { error: vi.fn() },
    runInBackgroundOrAwait: vi.fn(async (task: Promise<unknown>) => {
      if (background) pending.push(task);
      else await task;
    }),
  };
}

describe("runCallback", () => {
  it("awaits the callback without background tasks", async () => {
    const ctx = context(false);
    const callback = vi.fn(async () => {});
    await runCallback(ctx as never, "waitlist", "onJoin", callback);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("hands the callback to background tasks when configured", async () => {
    const ctx = context(true);
    let done = false;
    await runCallback(ctx as never, "waitlist", "onJoin", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      done = true;
    });
    expect(done).toBe(false);
    await Promise.all(ctx.pending);
    expect(done).toBe(true);
  });

  it("logs errors with the plugin id and never throws", async () => {
    const ctx = context(false);
    const error = new Error("boom");
    await expect(
      runCallback(ctx as never, "referral", "onReferral", () => {
        throw error;
      }),
    ).resolves.toBeUndefined();
    expect(ctx.logger.error).toHaveBeenCalledWith("[referral] onReferral threw an error", error);
  });

  it("logs errors of background callbacks too", async () => {
    const ctx = context(true);
    await runCallback(ctx as never, "referral", "onReferral", async () => {
      throw new Error("later");
    });
    await Promise.all(ctx.pending);
    expect(ctx.logger.error).toHaveBeenCalledOnce();
  });
});
