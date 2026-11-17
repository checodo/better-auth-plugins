import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import type { AuditEvent } from "@checodo/better-auth-audit-log";
import { auditLog, memoryStorage } from "@checodo/better-auth-audit-log";
import { signInWithWallet, siweTestOptions, totp } from "@repo/tooling/test-helpers";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { emailOTP, magicLink, phoneNumber, siwe, twoFactor, username } from "better-auth/plugins";
import type { GithubProfile } from "better-auth/social-providers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browser, cookieOf, PASSWORD, setup, UA } from "./helpers";

describe("two-factor", () => {
  it("alerts when two-factor is turned off, not when it is turned on", async () => {
    const { auth, signUp, ofType } = await setup({}, { plugins: [twoFactor()] });
    const { user, headers } = await signUp("ada@example.com");
    const enabled = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers });
    const secret = new URL("totpURI" in enabled ? enabled.totpURI : "").searchParams.get("secret");
    const verified = await auth.api.verifyTOTP({
      body: { code: totp(secret ?? "") },
      headers,
      returnHeaders: true,
    });
    // Turning it on replaces the session.
    const session = browser(UA.chromeMac, { cookie: cookieOf(verified.headers) });
    expect(ofType("two-factor-disabled")).toEqual([]);

    await auth.api.disableTwoFactor({ body: { password: PASSWORD }, headers: session });
    expect(ofType("two-factor-disabled")).toEqual([
      expect.objectContaining({
        email: "ada@example.com",
        user: expect.objectContaining({ id: user.id }),
      }),
    ]);
  });

  it("alerts once for a new device signing in with a code", async () => {
    const { auth, signUp, ofType } = await setup({}, { plugins: [twoFactor()] });
    const { headers } = await signUp("ada@example.com");
    const enabled = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers });
    const secret = new URL("totpURI" in enabled ? enabled.totpURI : "").searchParams.get("secret");
    await auth.api.verifyTOTP({ body: { code: totp(secret ?? "") }, headers });

    const signIn = await auth.api.signInEmail({
      body: { email: "ada@example.com", password: PASSWORD },
      headers: browser(UA.firefoxLinux),
      returnHeaders: true,
    });
    await auth.api.verifyTOTP({
      body: { code: totp(secret ?? "") },
      headers: browser(UA.firefoxLinux, { cookie: cookieOf(signIn.headers) }),
    });
    expect(ofType("new-device")).toHaveLength(1);
  });
});

describe("email OTP and phone number", () => {
  it("alerts on password reset requests and resets by OTP", async () => {
    const codes: string[] = [];
    const { auth, signUp, context, ofType } = await setup(
      {},
      {
        plugins: [
          emailOTP({
            sendVerificationOTP: async ({ otp }) => {
              codes.push(otp);
            },
          }),
          phoneNumber({
            sendOTP: () => {},
            sendPasswordResetOTP: ({ code }) => {
              codes.push(code);
            },
          }),
        ],
      },
    );
    const { user } = await signUp("ada@example.com");
    await context.internalAdapter.updateUser(user.id, { phoneNumber: "+15555550100" });

    await auth.api.requestPasswordResetEmailOTP({ body: { email: "ada@example.com" } });
    await auth.api.resetPasswordEmailOTP({
      body: { email: "ada@example.com", otp: codes.at(-1) ?? "", password: "new-password-1234" },
    });
    await auth.api.requestPasswordResetPhoneNumber({ body: { phoneNumber: "+15555550100" } });
    await auth.api.resetPasswordPhoneNumber({
      body: {
        phoneNumber: "+15555550100",
        otp: codes.at(-1) ?? "",
        newPassword: "other-password-1234",
      },
    });
    // Nobody has this number.
    await auth.api.requestPasswordResetPhoneNumber({ body: { phoneNumber: "+15555550199" } });

    expect(ofType("password-reset-requested").map((alert) => alert.details.channel)).toEqual([
      "email",
      "phone-number",
    ]);
    expect(ofType("password-reset").map((alert) => alert.details.channel)).toEqual([
      "email",
      "phone-number",
    ]);
  });
});

describe("passkey", () => {
  it("alerts when a passkey is removed", async () => {
    const { auth, signUp, context, ofType } = await setup({}, { plugins: [passkey()] });
    const { user, headers } = await signUp("ada@example.com");
    const created = await context.adapter.create<{ id: string }>({
      model: "passkey",
      data: {
        name: "YubiKey",
        userId: user.id,
        credentialID: "credential-1",
        publicKey: "key",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
        transports: "usb",
        createdAt: new Date(),
      },
    });
    await auth.api.deletePasskey({ body: { id: created.id }, headers });
    expect(ofType("passkey-removed")).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({ passkeyId: created.id, passkeyName: "YubiKey" }),
      }),
    ]);
  });

  it("alerts when a passkey is registered", async () => {
    // A real registration needs an authenticator's signed attestation. This
    // stands in for the passkey plugin's endpoint and answers like it does:
    // the stored passkey.
    const registration = {
      id: "passkey-stub",
      endpoints: {
        verifyPasskeyRegistration: createAuthEndpoint(
          "/passkey/verify-registration",
          { method: "POST" },
          async (ctx) =>
            ctx.json({ id: "pk-1", name: "MacBook", userId: ctx.headers?.get("x-user-id") ?? "" }),
        ),
      },
    } satisfies BetterAuthPlugin;
    const { auth, signUp, ofType } = await setup({}, { plugins: [registration] });
    const { user, headers } = await signUp("ada@example.com");
    headers.set("x-user-id", user.id);
    await auth.api.verifyPasskeyRegistration({ headers });
    expect(ofType("passkey-added")).toEqual([
      expect.objectContaining({
        email: "ada@example.com",
        details: expect.objectContaining({ passkeyId: "pk-1", passkeyName: "MacBook" }),
      }),
    ]);
  });
});

