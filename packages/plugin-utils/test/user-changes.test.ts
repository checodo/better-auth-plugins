import type { GenericEndpointContext } from "@better-auth/core";
import { describe, expect, it, vi } from "vitest";
import { signInSessionOf } from "../src/sign-in";
import { createNewUserMemory, updatedUserId } from "../src/user-changes";

const context = (partial: Record<string, unknown>) =>
  ({ context: { session: null }, ...partial }) as unknown as GenericEndpointContext;

/** An unsigned JWT with this payload (better-auth verifies it before `updatedUserId` runs). */
const jwt = (payload: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

describe("updatedUserId", () => {
  it("is the admin's target for /admin/update-user", () => {
    expect(updatedUserId(context({ path: "/admin/update-user", body: { userId: "u1" } }))).toBe(
      "u1",
    );
  });

  it("is the user bound to an email-change token for /verify-email", () => {
    const token = jwt({ email: "ada@example.com", updateTo: "new@example.com", userId: "u2" });
    expect(updatedUserId(context({ path: "/verify-email", query: { token } }))).toBe("u2");
    expect(updatedUserId(context({ path: "/verify-email", query: { token: "garbage" } }))).toBe(
      null,
    );
  });

  it("is the signed-in user otherwise", () => {
    const signedIn = context({ path: "/change-email" });
    (signedIn.context as { session: unknown }).session = { user: { id: "u3" } };
    expect(updatedUserId(signedIn)).toBe("u3");
  });
});

describe("createNewUserMemory", () => {
  it("remembers a new user for a few seconds, once", () => {
    vi.useFakeTimers();
    try {
      const memory = createNewUserMemory();
      memory.remember("u1");
      expect(memory.wasJustCreated("u1")).toBe(true);
      expect(memory.wasJustCreated("u1")).toBe(false);
      memory.remember("u2");
      vi.advanceTimersByTime(10_001);
      expect(memory.wasJustCreated("u2")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("signInSessionOf", () => {
  const newSession = { session: { id: "s1" }, user: { id: "u1" } };
  const hook = (partial: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ({
      path: "/sign-in/email",
      context: { session: null, newSession, returned: { ok: true }, ...extra },
      ...partial,
    }) as unknown as GenericEndpointContext;

  it("is the new session of a sign-in", () => {
    expect(signInSessionOf(hook({}))).toBe(newSession);
  });

  it("is null for rotations, impersonations, failures, and signed-in requests", () => {
    expect(signInSessionOf(hook({ path: "/change-password" }))).toBeNull();
    expect(
      signInSessionOf(
        hook({}, { newSession: { ...newSession, session: { impersonatedBy: "admin" } } }),
      ),
    ).toBeNull();
    expect(signInSessionOf(hook({}, { session: newSession }))).toBeNull();
    expect(signInSessionOf(hook({}, { newSession: null }))).toBeNull();
  });
});
