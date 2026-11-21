import type { BetterAuthPlugin } from "@better-auth/core";
import { signInWithWallet, siweTestOptions } from "@repo/tooling/test-helpers";
import { admin, anonymous, emailOTP, magicLink, siwe, testUtils } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it } from "vitest";
import type { EmailNormalizationOptions } from "../src/email";
import { emailNormalization } from "../src/email";

/**
 * Email normalization with official plugins that create users or sign in
 * their own way. Users are normalized and checked in the database hooks,
 * whichever plugin creates them; these tests prove it per plugin. Phone
 * numbers (phoneNumber) are proven in phone.test.ts.
 */
async function setup<const P extends BetterAuthPlugin[]>(
  plugins: P,
  options: EmailNormalizationOptions = {},
) {
  const { auth } = await getTestInstance(
    {
      emailAndPassword: { enabled: true },
      plugins: [emailNormalization(options), ...plugins, testUtils()],
    },
    { disableTestUser: true },
  );
  const context = await auth.$context;
  const users = () =>
    context.adapter.findMany<{ email: string; normalizedEmail: string | null }>({ model: "user" });
  // Ada exists; aliases of her inbox must not become a second account.
  // The generic plugin list hides `signUpEmail` from the inferred API.
  const api = auth.api as unknown as {
    signUpEmail: (input: { body: Record<string, string> }) => Promise<unknown>;
  };
  await api.signUpEmail({
    body: { email: "ada@gmail.com", password: "password1234", name: "Ada" },
  });
  return { auth, context, users };
}

const userExists = { body: { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" } };

describe("social sign-in", () => {
  it("normalizes the email and refuses an alias", async () => {
    const { context, users } = await setup([]);
    const viaGitHub = (email: string) =>
      context.internalAdapter.createUser({ email, name: "x", emailVerified: true }, {
        method: "oauth",
        oauth: { providerId: "github", profile: {} },
      } as never);
    await expect(viaGitHub("a.da+gh@gmail.com")).rejects.toMatchObject(userExists);
    await viaGitHub("Bob+gh@Gmail.com");
    expect((await users()).map((user) => user.normalizedEmail).sort()).toEqual([
      "ada@gmail.com",
      "bob@gmail.com",
    ]);
  });
});

describe("magic link", () => {
  const links = new Map<string, string>();
  const plugin = () =>
    magicLink({
      sendMagicLink: ({ email, token }) => {
        links.set(email, token);
      },
    });

  it("refuses to create an alias account", async () => {
    const { auth, users } = await setup([plugin()]);
    await auth.api.signInMagicLink({ body: { email: "a.da@gmail.com" }, headers: new Headers() });
    await expect(
      auth.api.magicLinkVerify({
        query: { token: links.get("a.da@gmail.com") ?? "" },
        headers: new Headers(),
      }),
    ).rejects.toThrow();
    expect(await users()).toHaveLength(1);
  });

  it("signs in to the stored address with allowNormalizedSignIn", async () => {
    const { auth } = await setup([plugin()], { allowNormalizedSignIn: true });
    await auth.api.signInMagicLink({ body: { email: "a.da@gmail.com" }, headers: new Headers() });
    // The link goes to the stored address, which is the same inbox.
    expect(links.has("ada@gmail.com")).toBe(true);
  });
});

describe("email OTP", () => {
  it("refuses an alias account on OTP sign-in, and signs in with allowNormalizedSignIn", async () => {
    const otps = new Map<string, string>();
    const plugin = emailOTP({
      sendVerificationOTP: async ({ email, otp }) => {
        otps.set(email, otp);
      },
    });
    const off = await setup([plugin]);
    await off.auth.api.sendVerificationOTP({ body: { email: "a.da@gmail.com", type: "sign-in" } });
    await expect(
      off.auth.api.signInEmailOTP({
        body: { email: "a.da@gmail.com", otp: otps.get("a.da@gmail.com") ?? "" },
      }),
    ).rejects.toMatchObject(userExists);
    expect(await off.users()).toHaveLength(1);

    const on = await setup([plugin], { allowNormalizedSignIn: true });
    await on.auth.api.sendVerificationOTP({ body: { email: "a.da@gmail.com", type: "sign-in" } });
    await expect(
      on.auth.api.signInEmailOTP({
        body: { email: "a.da@gmail.com", otp: otps.get("ada@gmail.com") ?? "" },
      }),
    ).resolves.toMatchObject({ user: { email: "ada@gmail.com" } });
  });

  it("verifies an email and resets a password by OTP with another form of the address", async () => {
    const otps = new Map<string, string>();
    const plugin = emailOTP({
      sendVerificationOTP: async ({ email, otp }) => {
        otps.set(email, otp);
      },
    });
    const { auth, users } = await setup([plugin], { allowNormalizedSignIn: true });

    await auth.api.sendVerificationOTP({
      body: { email: "a.da@gmail.com", type: "email-verification" },
    });
    const verifyOtp = otps.get("ada@gmail.com") ?? "";
    await expect(
      auth.api.checkVerificationOTP({
        body: { email: "a.da@gmail.com", type: "email-verification", otp: verifyOtp },
      }),
    ).resolves.toMatchObject({ success: true });
    await auth.api.verifyEmailOTP({ body: { email: "a.da@gmail.com", otp: verifyOtp } });
    expect(await users()).toMatchObject([{ email: "ada@gmail.com", emailVerified: true }]);

    otps.clear();
    await auth.api.requestPasswordResetEmailOTP({ body: { email: "a.da+x@gmail.com" } });
    await expect(
      auth.api.resetPasswordEmailOTP({
        body: {
          email: "a.da+x@gmail.com",
          otp: otps.get("ada@gmail.com") ?? "",
          password: "a-new-password-1",
        },
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      auth.api.signInEmail({ body: { email: "ada@gmail.com", password: "a-new-password-1" } }),
    ).resolves.toBeTruthy();
  });
});

describe("Sign-In with Ethereum", () => {
  it("refuses an alias given with the wallet", async () => {
    const instance = await setup([siwe({ ...siweTestOptions, anonymous: false })]);
    await expect(
      signInWithWallet(instance.auth, instance.context.baseURL, { email: "a.da@gmail.com" }),
    ).resolves.toMatchObject({ status: 422, body: userExists.body });
    expect(await instance.users()).toHaveLength(1);
  });
});

describe("anonymous", () => {
  it("lets guests through with their generated email", async () => {
    const { auth, users } = await setup([anonymous()]);
    await expect(auth.api.signInAnonymous({ headers: new Headers() })).resolves.toBeTruthy();
    expect(await users()).toHaveLength(2);
  });
});

describe("admin", () => {
  it("refuses an alias in createUser", async () => {
    const { auth, users } = await setup([admin()]);
    await expect(
      auth.api.createUser({
        body: { email: "a.da+admin@gmail.com", password: "password1234", name: "Eve" },
      }),
    ).rejects.toMatchObject(userExists);
    expect(await users()).toHaveLength(1);
  });
});