describe("api-key", () => {
  it("alerts when an API key is created, without the key", async () => {
    const { auth, signUp, ofType } = await setup({}, { plugins: [apiKey()] });
    const { headers } = await signUp("ada@example.com");
    const created = await auth.api.createApiKey({ body: { name: "CI" }, headers });
    const alerts = ofType("api-key-created");
    expect(alerts).toEqual([
      expect.objectContaining({
        email: "ada@example.com",
        details: expect.objectContaining({ apiKeyId: created.id, apiKeyName: "CI" }),
      }),
    ]);
    expect(JSON.stringify(alerts)).not.toContain(created.key);
  });
});

describe("audit-log", () => {
  async function auditSetup(sendAlert?: () => void) {
    const storage = memoryStorage();
    const instance = await setup(
      {
        ...(sendAlert ? { sendAlert } : {}),
        secureAccount: { callbackURL: "/secure-account", password: "none" },
      },
      { plugins: [auditLog({ storage })] },
    );
    const events = (type: string): AuditEvent[] =>
      storage.events.filter((event) => event.type === type);
    return { ...instance, events };
  }

  it("records sent alerts and secured accounts", async () => {
    const { auth, signUp, signIn, ofType, events } = await auditSetup();
    const { user } = await signUp("ada@example.com");
    await signIn("ada@example.com", UA.firefoxLinux);
    expect(events("security.alert-sent")).toEqual([
      expect.objectContaining({
        status: "success",
        userId: user.id,
        metadata: { alert: "new-device" },
      }),
    ]);

    const token = ofType("new-device")[0]?.secureAccountUrl?.split("/").at(-1) ?? "";
    await auth.api.secureAccount({ body: { token } });
    expect(events("security.account-secured")).toEqual([
      expect.objectContaining({
        severity: "high",
        userId: user.id,
        metadata: {
          alert: "new-device",
          credentialAction: "none",
          removed: null,
          restoredEmail: null,
        },
      }),
    ]);
  });

  it("records alerts that failed to send", async () => {
    const { signUp, signIn, events, context } = await auditSetup(() => {
      throw new Error("mail server down");
    });
    context.logger.error = () => {};
    await signUp("ada@example.com");
    await signIn("ada@example.com", UA.firefoxLinux);
    expect(events("security.alert-sent")).toEqual([
      expect.objectContaining({ status: "failure", metadata: { alert: "new-device" } }),
    ]);
  });
});

