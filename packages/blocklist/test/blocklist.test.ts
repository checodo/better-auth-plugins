import type { BetterAuthPlugin } from "@better-auth/core";
import { createAuthEndpoint } from "better-auth/api";
import { admin, emailOTP, organization, testUtils, username } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { BLOCKLIST_ERROR_CODES, blocklistClient } from "../src/client";
import type { BlocklistOptions } from "../src/index";
import { blocklist } from "../src/index";

const PASSWORD = "password1234";

async function setup(options: BlocklistOptions = {}) {
  const instance = await getTestInstance(
    {
      plugins: [
        blocklist({
          email: {
            domains: ["mailinator.com"],
            addresses: ["blocked@example.com"],
            allow: ["friend@mailinator.com"],
          },
          username: { values: ["admin", { value: "^support_", type: "regex" }] },
          organization: { values: ["billing"] },
          team: { values: [{ value: "staff", type: "contains" }] },
          ...options,
        }),
        username(),
        admin(),
        organization({ teams: { enabled: true } }),
        testUtils(),
      ],
    },
    { disableTestUser: true, clientOptions: { plugins: [blocklistClient()] } },
  );

  const signUp = (email: string, extra: Record<string, unknown> = {}) =>
    instance.auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "Test", ...extra },
    });

  /**
   * Creates a user (optionally with a role) and session headers for it,
   * through better-auth's `testUtils` plugin. The user is still created
   * through `internalAdapter.createUser`, so the blocklist checks it too.
   */
  const createUser = async (email: string, role?: string) => {
    const { test } = await instance.auth.$context;
    const user = await test.saveUser(test.createUser({ email, ...(role ? { role } : {}) }));
    const headers = await test.getAuthHeaders({ userId: user.id });
    return { user, headers };
  };

  return { ...instance, signUp, createUser };
}

async function expectBlocked(promise: Promise<unknown>, code: string, status = 400) {
  await expect(promise).rejects.toMatchObject({ statusCode: status, body: { code } });
}

