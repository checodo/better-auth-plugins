import { createAuthClient } from "better-auth/client";
import { describe, expect, it, vi } from "vitest";
import { securityAlertsClient } from "../src/client";
import { findDevices } from "../src/devices";
import { browser, cookieOf, PASSWORD, setup, UA } from "./helpers";

describe("new-device", () => {
  it("doesn't alert on the first sign-in or from a known device", async () => {
    const { signUp, signIn, alerts } = await setup();
    await signUp("ada@example.com");
    await signIn("ada@example.com", UA.chromeMac);
    // A newer version of the same browser is the same device.
    await signIn("ada@example.com", UA.chromeMac.replace("124.0.0.0", "125.0.0.0"));
    expect(alerts).toEqual([]);
  });

  it("alerts on a sign-in from a new device, once", async () => {
    const { signUp, signIn, ofType } = await setup();
    const { user } = await signUp("ada@example.com");
    await signIn("ada@example.com", UA.firefoxLinux, { "x-forwarded-for": "203.0.113.7" });
    await signIn("ada@example.com", UA.firefoxLinux);

    const alerts = ofType("new-device");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      type: "new-device",
      email: "ada@example.com",
      user: { id: user.id },
      secureAccountUrl: null,
      details: {
        device: { browser: "Firefox", os: "Linux", label: "Firefox on Linux" },
        userAgent: UA.firefoxLinux,
        actor: "user",
      },
    });
    expect(alerts[0]?.details.at).toBeInstanceOf(Date);
  });

  it("alerts again for a device not seen for newDevice.expiresIn", async () => {
    const { signUp, signIn, ofType } = await setup({ newDevice: { expiresIn: 60 } });
    await signUp("ada@example.com");
    await signIn("ada@example.com", UA.firefoxLinux);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 61_000);
      await signIn("ada@example.com", UA.firefoxLinux);
    } finally {
      vi.useRealTimers();
    }
    expect(ofType("new-device")).toHaveLength(2);
  });

  it("tells networks apart with newDevice.includeIp", async () => {
    const { signUp, signIn, ofType } = await setup({ newDevice: { includeIp: true } });
    await signUp("ada@example.com");
    await signIn("ada@example.com", UA.chromeMac, { "x-forwarded-for": "203.0.113.7" });
    // Same /24: same device.
    await signIn("ada@example.com", UA.chromeMac, { "x-forwarded-for": "203.0.113.99" });
    expect(ofType("new-device")).toHaveLength(1);
    await signIn("ada@example.com", UA.chromeMac, { "x-forwarded-for": "198.51.100.1" });
    expect(ofType("new-device")).toHaveLength(2);
  });

  it("forgets the least recently seen devices beyond newDevice.maxDevices", async () => {
    const { signUp, signIn, ofType, context } = await setup({ newDevice: { maxDevices: 2 } });
    const { user } = await signUp("ada@example.com");
    await signIn("ada@example.com", UA.firefoxLinux);
    await signIn("ada@example.com", UA.safariIphone);
    const devices = await context.adapter.findMany<{ label: string }>({
      model: "knownDevice",
      where: [{ field: "userId", value: user.id }],
    });
    expect(devices.map((device) => device.label).sort()).toEqual([
      "Firefox on Linux",
      "Safari on iOS",
    ]);
    // Chrome on macOS was forgotten: new again.
    await signIn("ada@example.com", UA.chromeMac);
    expect(ofType("new-device")).toHaveLength(3);
  });

  it("lets newDevice.isNewDevice decide", async () => {
    const isNewDevice = vi.fn(({ device }: { device: { browser: string | null } }) =>
      device.browser === "Safari" ? true : device.browser === "Firefox" ? false : undefined,
    );
    const { signUp, signIn, ofType } = await setup({ newDevice: { isNewDevice } });
    await signUp("ada@example.com");
    await signIn("ada@example.com", UA.firefoxLinux);
    expect(ofType("new-device")).toHaveLength(0);
    await signIn("ada@example.com", UA.safariIphone);
    await signIn("ada@example.com", UA.safariIphone);
    expect(ofType("new-device")).toHaveLength(2);
    expect(isNewDevice).toHaveBeenCalledWith(
      expect.objectContaining({ known: true, firstSignIn: false }),
    );
  });

  it("can be turned off", async () => {
    const { signUp, signIn, alerts } = await setup({ alerts: { "new-device": false } });
    await signUp("ada@example.com");
    await signIn("ada@example.com", UA.firefoxLinux);
    expect(alerts).toEqual([]);
  });

  it("doesn't count a failed sign-in", async () => {
    const { signUp, signIn, alerts } = await setup();
    await signUp("ada@example.com");
    await expect(
      signIn("ada@example.com", UA.firefoxLinux, {}, "wrong-password"),
    ).rejects.toThrow();
    expect(alerts).toEqual([]);
  });

  it("reads every device, also beyond 100", async () => {
    const { signUp, context } = await setup();
    const { user } = await signUp("ada@example.com");
    const now = new Date();
    for (let i = 0; i < 120; i++) {
      await context.adapter.create({
        model: "knownDevice",
        data: {
          userId: user.id,
          fingerprint: `fingerprint-${i}`,
          label: "Chrome on macOS",
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + 86_400_000),
          createdAt: now,
        },
      });
    }
    // The adapter's type is narrowed to the test's options.
    const devices = await findDevices(context.adapter as never, user.id);
    expect(devices.length).toBeGreaterThan(120);
  });

  it("forgets a deleted user's devices", async () => {
    const { signUp, context } = await setup();
    const { user } = await signUp("ada@example.com");
    await context.internalAdapter.deleteUser(user.id);
    expect(
      await context.adapter.count({
        model: "knownDevice",
        where: [{ field: "userId", value: user.id }],
      }),
    ).toBe(0);
  });
});

