import { admin, magicLink, testUtils, username } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import type { BlocklistOptions } from "../src/index";
import { blocklist } from "../src/index";

const GOOD_PASSWORD = "correct horse battery staple";

interface AuditEvent {
  type: string;
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
}

/** Stands in for `@checodo/better-auth-audit-log`, found through `getPlugin("audit-log")`. */
function fakeAuditLog(events: AuditEvent[]) {
  return {
    id: "audit-log",
    recordEvent: async (event: AuditEvent) => {
      events.push(event);
    },
  } as const;
}

async function setup(
  options: BlocklistOptions = {},
  { auditLog, ...extra }: { appName?: string; auditLog?: AuditEvent[] } = {},
) {
  const resetTokens: string[] = [];
  const magicLinks: string[] = [];
  const instance = await getTestInstance(
    {
      ...extra,
      emailAndPassword: {
        enabled: true,
        sendResetPassword: async ({ token }) => {
          resetTokens.push(token);
        },
      },
      plugins: [
        blocklist(options),
        username(),
        admin(),
        magicLink({
          sendMagicLink: async ({ token }) => {
            magicLinks.push(token);
          },
        }),
        testUtils(),
        ...(auditLog ? [fakeAuditLog(auditLog)] : []),
      ],
    },
    { disableTestUser: true },
  );
  const { auth } = instance;

  const signUp = (
    email: string,
    password: string,
    { headers, ...extraBody }: Record<string, unknown> & { headers?: Record<string, string> } = {},
  ) =>
    auth.api.signUpEmail({
      body: { email, password, name: "Test", ...extraBody },
      headers: new Headers(headers),
    });

  const createUser = async (email: string, role?: string) => {
    const { test } = await auth.$context;
    const user = await test.saveUser(test.createUser({ email, ...(role ? { role } : {}) }));
    const headers = await test.getAuthHeaders({ userId: user.id });
    return { user, headers };
  };

  return { ...instance, signUp, createUser, resetTokens, magicLinks };
}

async function expectBlocked(promise: Promise<unknown>, code: string, status = 400) {
  await expect(promise).rejects.toMatchObject({ statusCode: status, body: { code } });
}

const from = (ip: string, more: Record<string, string> = {}) => ({
  "x-forwarded-for": ip,
  ...more,
});

