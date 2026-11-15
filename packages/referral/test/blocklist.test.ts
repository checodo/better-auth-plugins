import { blocklist } from "@checodo/better-auth-blocklist";
import { testUtils } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import { referral } from "../src/index";

// The referral plugin has no user-entered text of its own; the blocklist
// guards the one way in, the sign-up. These tests run both plugins together.
describe("with the blocklist plugin", () => {
  async function setup() {
    const onReferral = vi.fn();
    const onReferralCompleted = vi.fn();
    const { auth } = await getTestInstance(
      {
        plugins: [
          blocklist({ email: { domains: ["mailinator.com"] } }),
          referral({ steps: [], onReferral, onReferralCompleted }),
          testUtils(),
        ],
      },
      { disableTestUser: true },
    );
    const context = await auth.$context;
    const ada = await context.test.saveUser(context.test.createUser({ email: "ada@example.com" }));
    const headers = await context.test.getAuthHeaders({ userId: ada.id });
    const { code } = await auth.api.createReferralCode({ headers });
    const signUp = (email: string) =>
      auth.api.signUpEmail({
        body: { email, password: "password1234", name: "Someone" },
        headers: new Headers({ "x-referral-code": code }),
      });
    return { auth, context, signUp, onReferral, onReferralCompleted };
  }

  it("records no referral and pays nothing for a blocked sign-up", async () => {
    const { context, signUp, onReferral, onReferralCompleted } = await setup();
    await expect(signUp("farmer@mailinator.com")).rejects.toMatchObject({
      body: { code: "EMAIL_NOT_ALLOWED" },
    });
    expect(await context.internalAdapter.findUserByEmail("farmer@mailinator.com")).toBeNull();
    expect(await context.adapter.count({ model: "referral" })).toBe(0);
    expect(onReferral).not.toHaveBeenCalled();
    expect(onReferralCompleted).not.toHaveBeenCalled();
  });

  it("still credits allowed sign-ups", async () => {
    const { context, signUp, onReferralCompleted } = await setup();
    await signUp("bob@example.com");
    expect(await context.adapter.count({ model: "referral" })).toBe(1);
    expect(onReferralCompleted).toHaveBeenCalledOnce();
  });
});
