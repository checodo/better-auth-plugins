import type { BetterAuthPlugin } from "@better-auth/core";
import { signInWithWallet, siweTestOptions } from "@repo/tooling/test-helpers";
import { emailOTP, phoneNumber, siwe, testUtils } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it } from "vitest";
import type { WaitlistOptions } from "../src/index";
import { waitlist } from "../src/index";

/**
 * The waitlist with official plugins that create users their own way. The
 * gate runs in the database hooks, so every one of them is gated; phone
 * number and wallet sign-ups have placeholder emails, which `allow` (or
 * `bypass`) has to let through.
 */
async function setup<const P extends BetterAuthPlugin[]>(
  plugins: P,
  options: WaitlistOptions = {},
) {
  const { auth } = await getTestInstance(
    { plugins: [waitlist({ confirmEmail: false, ...options }), ...plugins, testUtils()] },
    { disableTestUser: true },
  );
  const context = await auth.$context;
  const userCount = async () => (await context.adapter.findMany({ model: "user" })).length;
  return { auth, context, userCount };
}

async function expectGated(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({
    statusCode: 403,
    body: { code: "EMAIL_NOT_APPROVED" },
  });
}

describe("email OTP", () => {
  it("gates OTP sign-ups until the email is approved", async () => {
    const otps = new Map<string, string>();
    const { auth, context, userCount } = await setup([
      emailOTP({
        sendVerificationOTP: async ({ email, otp }) => {
          otps.set(email, otp);
        },
      }),
    ]);
    const signIn = async (email: string) => {
      await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
      return auth.api.signInEmailOTP({ body: { email, otp: otps.get(email) ?? "" } });
    };

    await expectGated(signIn("ada@example.com"));
    expect(await userCount()).toBe(0);

    await auth.api.joinWaitlist({ body: { email: "ada@example.com" } });
    const entry = await context.adapter.findOne<{ id: string }>({
      model: "waitlistEntry",
      where: [{ field: "email", value: "ada@example.com" }],
    });
    await context.adapter.update({
      model: "waitlistEntry",
      where: [{ field: "id", value: entry?.id ?? "" }],
      update: { status: "approved" },
    });
    await expect(signIn("ada@example.com")).resolves.toMatchObject({
      user: { email: "ada@example.com" },
    });
  });
});

describe("phone number", () => {
  const plugin = (codes: Map<string, string>) =>
    phoneNumber({
      sendOTP: async ({ phoneNumber, code }) => {
        codes.set(phoneNumber, code);
      },
      signUpOnVerification: { getTempEmail: (phone) => `${phone.slice(1)}@phone.example.com` },
    });

  it("gates phone sign-ups, whose placeholder email is never approved", async () => {
    const codes = new Map<string, string>();
    const { auth, userCount } = await setup([plugin(codes)]);
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: "+15555550100" } });
    await expectGated(
      auth.api.verifyPhoneNumber({
        body: { phoneNumber: "+15555550100", code: codes.get("+15555550100") ?? "" },
      }),
    );
    expect(await userCount()).toBe(0);
  });

  it("lets phone sign-ups through when `allow` has the placeholder domain", async () => {
    const codes = new Map<string, string>();
    const { auth, userCount } = await setup([plugin(codes)], { allow: ["phone.example.com"] });
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: "+15555550100" } });
    await expect(
      auth.api.verifyPhoneNumber({
        body: { phoneNumber: "+15555550100", code: codes.get("+15555550100") ?? "" },
      }),
    ).resolves.toMatchObject({ status: true });
    expect(await userCount()).toBe(1);
  });
});

describe("Sign-In with Ethereum", () => {
  const plugin = siwe({ ...siweTestOptions, emailDomainName: "wallet.example.com" });

  it("gates wallet sign-ups unless `allow` has the wallet email domain", async () => {
    const gated = await setup([plugin]);
    await expect(signInWithWallet(gated.auth, gated.context.baseURL)).resolves.toMatchObject({
      status: 403,
      body: { code: "EMAIL_NOT_APPROVED" },
    });

    const allowed = await setup([plugin], { allow: ["wallet.example.com"] });
    await expect(signInWithWallet(allowed.auth, allowed.context.baseURL)).resolves.toMatchObject({
      status: 200,
    });
    expect(await allowed.userCount()).toBe(1);
  });
});