describe("password rules", () => {
  it("block passwords on sign-up, ignoring case and leetspeak", async () => {
    const { signUp } = await setup({
      password: { values: ["password123", { value: "qwerty", type: "contains" }] },
    });
    await expectBlocked(signUp("a@example.com", "Password123"), "PASSWORD_NOT_ALLOWED");
    await expectBlocked(signUp("b@example.com", "p@ssw0rd123"), "PASSWORD_NOT_ALLOWED");
    await expectBlocked(signUp("c@example.com", "my-qw3rty-pass"), "PASSWORD_NOT_ALLOWED");
    await expect(signUp("d@example.com", GOOD_PASSWORD)).resolves.toBeTruthy();
  });

  it("never pass the password to onBlocked, not even as the rule's value", async () => {
    const onBlocked = vi.fn();
    const { signUp } = await setup({ password: { values: ["password123"] }, onBlocked });
    await expectBlocked(signUp("a@example.com", "password123"), "PASSWORD_NOT_ALLOWED");
    expect(onBlocked).toHaveBeenCalledWith({
      target: "password",
      value: "[redacted]",
      rule: { value: "[redacted]", type: "exact" },
    });
  });

  it("never pass the password or part of it to onBlocked or the audit log", async () => {
    const onBlocked = vi.fn();
    const auditEvents: AuditEvent[] = [];
    const { signUp } = await setup(
      {
        password: {
          values: [
            "password123",
            { value: "hunter", type: "contains", reason: "Common word" },
            { value: "^letmein\\d+$", type: "regex" },
          ],
        },
        onBlocked,
      },
      { auditLog: auditEvents },
    );
    const attempts = ["password123", "Hunter-and-more", "letmein2024", "P@ssw0rd123"];
    for (const password of attempts) {
      await expectBlocked(signUp("a@example.com", password), "PASSWORD_NOT_ALLOWED");
    }

    const reported = JSON.stringify([onBlocked.mock.calls, auditEvents]).toLowerCase();
    for (const secret of ["password123", "hunter", "letmein", "p@ssw0rd"]) {
      expect(reported).not.toContain(secret);
    }
    expect(onBlocked).toHaveBeenCalledWith({
      target: "password",
      value: "[redacted]",
      rule: { value: "[redacted]", type: "contains", reason: "Common word" },
    });
    expect(auditEvents).toHaveLength(attempts.length);
    expect(auditEvents[0]).toMatchObject({
      type: "blocklist.blocked",
      errorCode: "PASSWORD_NOT_ALLOWED",
      metadata: { target: "password", value: "[redacted]", rule: { value: "[redacted]" } },
    });
  });

  it("keep the value and rule of other targets in onBlocked", async () => {
    const onBlocked = vi.fn();
    const { signUp } = await setup({ email: { values: ["eve@example.com"] }, onBlocked });
    await expectBlocked(signUp("eve@example.com", GOOD_PASSWORD), "EMAIL_NOT_ALLOWED");
    expect(onBlocked).toHaveBeenCalledWith({
      target: "email",
      value: "eve@example.com",
      rule: { value: "eve@example.com", type: "exact" },
    });
  });

  it("use VALUE_NOT_ALLOWED with genericErrorMessage", async () => {
    const { signUp } = await setup({
      password: { values: ["password123"] },
      genericErrorMessage: true,
    });
    await expectBlocked(signUp("a@example.com", "password123"), "VALUE_NOT_ALLOWED");
    await expectBlocked(signUp("jane.doe@example.com", "jane.doe-2024"), "VALUE_NOT_ALLOWED");
  });

  it("apply rules from the database, without the password option", async () => {
    const { auth, signUp, createUser } = await setup();
    const { headers } = await createUser("root@example.com", "admin");
    await auth.api.createBlocklistRule({
      body: { target: "password", type: "contains", value: "acme" },
      headers,
    });
    await expectBlocked(signUp("a@example.com", "I love ACME 2024"), "PASSWORD_NOT_ALLOWED");
    // Without the password option, there is no context check.
    await expect(signUp("jane.doe@example.com", "jane.doe-2024")).resolves.toBeTruthy();
  });

  it("are not checked on sign-in", async () => {
    const { auth, signUp, createUser } = await setup({ databaseCacheTtl: 0 });
    await signUp("a@example.com", "summer-2024-is-here");
    const { headers } = await createUser("root@example.com", "admin");
    await auth.api.createBlocklistRule({
      body: { target: "password", type: "contains", value: "summer" },
      headers,
    });
    await expect(
      auth.api.signInEmail({ body: { email: "a@example.com", password: "summer-2024-is-here" } }),
    ).resolves.toMatchObject({ user: { email: "a@example.com" } });
  });
});

