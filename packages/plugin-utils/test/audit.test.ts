import type { BetterAuthPlugin } from "@better-auth/core";
import { createAuthEndpoint } from "better-auth/api";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import { recordAuditEvent } from "../src/audit";

/** A plugin whose endpoint records an event, as the blocklist, referral, and waitlist do. */
const recorder = {
  id: "recorder",
  endpoints: {
    recordSomething: createAuthEndpoint("/recorder/record", { method: "POST" }, async (ctx) => {
      await recordAuditEvent({ type: "recorder.did-something", metadata: { ok: true } });
      return ctx.json({ success: true });
    }),
  },
} satisfies BetterAuthPlugin;

describe("recordAuditEvent", () => {
  it("does nothing outside a request", async () => {
    await expect(recordAuditEvent({ type: "x.y" })).resolves.toBeUndefined();
  });

  it("does nothing when the app has no audit log", async () => {
    const { auth } = await getTestInstance({ plugins: [recorder] }, { disableTestUser: true });
    await expect(auth.api.recordSomething()).resolves.toEqual({ success: true });
  });

  it("forwards the event to the audit log plugin", async () => {
    const recordEvent = vi.fn(async () => {});
    const auditLog = { id: "audit-log", recordEvent } satisfies BetterAuthPlugin & {
      recordEvent: unknown;
    };
    const { auth } = await getTestInstance(
      { plugins: [recorder, auditLog] },
      { disableTestUser: true },
    );
    await auth.api.recordSomething();
    expect(recordEvent).toHaveBeenCalledWith({
      type: "recorder.did-something",
      metadata: { ok: true },
    });
  });
});