describe("email", () => {
  it("rejects a blocked domain and its subdomains", async () => {
    const { signUp } = await setup();
    await expectBlocked(signUp("someone@mailinator.com"), "EMAIL_NOT_ALLOWED");
    await expectBlocked(signUp("someone@eu.mailinator.com"), "EMAIL_NOT_ALLOWED");
  });

  it("does not treat a lookalike domain as a subdomain", async () => {
    const { signUp } = await setup();
    await expect(signUp("someone@notmailinator.com")).resolves.toBeTruthy();
  });

  it("rejects a blocked address, ignoring case and +tags", async () => {
    const { signUp } = await setup();
    await expectBlocked(signUp("Blocked+promo@Example.com"), "EMAIL_NOT_ALLOWED");
  });

  it("lets allow-listed addresses through", async () => {
    const { signUp } = await setup();
    await expect(signUp("Friend+x@mailinator.com")).resolves.toBeTruthy();
  });

  it("returns the error over HTTP from the client", async () => {
    const { client } = await setup();
    const result = await client.signUp.email({
      email: "someone@mailinator.com",
      password: PASSWORD,
      name: "Someone",
    });
    expect(result.error?.status).toBe(400);
    expect(result.error?.code).toBe("EMAIL_NOT_ALLOWED");
  });

  it("checks users created outside /sign-up/email (OAuth, magic link, admin, ...)", async () => {
    const { auth } = await setup();
    const ctx = await auth.$context;
    await expectBlocked(
      ctx.internalAdapter.createUser(
        { email: "oauth@mailinator.com", name: "OAuth" },
        { method: "magic-link" },
      ),
      "EMAIL_NOT_ALLOWED",
    );
  });

  it("rejects /change-email to a blocked address", async () => {
    const { auth, createUser } = await setup();
    const { headers } = await createUser("user@example.com");
    await expectBlocked(
      auth.api.changeEmail({ body: { newEmail: "new@mailinator.com" }, headers }),
      "EMAIL_NOT_ALLOWED",
    );
  });

  it("rejects an email OTP email change to a blocked address before sending the code", async () => {
    const sendVerificationOTP = vi.fn(async () => {});
    const { auth } = await getTestInstance(
      {
        plugins: [
          blocklist({ email: { domains: ["mailinator.com"] } }),
          emailOTP({ sendVerificationOTP, changeEmail: { enabled: true } }),
          testUtils(),
        ],
      },
      { disableTestUser: true },
    );
    const { test } = await auth.$context;
    const user = await test.saveUser(test.createUser({ email: "user@example.com" }));
    const headers = await test.getAuthHeaders({ userId: user.id });

    await expectBlocked(
      auth.api.requestEmailChangeEmailOTP({ body: { newEmail: "new@mailinator.com" }, headers }),
      "EMAIL_NOT_ALLOWED",
    );
    expect(sendVerificationOTP).not.toHaveBeenCalled();

    await auth.api.requestEmailChangeEmailOTP({ body: { newEmail: "new@example.com" }, headers });
    expect(sendVerificationOTP).toHaveBeenCalledOnce();
  });

  it("blocks a domain written with a trailing dot, for users created outside email sign-up", async () => {
    const { auth } = await getTestInstance(
      { plugins: [blocklist({ email: { domains: ["mailinator.com"] } })] },
      { disableTestUser: true },
    );
    const { internalAdapter } = await auth.$context;

    // OAuth callbacks and server code create users through the internal
    // adapter, without the email validation of `/sign-up/email`.
    await expectBlocked(
      internalAdapter.createUser(
        { email: "user@mailinator.com.", name: "User", emailVerified: true },
        { method: "oauth", oauth: { providerId: "github", profile: {} } },
      ),
      "EMAIL_NOT_ALLOWED",
    );
  });

  it("rejects blocked emails on the waitlist plugin's join and invite endpoints", async () => {
    // Stands in for @checodo/better-auth-waitlist: the blocklist only
    // matches the paths and reads `email` from the body.
    const handled = vi.fn();
    const endpoint = (path: string) =>
      createAuthEndpoint(
        path,
        { method: "POST", body: z.object({ email: z.string() }) },
        async (ctx) => {
          handled(ctx.body.email);
          return ctx.json({ success: true });
        },
      );
    const { auth } = await getTestInstance(
      {
        plugins: [
          blocklist({ email: { domains: ["mailinator.com"] } }),
          {
            id: "waitlist",
            endpoints: {
              joinWaitlist: endpoint("/waitlist/join"),
              createWaitlistInvite: endpoint("/waitlist/create-invite"),
            },
          } satisfies BetterAuthPlugin,
        ],
      },
      { disableTestUser: true },
    );

    await expectBlocked(
      auth.api.joinWaitlist({ body: { email: "me@mailinator.com" } }),
      "EMAIL_NOT_ALLOWED",
    );
    await expectBlocked(
      auth.api.createWaitlistInvite({ body: { email: "me@eu.mailinator.com" } }),
      "EMAIL_NOT_ALLOWED",
    );
    expect(handled).not.toHaveBeenCalled();

    await auth.api.joinWaitlist({ body: { email: "me@example.com" } });
    expect(handled).toHaveBeenCalledWith("me@example.com");
  });

  it("keeps the +tag significant with stripPlusAddressing: false", async () => {
    const { signUp } = await setup({
      email: { addresses: ["blocked@example.com"], stripPlusAddressing: false },
    });
    await expectBlocked(signUp("blocked@example.com"), "EMAIL_NOT_ALLOWED");
    await expect(signUp("blocked+ok@example.com")).resolves.toBeTruthy();
  });
});

describe("username", () => {
  it("rejects blocked usernames on sign-up, including regex matches", async () => {
    const { signUp } = await setup();
    await expectBlocked(signUp("a@example.com", { username: "Admin" }), "USERNAME_NOT_ALLOWED");
    await expectBlocked(
      signUp("b@example.com", { username: "support_team" }),
      "USERNAME_NOT_ALLOWED",
    );
    await expect(signUp("d@example.com", { username: "jane" })).resolves.toBeTruthy();
  });

  it("rejects a blocked username on /update-user", async () => {
    const { auth, createUser } = await setup();
    const { headers } = await createUser("user@example.com");
    await expectBlocked(
      auth.api.updateUser({ body: { username: "admin" }, headers }),
      "USERNAME_NOT_ALLOWED",
    );
    await expect(auth.api.updateUser({ body: { name: "Other" }, headers })).resolves.toBeTruthy();
  });

  it("checks displayUsername against the username rules", async () => {
    const { signUp } = await setup();
    await expectBlocked(
      signUp("a@example.org", { username: "jane", displayUsername: "Admin" }),
      "USERNAME_NOT_ALLOWED",
    );
  });

  it("lets allow-listed usernames through", async () => {
    const { signUp } = await setup({ username: { values: ["admin"], allow: ["Admin"] } });
    await expect(signUp("a@example.org", { username: "admin" })).resolves.toBeTruthy();
  });
});