describe("password context check", () => {
  it("rejects the email's local part, the username, and the app name", async () => {
    const { signUp } = await setup({ password: {} }, { appName: "Acme Cloud" });
    await expectBlocked(
      signUp("jane.doe+news@example.com", "Jane.Doe-2024"),
      "PASSWORD_CONTAINS_CONTEXT_WORD",
    );
    await expectBlocked(
      signUp("a@example.com", "hello-skywalker-99", { username: "skywalker" }),
      "PASSWORD_CONTAINS_CONTEXT_WORD",
    );
    await expectBlocked(
      signUp("b@example.com", "I love acm3 cloud"),
      "PASSWORD_CONTAINS_CONTEXT_WORD",
    );
    await expect(signUp("jane.doe@example.com", GOOD_PASSWORD)).resolves.toBeTruthy();
  });

  it("ignores short words and the default app name", async () => {
    const { signUp } = await setup({ password: {} });
    await expect(signUp("al@example.com", "al-better-auth-123")).resolves.toBeTruthy();
  });

  it("names the source in onBlocked, never the password", async () => {
    const onBlocked = vi.fn();
    const { signUp } = await setup({ password: {}, onBlocked });
    await expectBlocked(signUp("jane@example.com", "jane-2024!"), "PASSWORD_CONTAINS_CONTEXT_WORD");
    expect(onBlocked).toHaveBeenCalledWith({
      target: "password",
      value: "[redacted]",
      rule: { type: "contains", value: "[email]", reason: "Context-specific word" },
    });
  });

  it("can be turned off", async () => {
    const { signUp } = await setup({ password: { checkContext: false } });
    await expect(signUp("jane@example.com", "jane-2024!")).resolves.toBeTruthy();
  });

  it("checks /change-password against the signed-in user", async () => {
    const { auth, signUp } = await setup({ password: {} });
    await signUp("jane@example.com", GOOD_PASSWORD);
    const signIn = await auth.api.signInEmail({
      body: { email: "jane@example.com", password: GOOD_PASSWORD },
      returnHeaders: true,
    });
    const headers = new Headers({
      cookie: signIn.headers.get("set-cookie")?.split(";")[0] ?? "",
    });

    await expectBlocked(
      auth.api.changePassword({
        body: { currentPassword: GOOD_PASSWORD, newPassword: "jane-is-great-2024" },
        headers,
      }),
      "PASSWORD_CONTAINS_CONTEXT_WORD",
    );
    await expect(
      auth.api.changePassword({
        body: { currentPassword: GOOD_PASSWORD, newPassword: "another good passphrase" },
        headers,
      }),
    ).resolves.toBeTruthy();
  });

  it("checks /reset-password against the user of the token", async () => {
    const { auth, signUp, resetTokens } = await setup({ password: {} });
    await signUp("jane@example.com", GOOD_PASSWORD);
    await auth.api.requestPasswordReset({ body: { email: "jane@example.com" } });
    const token = resetTokens.at(-1) as string;

    await expectBlocked(
      auth.api.resetPassword({ body: { token, newPassword: "jane-is-great-2024" } }),
      "PASSWORD_CONTAINS_CONTEXT_WORD",
    );
    // The token is still valid after a blocked attempt.
    await expect(
      auth.api.resetPassword({ body: { token, newPassword: "another good passphrase" } }),
    ).resolves.toEqual({ status: true });
  });

  it("checks /reset-password only with a valid token", async () => {
    const { auth } = await setup({ password: { values: ["password123"] } });
    await expectBlocked(
      auth.api.resetPassword({ body: { token: "invalid", newPassword: "password123" } }),
      "INVALID_TOKEN",
    );
  });

  it("checks /admin/set-user-password against the target user", async () => {
    const { auth, createUser } = await setup({ password: {} });
    const { user } = await createUser("jane@example.com");
    const { headers } = await createUser("root@example.com", "admin");
    await expectBlocked(
      auth.api.setUserPassword({
        body: { userId: user.id, newPassword: "jane-is-great-2024" },
        headers,
      }),
      "PASSWORD_CONTAINS_CONTEXT_WORD",
    );
  });

  it("checks /set-password for a user without a password", async () => {
    const { auth, createUser } = await setup({ password: { values: ["password123"] } });
    const { headers } = await createUser("jane@example.com");
    await expectBlocked(
      auth.api.setPassword({ body: { newPassword: "password123" }, headers }),
      "PASSWORD_NOT_ALLOWED",
    );
    await expectBlocked(
      auth.api.setPassword({ body: { newPassword: "jane-is-great-2024" }, headers }),
      "PASSWORD_CONTAINS_CONTEXT_WORD",
    );
    await expect(
      auth.api.setPassword({ body: { newPassword: GOOD_PASSWORD }, headers }),
    ).resolves.toEqual({ status: true });
  });

  it("checks /admin/create-user", async () => {
    const { auth, createUser } = await setup({ password: {} });
    const { headers } = await createUser("root@example.com", "admin");
    await expectBlocked(
      auth.api.createUser({
        body: { email: "jane@example.com", password: "jane-is-great-2024", name: "Jane" },
        headers,
      }),
      "PASSWORD_CONTAINS_CONTEXT_WORD",
    );
  });
});