describe("password alerts", () => {
  it("alerts when the password is changed", async () => {
    const { auth, signUp, ofType } = await setup();
    const { user, headers } = await signUp("ada@example.com");
    await auth.api.changePassword({
      body: { currentPassword: PASSWORD, newPassword: "new-password-1234" },
      headers,
    });
    expect(ofType("password-changed")).toEqual([
      expect.objectContaining({
        email: "ada@example.com",
        user: expect.objectContaining({ id: user.id }),
      }),
    ]);
  });

  it("doesn't alert when changing the password fails", async () => {
    const { auth, signUp, alerts } = await setup();
    const { headers } = await signUp("ada@example.com");
    await expect(
      auth.api.changePassword({
        body: { currentPassword: "wrong-password", newPassword: "new-password-1234" },
        headers,
      }),
    ).rejects.toThrow();
    expect(alerts).toEqual([]);
  });

  it("alerts when a reset is requested, only for existing users, without a link", async () => {
    const { auth, signUp, ofType } = await setup({
      secureAccount: { callbackURL: "/secure-account", password: "none" },
    });
    await signUp("ada@example.com");
    await auth.api.requestPasswordReset({ body: { email: "ada@example.com" } });
    await auth.api.requestPasswordReset({ body: { email: "nobody@example.com" } });
    const alerts = ofType("password-reset-requested");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      email: "ada@example.com",
      secureAccountUrl: null,
      details: { channel: "email" },
    });
  });

  it("alerts when the password is reset", async () => {
    const { auth, signUp, resetEmails, ofType } = await setup();
    const { user } = await signUp("ada@example.com");
    await auth.api.requestPasswordReset({ body: { email: "ada@example.com" } });
    const token = resetEmails[0]?.token ?? "";
    await auth.api.resetPassword({ body: { token, newPassword: "new-password-1234" } });
    expect(ofType("password-reset")).toEqual([
      expect.objectContaining({
        email: "ada@example.com",
        user: expect.objectContaining({ id: user.id }),
        details: expect.objectContaining({ channel: "email", actor: "user" }),
      }),
    ]);
  });
});