describe("organization and team", () => {
  it("checks organization names and slugs on create and update", async () => {
    const { auth, createUser } = await setup();
    const { headers } = await createUser("owner@example.com");

    await expectBlocked(
      auth.api.createOrganization({ body: { name: "Billing", slug: "acme" }, headers }),
      "ORGANIZATION_NAME_NOT_ALLOWED",
    );
    await expectBlocked(
      auth.api.createOrganization({ body: { name: "Acme", slug: "billing" }, headers }),
      "ORGANIZATION_NAME_NOT_ALLOWED",
    );

    const org = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme" },
      headers,
    });
    await expectBlocked(
      auth.api.updateOrganization({
        body: { organizationId: org.id, data: { name: "billing" } },
        headers,
      }),
      "ORGANIZATION_NAME_NOT_ALLOWED",
    );
    await expectBlocked(
      auth.api.updateOrganization({
        body: { organizationId: org.id, data: { slug: "billing" } },
        headers,
      }),
      "ORGANIZATION_NAME_NOT_ALLOWED",
    );
  });

  it("checks team names on create and update", async () => {
    const { auth, createUser } = await setup();
    const { headers } = await createUser("owner@example.com");
    const org = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme" },
      headers,
    });

    await expectBlocked(
      auth.api.createTeam({ body: { name: "Staff room", organizationId: org.id }, headers }),
      "TEAM_NAME_NOT_ALLOWED",
    );

    const team = await auth.api.createTeam({
      body: { name: "Engineering", organizationId: org.id },
      headers,
    });
    await expectBlocked(
      auth.api.updateTeam({ body: { teamId: team.id, data: { name: "all staff" } }, headers }),
      "TEAM_NAME_NOT_ALLOWED",
    );
  });

  it("checks a new organization's name against team rules when a default team is created", async () => {
    const { auth, createUser } = await setup();
    const { headers } = await createUser("owner@example.org");
    await expectBlocked(
      auth.api.createOrganization({ body: { name: "Staff Room", slug: "staff-room" }, headers }),
      "TEAM_NAME_NOT_ALLOWED",
    );
  });
});