describe("ip rules", () => {
  it("block sign-up and sign-in from a blocked address or range with a 403", async () => {
    const { auth, signUp } = await setup({
      ip: { values: ["203.0.113.7"], ranges: ["198.51.100.0/24", "2001:db8::/32"] },
    });
    await expectBlocked(
      signUp("a@example.com", GOOD_PASSWORD, { headers: from("203.0.113.7") }),
      "IP_ADDRESS_NOT_ALLOWED",
      403,
    );
    await expectBlocked(
      signUp("a@example.com", GOOD_PASSWORD, { headers: from("198.51.100.200") }),
      "IP_ADDRESS_NOT_ALLOWED",
      403,
    );
    await expectBlocked(
      signUp("a@example.com", GOOD_PASSWORD, { headers: from("2001:db8:1::5") }),
      "IP_ADDRESS_NOT_ALLOWED",
      403,
    );

    await signUp("a@example.com", GOOD_PASSWORD, { headers: from("203.0.113.8") });
    // Blocked before the password is checked: a wrong one gets the same answer.
    for (const password of [GOOD_PASSWORD, "wrong password!"]) {
      await expectBlocked(
        auth.api.signInEmail({
          body: { email: "a@example.com", password },
          headers: new Headers(from("203.0.113.7")),
        }),
        "IP_ADDRESS_NOT_ALLOWED",
        403,
      );
    }
    await expect(
      auth.api.signInEmail({
        body: { email: "a@example.com", password: GOOD_PASSWORD },
        headers: new Headers(from("203.0.113.8")),
      }),
    ).resolves.toBeTruthy();
  });

  it("match full IPv6 addresses, not only their /64 network", async () => {
    const { signUp } = await setup({ ip: { values: ["2001:db8::1"] } });
    await expectBlocked(
      signUp("a@example.com", GOOD_PASSWORD, { headers: from("2001:db8:0:0::1") }),
      "IP_ADDRESS_NOT_ALLOWED",
      403,
    );
    await expect(
      signUp("a@example.com", GOOD_PASSWORD, { headers: from("2001:db8::2") }),
    ).resolves.toBeTruthy();
  });

  it("let allowed addresses and ranges through", async () => {
    const { signUp } = await setup({
      ip: { ranges: ["10.0.0.0/8"], allow: ["10.1.0.0/16", "10.2.3.4"] },
    });
    await expect(
      signUp("a@example.com", GOOD_PASSWORD, { headers: from("10.1.2.3") }),
    ).resolves.toBeTruthy();
    await expect(
      signUp("b@example.com", GOOD_PASSWORD, { headers: from("10.2.3.4") }),
    ).resolves.toBeTruthy();
    await expectBlocked(
      signUp("c@example.com", GOOD_PASSWORD, { headers: from("10.2.3.5") }),
      "IP_ADDRESS_NOT_ALLOWED",
      403,
    );
  });

  it("block countries from getCountry", async () => {
    const onBlocked = vi.fn();
    const { signUp } = await setup({
      ip: {
        countries: ["KP"],
        getCountry: ({ headers }) => headers.get("cf-ipcountry"),
      },
      onBlocked,
    });
    await expectBlocked(
      signUp("a@example.com", GOOD_PASSWORD, {
        headers: from("203.0.113.7", { "cf-ipcountry": "kp" }),
      }),
      "IP_ADDRESS_NOT_ALLOWED",
      403,
    );
    expect(onBlocked).toHaveBeenCalledWith({
      target: "ip",
      value: "KP",
      rule: { value: "KP", type: "country" },
    });
    await expect(
      signUp("a@example.com", GOOD_PASSWORD, {
        headers: from("203.0.113.7", { "cf-ipcountry": "DE" }),
      }),
    ).resolves.toBeTruthy();
  });

  it("treat an error from getCountry as an unknown country, and log it", async () => {
    const { auth, signUp } = await setup({
      ip: {
        values: ["203.0.113.7"],
        countries: ["KP"],
        getCountry: () => {
          throw new Error("geo lookup failed");
        },
      },
    });
    const { logger } = await auth.$context;
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    await expect(
      signUp("a@example.com", GOOD_PASSWORD, { headers: from("198.51.100.1") }),
    ).resolves.toBeTruthy();
    await expectBlocked(
      signUp("b@example.com", GOOD_PASSWORD, { headers: from("203.0.113.7") }),
      "IP_ADDRESS_NOT_ALLOWED",
      403,
    );
    expect(error).toHaveBeenCalledWith("[blocklist] getCountry threw an error", expect.any(Error));
  });

  it("only apply in their scope", async () => {
    const { auth, signUp } = await setup({ ip: { values: ["203.0.113.7"], scope: ["sign-up"] } });
    await signUp("a@example.com", GOOD_PASSWORD, { headers: from("203.0.113.8") });
    await expect(
      auth.api.signInEmail({
        body: { email: "a@example.com", password: GOOD_PASSWORD },
        headers: new Headers(from("203.0.113.7")),
      }),
    ).resolves.toBeTruthy();
  });

  it("check users created outside /sign-up (magic link)", async () => {
    const onBlocked = vi.fn();
    const { auth, magicLinks, userCount } = await setup({
      ip: { values: ["203.0.113.7"], scope: ["sign-up"] },
      onBlocked,
    }).then(async (instance) => {
      const context = await instance.auth.$context;
      const userCount = async () => (await context.adapter.findMany({ model: "user" })).length;
      return { ...instance, userCount };
    });
    // Requested from an allowed address, opened from a blocked one.
    await auth.api.signInMagicLink({
      body: { email: "new@example.com" },
      headers: new Headers(from("203.0.113.8")),
    });
    // Magic link turns errors into a redirect to its error page.
    await expect(
      auth.api.magicLinkVerify({
        query: { token: magicLinks.at(-1) as string },
        headers: new Headers(from("203.0.113.7")),
      }),
    ).rejects.toMatchObject({ statusCode: 302 });
    expect(await userCount()).toBe(0);
    expect(onBlocked).toHaveBeenCalledWith(
      expect.objectContaining({ target: "ip", value: "203.0.113.7" }),
    );
  });

  it("don't apply to admins creating users", async () => {
    const { auth, createUser } = await setup({ ip: { values: ["203.0.113.7"] } });
    const { headers } = await createUser("root@example.com", "admin");
    headers.set("x-forwarded-for", "203.0.113.7");
    await expect(
      auth.api.createUser({
        body: { email: "jane@example.com", password: GOOD_PASSWORD, name: "Jane" },
        headers,
      }),
    ).resolves.toBeTruthy();
  });

  it("reject invalid static rules when the plugin is created", () => {
    expect(() => blocklist({ ip: { values: ["10.0.0.0/8"] } })).toThrow(/cidr/);
    expect(() => blocklist({ ip: { values: ["not-an-ip"] } })).toThrow(/not an IP address/);
    expect(() => blocklist({ ip: { ranges: ["10.0.0.0/33"] } })).toThrow(/CIDR range/);
    expect(() => blocklist({ ip: { values: [{ value: "10.", type: "prefix" }] } })).toThrow(
      /takes "exact", "cidr", "country"/,
    );
    expect(() => blocklist({ ip: { countries: ["KP"] } })).toThrow(/getCountry/);
    expect(() => blocklist({ ip: { countries: ["North Korea"], getCountry: () => null } })).toThrow(
      /country code/,
    );
    expect(() => blocklist({ ip: { allow: ["nope"] } })).toThrow(/allow entry/);
    expect(() => blocklist({ ip: { scope: ["admin" as never] } })).toThrow(/scope/);
    expect(() =>
      blocklist({ password: { values: [{ value: "10.0.0.0/8", type: "cidr" }] } }),
    ).toThrow(/password target takes/);
  });
});