describe("email-changed", () => {
  it("goes to the old address, with the new one masked", async () => {
    const { auth, signUp, ofType } = await setup(
      {},
      { auth: { user: { changeEmail: { enabled: true, updateEmailWithoutVerification: true } } } },
    );
    const { headers } = await signUp("ada@example.com");
    await auth.api.changeEmail({ body: { newEmail: "lovelace@example.org" }, headers });
    const alerts = ofType("email-changed");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      email: "ada@example.com",
      user: { email: "lovelace@example.org" },
      details: { newEmail: "l***@example.org", actor: "user" },
    });
  });

  it("works through the confirmation links, without a session", async () => {
    const links: string[] = [];
    const { auth, signUp, ofType } = await setup(
      {},
      {
        auth: {
          user: {
            changeEmail: {
              enabled: true,
              sendChangeEmailConfirmation: async ({ url }) => {
                links.push(url);
              },
            },
          },
          emailVerification: {
            sendVerificationEmail: async ({ url }) => {
              links.push(url);
            },
          },
        },
      },
    );
    const { user, headers } = await signUp("ada@example.com");
    const context = await auth.$context;
    await context.internalAdapter.updateUser(user.id, { emailVerified: true });
    await auth.api.changeEmail({ body: { newEmail: "lovelace@example.org" }, headers });
    // Confirm on the old address, then verify the new one, both without a session.
    for (const _ of [1, 2]) {
      const link = new URL(links.at(-1) ?? "");
      await auth.api.verifyEmail({ query: { token: link.searchParams.get("token") ?? "" } });
    }
    expect(ofType("email-changed")).toEqual([
      expect.objectContaining({
        email: "ada@example.com",
        details: expect.objectContaining({ newEmail: "l***@example.org" }),
      }),
    ]);
  });
});

describe("account-linked", () => {
  it("alerts when an account is linked, not for the first account of a sign-up", async () => {
    const { signUp, context, ofType } = await setup();
    const { user } = await signUp("ada@example.com");
    expect(ofType("account-linked")).toEqual([]);
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "github",
      accountId: "12345",
    });
    expect(ofType("account-linked")).toEqual([
      expect.objectContaining({ details: expect.objectContaining({ providerId: "github" }) }),
    ]);
  });
});

describe("sendAlert", () => {
  it("errors are logged and don't fail the request", async () => {
    const { auth, signUp, signIn, context } = await setup({
      sendAlert: () => {
        throw new Error("mail server down");
      },
    });
    const error = vi.spyOn(context.logger, "error").mockImplementation(() => {});
    await signUp("ada@example.com");
    const headers = await signIn("ada@example.com", UA.firefoxLinux);
    await expect(auth.api.getSession({ headers })).resolves.toMatchObject({
      user: { email: "ada@example.com" },
    });
    expect(error).toHaveBeenCalledWith(
      "[security-alerts] sendAlert threw an error",
      expect.any(Error),
    );
  });

  it("runs in the background when better-auth's backgroundTasks is configured", async () => {
    const tasks: Promise<unknown>[] = [];
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: string[] = [];
    const { signUp, signIn } = await setup(
      {
        sendAlert: async (alert) => {
          await blocked;
          sent.push(alert.type);
        },
      },
      { auth: { advanced: { backgroundTasks: { handler: (task) => void tasks.push(task) } } } },
    );
    await signUp("ada@example.com");
    // Returns although sendAlert hasn't finished.
    await signIn("ada@example.com", UA.firefoxLinux);
    expect(sent).toEqual([]);
    release();
    await Promise.all(tasks);
    expect(sent).toEqual(["new-device"]);
  });
});

describe("admin actions", () => {
  async function adminSetup(options: Parameters<typeof setup>[0] = {}) {
    const { admin } = await import("better-auth/plugins");
    const instance = await setup(options, { plugins: [admin()] });
    const target = await instance.signUp("ada@example.com");
    const boss = await instance.signUp("boss@example.com");
    await instance.context.internalAdapter.updateUser(boss.user.id, { role: "admin" });
    const setPassword = () =>
      instance.auth.api.setUserPassword({
        body: { userId: target.user.id, newPassword: "set-by-admin-1234" },
        headers: boss.headers,
      });
    return { ...instance, target, boss, setPassword };
  }

  it("alert the user and say an admin did it", async () => {
    const { setPassword, ofType } = await adminSetup();
    await setPassword();
    expect(ofType("password-changed")).toEqual([
      expect.objectContaining({
        email: "ada@example.com",
        details: expect.objectContaining({ actor: "admin" }),
      }),
    ]);
  });

  it("count changes made while impersonating a user", async () => {
    const { auth, target, boss, ofType } = await adminSetup();
    const impersonating = await auth.api.impersonateUser({
      body: { userId: target.user.id },
      headers: boss.headers,
      returnHeaders: true,
    });
    await auth.api.changePassword({
      body: { currentPassword: PASSWORD, newPassword: "changed-as-ada-1234" },
      headers: browser(UA.chromeMac, { cookie: cookieOf(impersonating.headers) }),
    });
    expect(ofType("password-changed")).toEqual([
      expect.objectContaining({
        email: "ada@example.com",
        details: expect.objectContaining({ actor: "admin" }),
      }),
    ]);
  });

  it("can be left out, or not marked as an admin's", async () => {
    const off = await adminSetup({ adminActions: { alert: false } });
    await off.setPassword();
    expect(off.ofType("password-changed")).toEqual([]);

    const unmarked = await adminSetup({ adminActions: { showActor: false } });
    await unmarked.setPassword();
    expect(unmarked.ofType("password-changed")[0]?.details.actor).toBeNull();
  });
});

