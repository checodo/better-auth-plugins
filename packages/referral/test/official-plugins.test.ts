import type { BetterAuthPlugin } from "@better-auth/core";
import { signInWithWallet, siweTestOptions } from "@repo/tooling/test-helpers";
import type { TestHelpers } from "better-auth/plugins";
import { emailOTP, phoneNumber, siwe, testUtils } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it } from "vitest";
import type { Referral } from "../src/index";
import { referral } from "../src/index";

/**
 * Referral attribution with official plugins that create users their own
 * way. Their sign-up bodies don't take a `referralCode`, so the code comes
 * in the `x-referral-code` header of the request that creates the user.
 */
async function setup<const P extends BetterAuthPlugin[]>(plugins: P) {
  const { auth } = await getTestInstance(
    { plugins: [referral(), ...plugins, testUtils()] },
    { disableTestUser: true },
  );
  const context = await auth.$context;
  // The plugins are generic here, so TypeScript can't resolve what
  // testUtils and referral add; the tests themselves are fully typed.
  const { test } = context as unknown as { test: TestHelpers };
  const api = auth.api as unknown as {
    createReferralCode: (input: { headers: Headers }) => Promise<{ code: string }>;
  };
  const referrer = await test.saveUser(test.createUser({ email: "ada@example.com" }));
  const { code } = await api.createReferralCode({
    headers: await test.getAuthHeaders({ userId: referrer.id }),
  });
  const referralOf = (userId: string) =>
    context.adapter.findOne<Referral>({
      model: "referral",
      where: [{ field: "referredUserId", value: userId }],
    });
  const withCode = () => new Headers({ "x-referral-code": code });
  return { auth, context, referrer, code, referralOf, withCode };
}

describe("email OTP", () => {
  it("attributes an OTP sign-up to the code in the header", async () => {
    const otps = new Map<string, string>();
    const { auth, referrer, referralOf, withCode } = await setup([
      emailOTP({
        sendVerificationOTP: async ({ email, otp }) => {
          otps.set(email, otp);
        },
      }),
    ]);
    await auth.api.sendVerificationOTP({ body: { email: "bob@example.com", type: "sign-in" } });
    const { user } = await auth.api.signInEmailOTP({
      body: { email: "bob@example.com", otp: otps.get("bob@example.com") ?? "" },
      headers: withCode(),
    });
    await expect(referralOf(user.id)).resolves.toMatchObject({ referrerUserId: referrer.id });
  });
});

describe("phone number", () => {
  it("attributes a sign-up on verification to the code in the header", async () => {
    const codes = new Map<string, string>();
    const { auth, context, referrer, referralOf, withCode } = await setup([
      phoneNumber({
        sendOTP: async ({ phoneNumber, code }) => {
          codes.set(phoneNumber, code);
        },
        signUpOnVerification: { getTempEmail: (phone) => `${phone.slice(1)}@phone.example.com` },
      }),
    ]);
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: "+15555550100" } });
    await auth.api.verifyPhoneNumber({
      body: { phoneNumber: "+15555550100", code: codes.get("+15555550100") ?? "" },
      headers: withCode(),
    });
    const user = await context.adapter.findOne<{ id: string }>({
      model: "user",
      where: [{ field: "phoneNumber", value: "+15555550100" }],
    });
    await expect(referralOf(user?.id ?? "")).resolves.toMatchObject({
      referrerUserId: referrer.id,
    });
  });
});

describe("Sign-In with Ethereum", () => {
  it("attributes a wallet sign-up to the code in the header", async () => {
    const { auth, context, referrer, referralOf, code } = await setup([siwe(siweTestOptions)]);
    const { status, body } = await signInWithWallet(auth, context.baseURL, {
      headers: { "x-referral-code": code },
    });
    expect(status).toBe(200);
    const { user } = body as { user: { id: string } };
    await expect(referralOf(user.id)).resolves.toMatchObject({ referrerUserId: referrer.id });
  });
});