describe("rule endpoints for password and ip", () => {
  it("store IP rules in canonical form and validate them", async () => {
    const { auth, createUser, signUp } = await setup();
    const { headers } = await createUser("root@example.com", "admin");
    const create = (body: {
      target: "ip" | "password";
      value: string;
      type?: "exact" | "cidr" | "country" | "contains";
    }) => auth.api.createBlocklistRule({ body, headers });

    const { rule } = await create({ target: "ip", type: "cidr", value: "198.51.100.77/24" });
    expect(rule.value).toBe("198.51.100.0/24");
    await expectBlocked(
      create({ target: "ip", type: "cidr", value: "198.51.100.0/24" }),
      "RULE_ALREADY_EXISTS",
    );
    const { rule: exact } = await create({ target: "ip", value: "2001:0DB8::0001" });
    expect(exact.value).toBe("2001:db8::1");

    await expectBlocked(create({ target: "ip", value: "10.0.0.0/8" }), "INVALID_IP_RULE");
    await expectBlocked(create({ target: "ip", type: "cidr", value: "nope/8" }), "INVALID_IP_RULE");
    await expectBlocked(
      create({ target: "ip", type: "contains", value: "10." }),
      "RULE_TYPE_NOT_SUPPORTED_FOR_TARGET",
    );
    await expectBlocked(
      create({ target: "password", type: "cidr", value: "10.0.0.0/8" }),
      "RULE_TYPE_NOT_SUPPORTED_FOR_TARGET",
    );
    await expectBlocked(
      create({ target: "ip", type: "country", value: "KP" }),
      "COUNTRY_RULES_REQUIRE_GET_COUNTRY",
    );

    await expectBlocked(
      signUp("a@example.com", GOOD_PASSWORD, { headers: from("198.51.100.1") }),
      "IP_ADDRESS_NOT_ALLOWED",
      403,
    );
  });

  it("store country rules when getCountry is set", async () => {
    const { auth, createUser, signUp } = await setup({
      ip: { getCountry: ({ headers }) => headers.get("x-vercel-ip-country") },
    });
    const { headers } = await createUser("root@example.com", "admin");
    const { rule } = await auth.api.createBlocklistRule({
      body: { target: "ip", type: "country", value: "RU" },
      headers,
    });
    expect(rule.value).toBe("ru");
    await expectBlocked(
      signUp("a@example.com", GOOD_PASSWORD, {
        headers: from("203.0.113.9", { "x-vercel-ip-country": "RU" }),
      }),
      "IP_ADDRESS_NOT_ALLOWED",
      403,
    );
  });
});