describe("secure account", () => {
  const secureAccount = {
    callbackURL: "http://localhost:3000/secure-account",
    resetPasswordURL: "http://localhost:3000/reset-password",
  };

  async function secureSetup(options: Parameters<typeof setup>[0] = { secureAccount }) {
    const instance = await setup(options);
    const { user, headers } = await instance.signUp("ada@example.com");
    const attacker = await instance.signIn("ada@example.com", UA.firefoxLinux);
    const link = instance.ofType("new-device")[0]?.secureAccountUrl ?? "";
    const token = link.split("/").at(-1) ?? "";
    return { ...instance, user, headers, attacker, link, token };
  }

  it("puts a single-use link in the alerts", async () => {
    const { link, token, context } = await secureSetup();
    expect(link).toMatch(
      new RegExp(`^${context.baseURL}/security-alerts/secure-account/[A-Za-z0-9]{32}$`),
    );
    expect(token).toHaveLength(32);
  });

  it("the link only redirects to the confirmation page", async () => {
    const { auth, token, attacker } = await secureSetup();
    const response = await auth.handler(
      new Request(`http://localhost:3000/api/auth/security-alerts/secure-account/${token}`),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `http://localhost:3000/secure-account?token=${token}`,
    );
    // Opening the link twice (mail scanners) changes nothing.
    await auth.handler(
      new Request(`http://localhost:3000/api/auth/security-alerts/secure-account/${token}`),
    );
    await expect(auth.api.getSession({ headers: attacker })).resolves.not.toBeNull();

    const invalid = await auth.handler(
      new Request("http://localhost:3000/api/auth/security-alerts/secure-account/nope"),
    );
    expect(invalid.headers.get("location")).toBe(
      "http://localhost:3000/secure-account?error=INVALID_TOKEN",
    );
  });

  it("signs out everywhere, blocks the password, and sends a reset link", async () => {
    const { auth, token, headers, attacker, resetEmails, signIn } = await secureSetup();
    await expect(auth.api.secureAccount({ body: { token } })).resolves.toEqual({ status: true });

    await expect(auth.api.getSession({ headers })).resolves.toBeNull();
    await expect(auth.api.getSession({ headers: attacker })).resolves.toBeNull();
    // The old password no longer works.
    await expect(signIn("ada@example.com", UA.firefoxLinux)).rejects.toThrow();
    expect(resetEmails).toHaveLength(1);
    expect(resetEmails[0]?.url).toContain(
      `/reset-password/${resetEmails[0]?.token}?callbackURL=${encodeURIComponent(secureAccount.resetPasswordURL)}`,
    );

    // The reset link works; afterwards every device is new again.
    await auth.api.resetPassword({
      body: { token: resetEmails[0]?.token ?? "", newPassword: "fresh-password-1234" },
    });
    await signIn("ada@example.com", UA.chromeMac, {}, "fresh-password-1234");
  });

  it("makes every device new again", async () => {
    const { auth, token, ofType, signIn } = await secureSetup({
      secureAccount: { ...secureAccount, password: "none" },
    });
    await auth.api.secureAccount({ body: { token } });
    await signIn("ada@example.com", UA.chromeMac);
    expect(ofType("new-device")).toHaveLength(2);
  });

  it("works once", async () => {
    const { auth, token } = await secureSetup();
    await auth.api.secureAccount({ body: { token } });
    await expect(auth.api.secureAccount({ body: { token } })).rejects.toMatchObject({
      body: { code: "INVALID_TOKEN" },
    });
  });

  it("rejects expired links", async () => {
    const { auth, token } = await secureSetup({
      secureAccount: { ...secureAccount, expiresIn: 60 },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 61_000);
      await expect(auth.api.secureAccount({ body: { token } })).rejects.toMatchObject({
        body: { code: "INVALID_TOKEN" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the password with password: "send-reset" and "none"', async () => {
    for (const password of ["send-reset", "none"] as const) {
      const { auth, token, resetEmails, signIn } = await secureSetup({
        secureAccount: { ...secureAccount, password },
      });
      await auth.api.secureAccount({ body: { token } });
      await signIn("ada@example.com", UA.chromeMac);
      expect(resetEmails).toHaveLength(password === "none" ? 0 : 1);
    }
  });

  it("only signs out without sendResetPassword, and warns at startup", async () => {
    const { getTestInstance } = await import("better-auth/test");
    const { securityAlerts } = await import("../src/index");
    const alerts: string[] = [];
    const logs: string[] = [];
    const { auth } = await getTestInstance(
      {
        logger: { log: (level, message) => void logs.push(`${level} ${message}`) },
        emailAndPassword: { enabled: true },
        plugins: [
          securityAlerts({
            sendAlert: (alert) => void alerts.push(alert.secureAccountUrl ?? ""),
            secureAccount,
          }),
        ],
      },
      { disableTestUser: true },
    );
    await auth.api.signUpEmail({
      body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
      headers: browser(UA.chromeMac),
    });
    await auth.api.signInEmail({
      body: { email: "ada@example.com", password: PASSWORD },
      headers: browser(UA.firefoxLinux),
    });
    expect(logs).toContainEqual(
      expect.stringMatching(/^warn \[security-alerts\] secureAccount\.password is "block"/),
    );
    const token = alerts[0]?.split("/").at(-1) ?? "";
    await auth.api.secureAccount({ body: { token } });
    await expect(
      auth.api.signInEmail({ body: { email: "ada@example.com", password: PASSWORD } }),
    ).resolves.toMatchObject({ user: { email: "ada@example.com" } });
  });

  it("rejects tokens without the secureAccount option", async () => {
    const { auth } = await setup();
    await expect(auth.api.secureAccount({ body: { token: "x" } })).rejects.toMatchObject({
      body: { code: "INVALID_TOKEN" },
    });
  });
});

describe("secure account after an email change", () => {
  const base = {
    callbackURL: "/secure-account",
    resetPasswordURL: "/reset-password",
  };
  const changeEmail = {
    user: { changeEmail: { enabled: true, updateEmailWithoutVerification: true } },
  };

  async function emailSetup(secureAccount: Record<string, unknown>) {
    const instance = await setup(
      { secureAccount: { ...base, ...secureAccount } },
      { auth: changeEmail },
    );
    const { user, headers } = await instance.signUp("ada@example.com");
    await instance.auth.api.changeEmail({ body: { newEmail: "attacker@evil.test" }, headers });
    const link = instance.ofType("email-changed")[0]?.secureAccountUrl ?? "";
    return { ...instance, user, token: link.split("/").at(-1) ?? "" };
  }

  it("keeps the new address by default; the reset link goes there", async () => {
    const { auth, token, user, context, resetEmails } = await emailSetup({});
    await auth.api.secureAccount({ body: { token } });
    expect((await context.internalAdapter.findUserById(user.id))?.email).toBe("attacker@evil.test");
    expect(resetEmails.map((email) => email.email)).toEqual(["attacker@evil.test"]);
  });

  it('puts the old address back with emailChange: "restore", without alerting the other one', async () => {
    const { auth, token, user, context, resetEmails, ofType } = await emailSetup({
      emailChange: "restore",
    });
    await auth.api.secureAccount({ body: { token } });
    const restored = await context.internalAdapter.findUserById(user.id);
    expect(restored).toMatchObject({ email: "ada@example.com", emailVerified: true });
    expect(resetEmails.map((email) => email.email)).toEqual(["ada@example.com"]);
    // Only the attacker's change alerted, not the restore.
    expect(ofType("email-changed")).toHaveLength(1);
  });

  it("doesn't restore an address another account has by now", async () => {
    const { auth, token, user, context, signUp } = await emailSetup({ emailChange: "restore" });
    const warn = vi.spyOn(context.logger, "warn").mockImplementation(() => {});
    await signUp("ada@example.com");
    await auth.api.secureAccount({ body: { token } });
    expect((await context.internalAdapter.findUserById(user.id))?.email).toBe("attacker@evil.test");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not restored"));
  });

  it("calls onSecured with what was done; its errors are logged", async () => {
    const onSecured = vi.fn(() => {
      throw new Error("ticket system down");
    });
    const { auth, token, user, context } = await emailSetup({ emailChange: "restore", onSecured });
    const error = vi.spyOn(context.logger, "error").mockImplementation(() => {});
    await expect(auth.api.secureAccount({ body: { token } })).resolves.toEqual({ status: true });
    expect(onSecured).toHaveBeenCalledWith(
      {
        user: expect.objectContaining({ id: user.id, email: "ada@example.com" }),
        alert: "email-changed",
        password: "block",
        removed: null,
        restoredEmail: "ada@example.com",
      },
      undefined,
    );
    expect(error).toHaveBeenCalledWith(
      "[security-alerts] onSecured threw an error",
      expect.any(Error),
    );
  });
});

describe("startup", () => {
  it("warns about response times without advanced.backgroundTasks", async () => {
    const { getTestInstance } = await import("better-auth/test");
    const { securityAlerts } = await import("../src/index");
    const start = async (extra: Record<string, unknown>, alerts = {}) => {
      const logs: string[] = [];
      const { auth } = await getTestInstance(
        {
          logger: { log: (level, message) => void logs.push(`${level} ${message}`) },
          plugins: [securityAlerts({ sendAlert: () => {}, alerts })],
          ...extra,
        },
        { disableTestUser: true },
      );
      await auth.$context;
      return logs.some((line) => line.includes("advanced.backgroundTasks isn't configured"));
    };
    expect(await start({})).toBe(true);
    expect(await start({ advanced: { backgroundTasks: { handler: () => {} } } })).toBe(false);
    expect(await start({}, { "password-reset-requested": false })).toBe(false);
  });
});

describe("devices endpoints", () => {
  it("list and forget the signed-in user's devices through the client", async () => {
    const { auth, signUp, signIn, ofType, customFetchImpl } = await setup();
    const { headers } = await signUp("ada@example.com");
    await signIn("ada@example.com", UA.firefoxLinux);
    const client = createAuthClient({
      baseURL: "http://localhost:3000",
      plugins: [securityAlertsClient()],
      fetchOptions: { customFetchImpl, headers },
    });

    const { data: devices } = await client.securityAlerts.listDevices();
    expect(devices?.map((device) => [device.label, device.current])).toEqual(
      expect.arrayContaining([
        ["Chrome on macOS", true],
        ["Firefox on Linux", false],
      ]),
    );
    expect(devices?.[0]).not.toHaveProperty("fingerprint");

    const firefox = devices?.find((device) => device.label === "Firefox on Linux");
    const { data } = await client.securityAlerts.forgetDevice({ id: firefox?.id ?? "" });
    expect(data).toEqual({ status: true });
    const { data: after } = await client.securityAlerts.listDevices();
    expect(after?.map((device) => device.label)).toEqual(["Chrome on macOS"]);

    // Forgotten: the next sign-in from it alerts again.
    await signIn("ada@example.com", UA.firefoxLinux);
    expect(ofType("new-device")).toHaveLength(2);

    // Someone else's device is not found.
    const other = await signUp("eve@example.com");
    const { error } = await client.securityAlerts.forgetDevice(
      { id: devices?.find((device) => device.current)?.id ?? "" },
      { headers: other.headers },
    );
    expect(error).toMatchObject({ status: 404, code: "DEVICE_NOT_FOUND" });
    await expect(auth.api.listDevices({ headers })).resolves.toHaveLength(2);
  });

  it("require a session", async () => {
    const { auth } = await setup();
    await expect(auth.api.listDevices({ headers: new Headers() })).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});
