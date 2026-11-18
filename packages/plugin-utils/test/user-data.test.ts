import { describe, expect, it, vi } from "vitest";
import { eraseOnUserDelete } from "../src/user-data";

describe("eraseOnUserDelete", () => {
  it("erases with the user's id and email", async () => {
    const erase = vi.fn(async () => {});
    const hook = eraseOnUserDelete({ logger: { error: vi.fn() } } as never, "waitlist", "x", erase);
    await hook({ id: "u-1", email: "ada@example.com" });
    await hook({ id: "u-2" });
    expect(erase.mock.calls).toEqual([
      [{ id: "u-1", email: "ada@example.com" }],
      [{ id: "u-2", email: null }],
    ]);
  });

  it("logs a failure instead of throwing: the user is deleted already", async () => {
    const error = vi.fn();
    const hook = eraseOnUserDelete(
      { logger: { error } } as never,
      "referral",
      "the referral data",
      async () => {
        throw new Error("database down");
      },
    );
    await expect(hook({ id: "u-1" })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      "[referral] failed to erase the referral data of a deleted user",
      expect.any(Error),
    );
  });
});
