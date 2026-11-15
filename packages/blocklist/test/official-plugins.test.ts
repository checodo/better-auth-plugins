import type { BetterAuthPlugin } from "@better-auth/core";
import { signInWithWallet, siweTestOptions } from "@repo/tooling/test-helpers";
import {
  anonymous,
  emailOTP,
  magicLink,
  organization,
  phoneNumber,
  siwe,
  testUtils,
} from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it } from "vitest";
import { blocklist } from "../src/index";

/**
 * The blocklist with official plugins that create users or take emails
 * their own way. Users are checked in the database hooks, whichever plugin
 * creates them; these tests prove it per plugin.
 */
async function setup<const P extends BetterAuthPlugin[]>(plugins: P) {
  const { auth } = await getTestInstance(
    {
      plugins: [blocklist({ email: { domains: ["mailinator.com"] } }), ...plugins, testUtils()],
    },
    { disableTestUser: true },
  );
  const context = await auth.$context;
  const userCount = async () => (await context.adapter.findMany({ model: "user" })).length;
  return { auth, context, userCount };
}

async function expectBlocked(promise: Promise<unknown>, code = "EMAIL_NOT_ALLOWED") {
  await expect(promise).rejects.toMatchObject({ statusCode: 400, body: { code } });
}

describe("magic link", () => {
  it("doesn't create a user with a blocked email", async () => {
    const links: string[] = [];
    const { auth, userCount } = await setup([
      magicLink({
        sendMagicLink: ({ token }) => {
          links.push(token);
        },
      }),
    ]);
    await auth.api.signInMagicLink({
      body: { email: "eve@mailinator.com" },
      headers: new Headers(),
    });
    await expect(
      auth.api.magicLinkVerify({ query: { token: links[0] ?? "" }, headers: new Headers() }),
    ).rejects.toThrow();
    expect(await userCount()).toBe(0);
  });
});

describe("email OTP", () => {
  it("doesn't create a user with a blocked email on OTP sign-in", async () => {
    const otps = new Map<string, string>();
    const { auth, userCount } = await setup([
      emailOTP({
        sendVerificationOTP: async ({ email, otp }) => {
          otps.set(email, otp);
        },
      }),
    ]);
    await auth.api.sendVerificationOTP({ body: { email: "eve@mailinator.com", type: "sign-in" } });
    await expectBlocked(
      auth.api.signInEmailOTP({
        body: { email: "eve@mailinator.com", otp: otps.get("eve@mailinator.com") ?? "" },
      }),
    );
    expect(await userCount()).toBe(0);

    await auth.api.sendVerificationOTP({ body: { email: "ada@example.com", type: "sign-in" } });
    await expect(
      auth.api.signInEmailOTP({
        body: { email: "ada@example.com", otp: otps.get("ada@example.com") ?? "" },
      }),
    ).resolves.toMatchObject({ user: { email: "ada@example.com" } });
  });
});

describe("Sign-In with Ethereum", () => {
  const siwePlugin = (anonymousSignIn: boolean) =>
    siwe({ ...siweTestOptions, anonymous: anonymousSignIn });

  it("rejects a blocked email given with the wallet (anonymous: false)", async () => {
    const instance = await setup([siwePlugin(false)]);
    await expect(
      signInWithWallet(instance.auth, instance.context.baseURL, { email: "eve@mailinator.com" }),
    ).resolves.toMatchObject({
      status: 400,
      body: { code: "EMAIL_NOT_ALLOWED" },
    });
    expect(await instance.userCount()).toBe(0);
  });

  it("lets a wallet-only sign-up through", async () => {
    const instance = await setup([siwePlugin(true)]);
    await expect(signInWithWallet(instance.auth, instance.context.baseURL)).resolves.toMatchObject({
      status: 200,
      body: { success: true },
    });
    expect(await instance.userCount()).toBe(1);
  });
});

describe("phone number", () => {
  it("checks the placeholder email of a sign-up on verification", async () => {
    const codes = new Map<string, string>();
    const plugin = (domain: string) =>
      phoneNumber({
        sendOTP: async ({ phoneNumber, code }) => {
          codes.set(phoneNumber, code);
        },
        signUpOnVerification: { getTempEmail: (phone) => `${phone.slice(1)}@${domain}` },
      });

    const allowed = await setup([plugin("phone.example.com")]);
    await allowed.auth.api.sendPhoneNumberOTP({ body: { phoneNumber: "+15555550100" } });
    await expect(
      allowed.auth.api.verifyPhoneNumber({
        body: { phoneNumber: "+15555550100", code: codes.get("+15555550100") ?? "" },
      }),
    ).resolves.toMatchObject({ status: true });
    expect(await allowed.userCount()).toBe(1);

    // A placeholder domain on the blocklist blocks phone sign-ups too.
    const blocked = await setup([plugin("mailinator.com")]);
    await blocked.auth.api.sendPhoneNumberOTP({ body: { phoneNumber: "+15555550101" } });
    await expectBlocked(
      blocked.auth.api.verifyPhoneNumber({
        body: { phoneNumber: "+15555550101", code: codes.get("+15555550101") ?? "" },
      }),
    );
    expect(await blocked.userCount()).toBe(0);
  });
});

describe("anonymous", () => {
  it("lets guests through with their generated email", async () => {
    const { auth } = await setup([anonymous()]);
    await expect(auth.api.signInAnonymous({ headers: new Headers() })).resolves.toMatchObject({
      user: { id: expect.any(String) },
    });
  });
});

describe("organization invitations", () => {
  it("rejects inviting a blocked email before the invitation is sent", async () => {
    const sent: string[] = [];
    const { auth, context } = await setup([
      organization({
        sendInvitationEmail: async ({ email }) => {
          sent.push(email);
        },
      }),
    ]);
    const user = await context.test.saveUser(context.test.createUser({ email: "own@example.com" }));
    const headers = await context.test.getAuthHeaders({ userId: user.id });
    const org = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme" },
      headers,
    });

    await expectBlocked(
      auth.api.createInvitation({
        body: { email: "Eve@Mailinator.com", role: "member", organizationId: org?.id },
        headers,
      }),
    );
    await auth.api.createInvitation({
      body: { email: "ada@example.com", role: "member", organizationId: org?.id },
      headers,
    });
    expect(sent).toEqual(["ada@example.com"]);
  });
});
