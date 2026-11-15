import { testUtils } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import type { Referral } from "../src/index";
import { referral } from "../src/index";

// The OAuth state of the request that creates the user. In a real social
// sign-in it holds `additionalData` from `signIn.social`; here a test sets
// it directly, so no OAuth provider is needed.
const oauth = vi.hoisted(() => ({ state: null as Record<string, unknown> | null }));
vi.mock("better-auth/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("better-auth/api")>();
  return { ...original, getOAuthState: async () => oauth.state };
});

describe("referral code from a social sign-in", () => {
  it("is read from the OAuth state's additionalData", async () => {
    const { auth } = await getTestInstance(
      { plugins: [referral({ steps: ["email-verified"] }), testUtils()] },
      { disableTestUser: true },
    );
    const context = await auth.$context;
    const ada = await context.test.saveUser(context.test.createUser({ email: "ada@example.com" }));
    const headers = await context.test.getAuthHeaders({ userId: ada.id });
    const { code } = await auth.api.createReferralCode({ headers });

    oauth.state = { referralCode: code };
    // Providers verify the email, so the email-verified step is done at once.
    const bob = await context.internalAdapter.createUser(
      { email: "bob@example.com", name: "Bob", emailVerified: true },
      { method: "oauth", oauth: { providerId: "github", profile: {} } },
    );
    oauth.state = null;

    const stored = await context.adapter.findOne<Referral>({
      model: "referral",
      where: [{ field: "referredUserId", value: bob.id }],
    });
    expect(stored).toMatchObject({ referrerUserId: ada.id, status: "completed" });
  });
});
