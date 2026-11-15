import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import { waitlist } from "../src/index";
import { hashSecret } from "../src/utils/secret";

// The OAuth state of the request that creates the user. In a real social
// sign-in it holds `additionalData` from `signIn.social`; here a test sets
// it directly, so no OAuth provider is needed.
const oauth = vi.hoisted(() => ({ state: null as Record<string, unknown> | null }));
vi.mock("better-auth/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("better-auth/api")>();
  return { ...original, getOAuthState: async () => oauth.state };
});

describe("invite code from a social sign-in", () => {
  it("is read from the OAuth state's additionalData", async () => {
    const { auth } = await getTestInstance(
      { plugins: [waitlist({ confirmEmail: false, requireInviteCode: true })] },
      { disableTestUser: true },
    );
    const { adapter, internalAdapter } = await auth.$context;
    await auth.api.joinWaitlist({ body: { email: "ada@example.com" } });
    const entry = await adapter.findOne<{ id: string }>({
      model: "waitlistEntry",
      where: [{ field: "email", value: "ada@example.com" }],
    });
    const inviteCode = "a".repeat(32);
    await adapter.update({
      model: "waitlistEntry",
      where: [{ field: "id", value: entry?.id ?? "" }],
      update: { status: "approved", inviteCodeHash: await hashSecret(inviteCode) },
    });
    const create = () =>
      internalAdapter.createUser(
        { email: "ada@example.com", name: "Ada", emailVerified: true },
        { method: "oauth", oauth: { providerId: "github", profile: {} } },
      );

    oauth.state = { inviteCode: "b".repeat(32) };
    await expect(create()).rejects.toMatchObject({ body: { code: "INVALID_INVITE_CODE" } });

    oauth.state = { inviteCode };
    await expect(create()).resolves.toMatchObject({ email: "ada@example.com" });
  });
});