describe("sign-in methods", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("social sign-in: new devices and linked accounts", async () => {
    const instance = await setup(
      {},
      {
        auth: {
          account: { accountLinking: { trustedProviders: ["github"] } },
          socialProviders: {
            github: {
              clientId: "test-client",
              clientSecret: "test-secret",
              getUserInfo: async () => ({
                user: { name: "Ada", email: "ada@example.com", emailVerified: true },
                data: { id: "42", login: "ada" } as GithubProfile,
              }),
            },
          },
        },
      },
    );
    const { auth, signUp, ofType } = instance;
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.startsWith("https://github.com/login/oauth/access_token")) {
        return Response.json({
          access_token: "gh-token",
          token_type: "bearer",
          scope: "user:email",
        });
      }
      return realFetch(input, init);
    });
    const signInWithGitHub = async (userAgent: string) => {
      const start = await auth.api.signInSocial({
        body: { provider: "github", callbackURL: "/dashboard" },
        headers: browser(userAgent),
        returnHeaders: true,
      });
      const state = new URL(start.response.url as string).searchParams.get("state") ?? "";
      return auth.handler(
        new Request(`http://localhost:3000/api/auth/callback/github?code=gh-code&state=${state}`, {
          headers: browser(userAgent, { cookie: cookieOf(start.headers) }),
        }),
      );
    };

    const { user } = await signUp("ada@example.com");
    // better-auth only links to an account whose email is verified.
    await instance.context.internalAdapter.updateUser(user.id, { emailVerified: true });
    // Signing in with GitHub links it to the existing account, from a known device.
    expect((await signInWithGitHub(UA.chromeMac)).status).toBe(302);
    expect(ofType("account-linked")).toEqual([
      expect.objectContaining({ details: expect.objectContaining({ providerId: "github" }) }),
    ]);
    expect(ofType("new-device")).toEqual([]);
    await signInWithGitHub(UA.firefoxLinux);
    expect(ofType("new-device")).toHaveLength(1);
  });

  it("magic link, email OTP, username, and Sign-In with Ethereum", async () => {
    const links: string[] = [];
    const codes: string[] = [];
    const { auth, signUp, context, ofType } = await setup(
      {},
      {
        plugins: [
          magicLink({ sendMagicLink: async ({ url }) => void links.push(url) }),
          emailOTP({ sendVerificationOTP: async ({ otp }) => void codes.push(otp) }),
          username(),
          siwe(siweTestOptions),
        ],
      },
    );
    const { user } = await signUp("ada@example.com");
    // Verified: a magic link for an unverified email removes the password.
    await context.internalAdapter.updateUser(user.id, { username: "ada", emailVerified: true });

    await auth.api.signInMagicLink({
      body: { email: "ada@example.com" },
      headers: browser(UA.firefoxLinux),
    });
    const token = new URL(links.at(-1) ?? "").searchParams.get("token") ?? "";
    await auth.api.magicLinkVerify({ query: { token }, headers: browser(UA.firefoxLinux) });
    expect(ofType("new-device")).toHaveLength(1);

    await auth.api.sendVerificationOTP({ body: { email: "ada@example.com", type: "sign-in" } });
    await auth.api.signInEmailOTP({
      body: { email: "ada@example.com", otp: codes.at(-1) ?? "" },
      headers: browser(UA.safariIphone),
    });
    expect(ofType("new-device")).toHaveLength(2);

    const edge = UA.chromeMac.replace("Macintosh; Intel Mac OS X 10_15_7", "Windows NT 10.0");
    await auth.api.signInUsername({
      body: { username: "ada", password: PASSWORD },
      headers: browser(edge),
    });
    expect(ofType("new-device")).toHaveLength(3);

    // A wallet user: the first sign-in doesn't alert, a new device does.
    await signInWithWallet(auth, context.baseURL, { headers: { "user-agent": UA.chromeMac } });
    await signInWithWallet(auth, context.baseURL, { headers: { "user-agent": UA.firefoxLinux } });
    expect(ofType("new-device").map((alert) => alert.user.email)).toEqual([
      "ada@example.com",
      "ada@example.com",
      "ada@example.com",
      expect.stringMatching(/^0x[0-9a-f]+@/),
    ]);
  });
});

describe("securing the account removes what the alert was about", () => {
  const secureAccount = { callbackURL: "/secure-account", password: "none" } as const;
  const tokenOf = (url: string | null | undefined) => url?.split("/").at(-1) ?? "";

  it("a linked account", async () => {
    const { auth, signUp, context, ofType } = await setup({ secureAccount });
    const { user } = await signUp("ada@example.com");
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "github",
      accountId: "attacker",
    });
    const token = tokenOf(ofType("account-linked")[0]?.secureAccountUrl);
    await auth.api.secureAccount({ body: { token } });
    const accounts = await context.internalAdapter.findAccounts(user.id);
    expect(accounts.map((account) => account.providerId)).toEqual(["credential"]);
  });

  it("an API key", async () => {
    const { auth, signUp, context, ofType } = await setup(
      { secureAccount },
      { plugins: [apiKey()] },
    );
    const { headers } = await signUp("ada@example.com");
    const created = await auth.api.createApiKey({ body: { name: "attacker" }, headers });
    const token = tokenOf(ofType("api-key-created")[0]?.secureAccountUrl);
    await auth.api.secureAccount({ body: { token } });
    expect(
      await context.adapter.findOne({
        model: "apikey",
        where: [{ field: "id", value: created.id }],
      }),
    ).toBeNull();
  });

  it("a passkey, only the user's own", async () => {
    const { auth, signUp, context } = await setup({ secureAccount }, { plugins: [passkey()] });
    const ada = await signUp("ada@example.com");
    const eve = await signUp("eve@example.com");
    const passkeyOf = (userId: string, credentialID: string) =>
      context.adapter.create<{ id: string }>({
        model: "passkey",
        data: {
          userId,
          credentialID,
          publicKey: "key",
          counter: 0,
          deviceType: "singleDevice",
          backedUp: false,
          createdAt: new Date(),
        },
      });
    const adas = await passkeyOf(ada.user.id, "credential-ada");
    const eves = await passkeyOf(eve.user.id, "credential-eve");
    // Links as the passkey-added alerts create them.
    const link = async (userId: string, id: string) => {
      const token = `t${Math.random().toString(36).slice(2)}`;
      await context.internalAdapter.createVerificationValue({
        identifier: `security-alerts:secure-account:${token}`,
        value: JSON.stringify({ userId, alert: "passkey-added", undo: { model: "passkey", id } }),
        expiresAt: new Date(Date.now() + 60_000),
      });
      return token;
    };
    await auth.api.secureAccount({ body: { token: await link(ada.user.id, adas.id) } });
    // A link of Ada's can't name Eve's passkey.
    await auth.api.secureAccount({ body: { token: await link(ada.user.id, eves.id) } });
    const left = await context.adapter.findMany<{ id: string }>({ model: "passkey" });
    expect(left.map((row) => row.id)).toEqual([eves.id]);
  });
});