describe("availability checks", () => {
  it("answers /is-username-available with the blocklist error, without onBlocked", async () => {
    const onBlocked = vi.fn();
    const { auth } = await setup({ onBlocked });
    await expectBlocked(
      auth.api.isUsernameAvailable({ body: { username: "admin" } }),
      "USERNAME_NOT_ALLOWED",
    );
    await expect(auth.api.isUsernameAvailable({ body: { username: "jane" } })).resolves.toEqual({
      available: true,
    });
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("answers /organization/check-slug with the blocklist error", async () => {
    const { auth, createUser } = await setup();
    const { headers } = await createUser("owner@example.org");
    await expectBlocked(
      auth.api.checkOrganizationSlug({ body: { slug: "billing" }, headers }),
      "ORGANIZATION_NAME_NOT_ALLOWED",
    );
    await expect(
      auth.api.checkOrganizationSlug({ body: { slug: "acme" }, headers }),
    ).resolves.toEqual({ status: true });
  });

  it("does not let testUtils bypass the blocklist", async () => {
    const { auth } = await setup();
    const { test } = await auth.$context;
    await expectBlocked(
      test.saveUser(test.createUser({ email: "x@mailinator.com" })),
      "EMAIL_NOT_ALLOWED",
    );
  });
});

describe("options", () => {
  it("uses a generic error message when configured", async () => {
    const { signUp } = await setup({ genericErrorMessage: true });
    await expectBlocked(signUp("someone@mailinator.com"), "VALUE_NOT_ALLOWED");
  });

  it("calls onBlocked with the target, value, and rule", async () => {
    const onBlocked = vi.fn();
    const { signUp } = await setup({ onBlocked });
    await expectBlocked(signUp("someone@mailinator.com"), "EMAIL_NOT_ALLOWED");
    expect(onBlocked).toHaveBeenCalledWith({
      target: "email",
      value: "someone@mailinator.com",
      rule: { value: "mailinator.com", type: "domain", reason: undefined },
    });
  });

  it("folds confusable characters by default", async () => {
    const { auth, createUser } = await setup();
    const { headers } = await createUser("owner@example.com");
    // Cyrillic "\u0456" in place of the Latin "i"
    await expectBlocked(
      auth.api.createOrganization({ body: { name: "B\u0456lling", slug: "acme" }, headers }),
      "ORGANIZATION_NAME_NOT_ALLOWED",
    );
  });

  it("ignores invisible characters in names", async () => {
    const { auth, createUser } = await setup();
    const { headers } = await createUser("owner@example.com");
    await expectBlocked(
      auth.api.createOrganization({ body: { name: "Bil​ling", slug: "acme" }, headers }),
      "ORGANIZATION_NAME_NOT_ALLOWED",
    );
    await expectBlocked(
      auth.api.createOrganization({ body: { name: "Acme", slug: "bil­ling" }, headers }),
      "ORGANIZATION_NAME_NOT_ALLOWED",
    );
  });

  it("catches Turkish dotted I and accents in names", async () => {
    const { auth, createUser } = await setup();
    const { headers } = await createUser("owner@example.org");
    await expectBlocked(
      auth.api.createOrganization({ body: { name: "B\u0130LL\u0130NG", slug: "acme" }, headers }),
      "ORGANIZATION_NAME_NOT_ALLOWED",
    );
    await expectBlocked(
      auth.api.createOrganization({ body: { name: "B\u00EDlling", slug: "acme" }, headers }),
      "ORGANIZATION_NAME_NOT_ALLOWED",
    );
  });

  it("only trims and lowercases with normalize: false", async () => {
    const { auth, createUser } = await setup({ normalize: false });
    const { headers } = await createUser("owner@example.com");
    await expect(
      auth.api.createOrganization({ body: { name: "B\u0456lling", slug: "acme" }, headers }),
    ).resolves.toBeTruthy();
    await expectBlocked(
      auth.api.createOrganization({ body: { name: " BILLING ", slug: "other" }, headers }),
      "ORGANIZATION_NAME_NOT_ALLOWED",
    );
  });

  it("rejects invalid static rules when the plugin is created", () => {
    expect(() => blocklist({ username: { values: [{ value: "(a+)+", type: "regex" }] } })).toThrow(
      /regular expression/,
    );
    expect(() => blocklist({ username: { values: [{ value: "x.com", type: "domain" }] } })).toThrow(
      /Domain rules/,
    );
    expect(() => blocklist({ username: { values: [{ value: "^Admin", type: "regex" }] } })).toThrow(
      /uppercase/,
    );
  });

  it("keeps the blocklist error when onBlocked throws, and logs it", async () => {
    const failure = new Error("audit service down");
    const { auth, signUp } = await setup({
      onBlocked: () => {
        throw failure;
      },
    });
    // Captured, so the expected error isn't printed as if a test failed.
    const logError = vi.spyOn((await auth.$context).logger, "error").mockImplementation(() => {});

    await expectBlocked(signUp("someone@mailinator.com"), "EMAIL_NOT_ALLOWED");
    expect(logError).toHaveBeenCalledWith("[blocklist] onBlocked threw an error", failure);
  });

  it("ignores stored rules for a target with useDatabase: false", async () => {
    const { auth, signUp } = await setup({
      email: { useDatabase: false },
      databaseCacheTtl: 0,
    });
    const ctx = await auth.$context;
    await ctx.adapter.create({
      model: "blocklistRule",
      data: { target: "email", type: "domain", value: "stored.example", createdAt: new Date() },
    });
    await expect(signUp("a@stored.example")).resolves.toBeTruthy();
  });
});

describe("rule endpoints", () => {
  it("are forbidden for users without an admin role", async () => {
    const { auth, createUser } = await setup();
    const { headers } = await createUser("user@example.com");
    await expectBlocked(
      auth.api.listBlocklistRules({ headers }),
      "YOU_ARE_NOT_ALLOWED_TO_MANAGE_BLOCKLIST_RULES",
      403,
    );
    await expectBlocked(
      auth.api.createBlocklistRule({ body: { target: "email", value: "x.com" }, headers }),
      "YOU_ARE_NOT_ALLOWED_TO_MANAGE_BLOCKLIST_RULES",
      403,
    );
  });

  it("require a session", async () => {
    const { auth } = await setup();
    const headers = new Headers();
    await expect(auth.api.listBlocklistRules({ headers })).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(
      auth.api.createBlocklistRule({ body: { target: "email", value: "x.com" }, headers }),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      auth.api.deleteBlocklistRule({ body: { id: "any" }, headers }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("forbid deleting rules for users without an admin role", async () => {
    const { auth, createUser } = await setup();
    const admin = await createUser("root@example.org", "admin");
    const user = await createUser("user@example.org");
    const { rule } = await auth.api.createBlocklistRule({
      body: { target: "username", value: "taken" },
      headers: admin.headers,
    });
    await expectBlocked(
      auth.api.deleteBlocklistRule({ body: { id: rule.id }, headers: user.headers }),
      "YOU_ARE_NOT_ALLOWED_TO_MANAGE_BLOCKLIST_RULES",
      403,
    );
  });

  it("work through the client plugin", async () => {
    const { client, createUser } = await setup();
    const { headers } = await createUser("root@example.org", "admin");
    const fetchOptions = { headers };

    const created = await client.blocklist.createRule({
      target: "email",
      type: "domain",
      value: "client.example",
      fetchOptions,
    });
    expect(created.data?.rule.value).toBe("client.example");

    const id = created.data?.rule.id ?? "";
    const deleted = await client.blocklist.deleteRule({ id, fetchOptions });
    expect(deleted.data).toEqual({ success: true });

    const missing = await client.blocklist.deleteRule({ id, fetchOptions });
    expect(missing.error?.code).toBe(BLOCKLIST_ERROR_CODES.RULE_NOT_FOUND.code);
  });

  it("create, list, and delete rules that apply immediately", async () => {
    const { auth, client, createUser, signUp } = await setup();
    const { headers } = await createUser("root@example.com", "user,admin");

    const { rule } = await auth.api.createBlocklistRule({
      body: { target: "email", value: "spam.io", type: "domain", reason: "spam" },
      headers,
    });
    await auth.api.createBlocklistRule({
      body: { target: "username", value: "root" },
      headers,
    });

    await expectBlocked(signUp("x@spam.io"), "EMAIL_NOT_ALLOWED");
    await expectBlocked(signUp("y@example.com", { username: "root" }), "USERNAME_NOT_ALLOWED");

    const all = await auth.api.listBlocklistRules({ headers });
    expect(all.rules).toHaveLength(2);
    const emailOnly = await auth.api.listBlocklistRules({ query: { target: "email" }, headers });
    expect(emailOnly.rules).toMatchObject([
      { id: rule.id, target: "email", type: "domain", value: "spam.io", reason: "spam" },
    ]);

    const viaClient = await client.blocklist.listRules({ fetchOptions: { headers } });
    expect(viaClient.data?.rules).toHaveLength(2);

    await expect(auth.api.deleteBlocklistRule({ body: { id: rule.id }, headers })).resolves.toEqual(
      { success: true },
    );
    await expect(signUp("x@spam.io")).resolves.toBeTruthy();
  });

  it("validate new rules", async () => {
    const { auth, createUser } = await setup({ team: { useDatabase: false } });
    const { headers } = await createUser("root@example.com", "admin");
    const create = (body: {
      target: "email" | "username" | "organization" | "team";
      value: string;
      type?: "exact" | "domain" | "regex";
    }) => auth.api.createBlocklistRule({ body, headers });

    await create({ target: "username", value: "taken" });
    await expectBlocked(create({ target: "username", value: "taken" }), "RULE_ALREADY_EXISTS");
    await expectBlocked(
      create({ target: "username", value: "x.com", type: "domain" }),
      "DOMAIN_RULE_ONLY_FOR_EMAIL",
    );
    for (const value of ["(a+)+$", "((a+))+$", ".*.*.*.*x"]) {
      await expectBlocked(
        create({ target: "username", value, type: "regex" }),
        "INVALID_REGEX_RULE",
      );
    }
    await expectBlocked(
      create({ target: "username", value: "^Admin", type: "regex" }),
      "REGEX_RULE_MUST_BE_LOWERCASE",
    );
    await expectBlocked(
      create({ target: "team", value: "x" }),
      "DATABASE_RULES_DISABLED_FOR_TARGET",
    );
    await expectBlocked(
      auth.api.deleteBlocklistRule({ body: { id: "missing" }, headers }),
      "RULE_NOT_FOUND",
      404,
    );
  });

  it("stores rule values normalized, so equivalent rules are duplicates", async () => {
    const { auth, createUser } = await setup();
    const { headers } = await createUser("root@example.org", "admin");
    const { rule } = await auth.api.createBlocklistRule({
      body: { target: "email", type: "domain", value: "@Spam.IO" },
      headers,
    });
    expect(rule.value).toBe("spam.io");
    await expectBlocked(
      auth.api.createBlocklistRule({
        body: { target: "email", type: "domain", value: "spam.io" },
        headers,
      }),
      "RULE_ALREADY_EXISTS",
    );
  });

  it("rejects rule values that are too long", async () => {
    const { auth, createUser } = await setup();
    const { headers } = await createUser("root@example.org", "admin");
    await expect(
      auth.api.createBlocklistRule({
        body: { target: "username", type: "contains", value: "x".repeat(256) },
        headers,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    // NFKC can make a value longer: "㎦" (1 character) becomes "km3".
    await expectBlocked(
      auth.api.createBlocklistRule({
        body: { target: "username", type: "contains", value: "\u33A6".repeat(100) },
        headers,
      }),
      "RULE_VALUE_TOO_LONG",
    );
  });
});

describe("updates", () => {
  it("does not lock existing users out when their unchanged email is written back", async () => {
    const { auth, createUser } = await setup({ databaseCacheTtl: 0 });
    const { user } = await createUser("jane@acme.example");
    const ctx = await auth.$context;
    await ctx.adapter.create({
      model: "blocklistRule",
      data: { target: "email", type: "domain", value: "acme.example", createdAt: new Date() },
    });

    // What an OAuth sign-in with overrideUserInfoOnSignIn does.
    await expect(
      ctx.internalAdapter.updateUser(user.id, { email: "jane@acme.example", name: "Jane" }),
    ).resolves.toBeTruthy();
    // A real change to a blocked address is still rejected.
    await expectBlocked(
      ctx.internalAdapter.updateUser(user.id, { email: "other@acme.example" }),
      "EMAIL_NOT_ALLOWED",
    );
  });
});

describe("database rule cache", () => {
  it("caches database rules for databaseCacheTtl, and endpoint changes apply at once", async () => {
    const { auth, signUp } = await setup({ databaseCacheTtl: 60_000 });
    const ctx = await auth.$context;
    await expect(signUp("a@cached.example")).resolves.toBeTruthy(); // warms the cache
    await ctx.adapter.create({
      model: "blocklistRule",
      data: { target: "email", type: "domain", value: "cached.example", createdAt: new Date() },
    });
    // Written behind the plugin's back (like another server): not seen yet.
    await expect(signUp("b@cached.example")).resolves.toBeTruthy();

    const fresh = await setup({ databaseCacheTtl: 0 });
    const freshCtx = await fresh.auth.$context;
    await freshCtx.adapter.create({
      model: "blocklistRule",
      data: { target: "email", type: "domain", value: "cached.example", createdAt: new Date() },
    });
    await expectBlocked(fresh.signUp("c@cached.example"), "EMAIL_NOT_ALLOWED");
  });
});

describe("many stored rules", () => {
  it("checks every stored rule, not only the first 100", async () => {
    const { auth } = await getTestInstance(
      { emailAndPassword: { enabled: true }, plugins: [blocklist()] },
      { disableTestUser: true },
    );
    const context = await auth.$context;
    const start = Date.now();
    for (let i = 0; i < 150; i++) {
      await context.adapter.create({
        model: "blocklistRule",
        data: {
          target: "email",
          type: "domain",
          value: `blocked-${i}.example`,
          createdAt: new Date(start + i),
        },
      });
    }
    await expectBlocked(
      auth.api.signUpEmail({
        body: { email: "eve@blocked-149.example", password: "password1234", name: "Eve" },
      }),
      "EMAIL_NOT_ALLOWED",
    );
  });
});
