import { resetTestDatabase, testDatabase } from "@repo/tooling/test-helpers";
import type { BetterAuthOptions } from "better-auth";
import { admin, magicLink, testUtils, twoFactor, username } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import { auditLogClient } from "../src/client";
import type { AuditEvent, AuditLogOptions } from "../src/index";
import { auditLog, memoryStorage } from "../src/index";

const PASSWORD = "password1234";

/**
 * A fresh auth instance with the audit log (last, as documented), the
 * admin plugin, magic links (a sign-in path other than email),
 * two-factor, and usernames. Events go to the database unless `storage` is passed.
 */
async function setup(options: AuditLogOptions = {}, config: Partial<BetterAuthOptions> = {}) {
  const magicLinks: { email: string; token: string }[] = [];
  const otps: string[] = [];
  const resetTokens: { email: string; token: string }[] = [];
  const { auth, client, signInWithUser } = await getTestInstance(
    {
      ...config,
      emailAndPassword: {
        enabled: true,
        sendResetPassword: async ({ user, token }) => {
          resetTokens.push({ email: user.email, token });
        },
      },
      plugins: [
        admin(),
        magicLink({
          sendMagicLink: ({ email, token }) => {
            magicLinks.push({ email, token });
          },
        }),
        twoFactor({
          skipVerificationOnEnable: true,
          otpOptions: {
            sendOTP: ({ otp }) => {
              otps.push(otp);
            },
          },
        }),
        username(),
        testUtils(),
        ...(config.plugins ?? []),
        auditLog(options),
      ],
    },
    { ...testDatabase(), disableTestUser: true, clientOptions: { plugins: [auditLogClient()] } },
  );
  const context = await auth.$context;
  await resetTestDatabase(context);
  const { test } = context;

  /** A user signed up with a password, plus their session headers. */
  const signUp = async (email: string, extra: Record<string, unknown> = {}) => {
    const result = await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: email.split("@")[0] ?? "user", ...extra },
      returnHeaders: true,
    });
    const headers = new Headers({ cookie: cookiesFrom(result.headers) });
    return { user: result.response.user, headers };
  };
  /** A saved user (no events from sign-up paths), with session headers. */
  const createUser = async (email: string, role?: string) => {
    const user = await test.saveUser(test.createUser({ email, ...(role ? { role } : {}) }));
    return { user, headers: await test.getAuthHeaders({ userId: user.id }) };
  };
  /** Stored events, oldest first. */
  const events = async (filter: Partial<AuditEvent> = {}) => {
    const rows = await context.adapter.findMany<AuditEvent & { metadata: string | null }>({
      model: "auditEvent",
      sortBy: { field: "createdAt", direction: "asc" },
    });
    return rows
      .map((row) => ({ ...row, metadata: row.metadata ? JSON.parse(row.metadata) : null }))
      .filter((row) =>
        Object.entries(filter).every(([key, value]) => row[key as keyof AuditEvent] === value),
      );
  };

  return {
    auth,
    client,
    context,
    test,
    magicLinks,
    otps,
    resetTokens,
    signUp,
    createUser,
    events,
    signInWithUser,
  };
}

/** A `cookie` header with the cookies a response set (the last value of each wins). */
function cookiesFrom(headers: Headers): string {
  const cookies = new Map<string, string>();
  for (const cookie of headers.getSetCookie()) {
    const [pair = ""] = cookie.split(";");
    const name = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(pair.indexOf("=") + 1);
    if (value) cookies.set(name, value);
    else cookies.delete(name);
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function expectError(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toMatchObject({ statusCode: status, body: { code } });
}

describe("sign-up and sign-in", () => {
  it("records a sign-up and the sign-in that comes with it", async () => {
    const { signUp, events } = await setup();
    const { user } = await signUp("ada@example.com");

    const [signUpEvent, signInEvent] = await events();
    expect(signUpEvent).toMatchObject({
      type: "sign-up",
      status: "success",
      severity: "low",
      userId: user.id,
      actorUserId: user.id,
      metadata: { method: "email" },
    });
    expect(signInEvent).toMatchObject({
      type: "sign-in",
      userId: user.id,
      metadata: { method: "email" },
    });
    expect(signInEvent?.sessionId).toBeTruthy();
  });

  it("records a sign-in with a password", async () => {
    const { auth, signUp, events } = await setup();
    const { user } = await signUp("ada@example.com");
    await auth.api.signInEmail({ body: { email: "ada@example.com", password: PASSWORD } });

    const signIns = await events({ type: "sign-in" });
    expect(signIns).toHaveLength(2);
    expect(signIns[1]).toMatchObject({ userId: user.id, status: "success" });
  });

  it("records a sign-in through a path other than email (magic link)", async () => {
    const { auth, createUser, magicLinks, events } = await setup();
    const { user } = await createUser("ada@example.com");
    await auth.api.signInMagicLink({
      body: { email: "ada@example.com" },
      headers: new Headers(),
    });
    const token = magicLinks[0]?.token as string;
    await auth.api.magicLinkVerify({ query: { token }, headers: new Headers() });

    expect(await events({ type: "sign-in" })).toEqual([
      expect.objectContaining({ userId: user.id, metadata: { method: "magic-link" } }),
    ]);
  });

  it("records a failed sign-in with the error code, never the password", async () => {
    const { auth, signUp, events } = await setup();
    const { user } = await signUp("ada@example.com");
    await expectError(
      auth.api.signInEmail({ body: { email: "ADA@example.com", password: "wrong-password" } }),
      401,
      "INVALID_EMAIL_OR_PASSWORD",
    );

    const [failed] = await events({ type: "sign-in", status: "failure" });
    expect(failed).toMatchObject({
      severity: "medium",
      userId: user.id,
      actorUserId: null,
      errorCode: "INVALID_EMAIL_OR_PASSWORD",
      metadata: { method: "email", identifier: "ada@example.com" },
    });
    expect(JSON.stringify(failed)).not.toContain("wrong-password");
  });

  it("never stores a password typed into the email or username field", async () => {
    const { auth, events } = await setup();
    await auth.api
      .signInEmail({ body: { email: "hunter2-secret", password: PASSWORD } })
      .catch(() => {});
    await auth.api
      .signInUsername({ body: { username: "hunter2-secret", password: PASSWORD } })
      .catch(() => {});

    const failures = await events({ type: "sign-in", status: "failure" });
    expect(failures).toHaveLength(2);
    expect(JSON.stringify(failures)).not.toContain("hunter2");
  });

  it("keeps the username of an existing user on a failed sign-in", async () => {
    const { auth, signUp, events } = await setup();
    const { user } = await signUp("ada@example.com", { username: "Ada_L" });
    await auth.api
      .signInUsername({ body: { username: "ada_l", password: "wrong-password" } })
      .catch(() => {});
    expect(await events({ type: "sign-in", status: "failure" })).toEqual([
      expect.objectContaining({
        userId: user.id,
        metadata: { method: "username", identifier: "ada_l" },
      }),
    ]);
  });

  it("records a failed sign-in for an unknown email without a user", async () => {
    const { auth, events } = await setup();
    await expect(
      auth.api.signInEmail({ body: { email: "nobody@example.com", password: PASSWORD } }),
    ).rejects.toThrow();
    expect(await events({ type: "sign-in" })).toEqual([
      expect.objectContaining({ status: "failure", userId: null }),
    ]);
  });

  it("records a two-factor sign-in once, when the second factor is verified", async () => {
    const { auth, signUp, otps, events } = await setup();
    const { user, headers } = await signUp("ada@example.com");
    // Enabling rotates the session: not a sign-in.
    await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers });
    expect(await events({ type: "sign-in" })).toHaveLength(1); // the sign-up's

    const result = await auth.api.signInEmail({
      body: { email: "ada@example.com", password: PASSWORD },
      returnHeaders: true,
    });
    expect(result.response).toMatchObject({ twoFactorRedirect: true });
    expect(await events({ type: "sign-in" })).toHaveLength(1);

    const pending = new Headers({ cookie: cookiesFrom(result.headers) });
    await auth.api.sendTwoFactorOTP({ body: {}, headers: pending });
    await auth.api.verifyTwoFactorOTP({ body: { code: otps[0] as string }, headers: pending });
    expect((await events({ type: "sign-in" })).at(-1)).toMatchObject({
      userId: user.id,
      metadata: { method: "two-factor" },
    });
    expect(await events({ type: "sign-in" })).toHaveLength(2);
  });

  it("doesn't record a sign-in when an admin impersonates a user", async () => {
    const { auth, createUser, events } = await setup();
    const { headers } = await createUser("root@example.com", "admin");
    const { user } = await createUser("ada@example.com");
    await auth.api.impersonateUser({ body: { userId: user.id }, headers });

    expect(await events({ type: "sign-in" })).toEqual([]);
    expect(await events({ type: "admin.impersonate-user" })).toHaveLength(1);
  });
});

describe("sessions", () => {
  it("records a sign-out with the session that ended", async () => {
    const { auth, signUp, events } = await setup();
    const { user, headers } = await signUp("ada@example.com");
    const [signIn] = await events({ type: "sign-in" });
    await auth.api.signOut({ headers });

    expect(await events({ type: "sign-out" })).toEqual([
      expect.objectContaining({
        userId: user.id,
        actorUserId: user.id,
        sessionId: signIn?.sessionId,
      }),
    ]);
  });

  it("doesn't record a sign-out without a session", async () => {
    const { auth, events } = await setup();
    await auth.api.signOut({ headers: new Headers() }).catch(() => {});
    expect(await events({ type: "sign-out" })).toEqual([]);
  });

  it("records revoked sessions with their scope", async () => {
    const { auth, signUp, events } = await setup();
    const { user, headers } = await signUp("ada@example.com");
    await auth.api.revokeOtherSessions({ headers });
    await auth.api.revokeSessions({ headers });

    expect((await events({ type: "session-revoked" })).map((event) => event.metadata)).toEqual([
      { scope: "others" },
      { scope: "all" },
    ]);
    expect(await events({ type: "session-revoked", userId: user.id })).toHaveLength(2);
  });
});

describe("account changes", () => {
  it("records a password change", async () => {
    const { auth, signUp, events } = await setup();
    const { user, headers } = await signUp("ada@example.com");
    await auth.api.changePassword({
      body: {
        currentPassword: PASSWORD,
        newPassword: "new-password1234",
        revokeOtherSessions: true,
      },
      headers,
    });

    expect(await events({ type: "password-changed" })).toEqual([
      expect.objectContaining({ userId: user.id, metadata: { revokeOtherSessions: true } }),
    ]);
    // The rotated session isn't a sign-in.
    expect(await events({ type: "sign-in" })).toHaveLength(1);
  });

  it("records a failed password change", async () => {
    const { auth, signUp, events } = await setup();
    const { headers } = await signUp("ada@example.com");
    await expect(
      auth.api.changePassword({
        body: { currentPassword: "wrong-password", newPassword: "new-password1234" },
        headers,
      }),
    ).rejects.toThrow();
    expect(await events({ type: "password-changed" })).toEqual([
      expect.objectContaining({ status: "failure", errorCode: "INVALID_PASSWORD" }),
    ]);
  });

  it("records a password reset for the token's user", async () => {
    const { auth, signUp, resetTokens, events } = await setup();
    const { user } = await signUp("ada@example.com");
    await auth.api.requestPasswordReset({ body: { email: "ada@example.com" } });
    const token = resetTokens[0]?.token as string;
    await auth.api.resetPassword({ body: { token, newPassword: "new-password1234" } });

    expect(await events({ type: "password-reset" })).toEqual([
      expect.objectContaining({ userId: user.id, actorUserId: user.id, status: "success" }),
    ]);
  });

  it("records an email change, but not an unchanged email written back", async () => {
    const { auth, signUp, createUser, events } = await setup(
      {},
      { user: { changeEmail: { enabled: true, updateEmailWithoutVerification: true } } },
    );
    const { user, headers } = await signUp("ada@example.com");
    await auth.api.changeEmail({ body: { newEmail: "ada@new.example.com" }, headers });
    // An update that writes the same email back, inside a request.
    const { headers: adminHeaders } = await createUser("root@example.com", "admin");
    await auth.api.adminUpdateUser({
      body: { userId: user.id, data: { email: "ada@new.example.com", name: "Ada" } },
      headers: adminHeaders,
    });

    expect(await events({ type: "email-changed" })).toEqual([
      expect.objectContaining({ userId: user.id, metadata: { email: "ada@new.example.com" } }),
    ]);
  });

  it("records a verified email", async () => {
    const sent: string[] = [];
    const { auth, signUp, events } = await setup(
      {},
      {
        emailVerification: {
          sendOnSignUp: true,
          sendVerificationEmail: async ({ token }) => {
            sent.push(token);
          },
        },
      },
    );
    const { user } = await signUp("ada@example.com");
    await auth.api.verifyEmail({ query: { token: sent[0] as string } });

    expect(await events({ type: "email-verified" })).toEqual([
      expect.objectContaining({ userId: user.id }),
    ]);
  });

  it("records a linked account, but not the account created at sign-up", async () => {
    const { signUp, context, events } = await setup();
    const { user } = await signUp("ada@example.com");
    expect(await events({ type: "account-linked" })).toEqual([]);

    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "github",
      accountId: "gh-1",
    });
    expect(await events({ type: "account-linked" })).toEqual([
      expect.objectContaining({ userId: user.id, metadata: { providerId: "github" } }),
    ]);
  });

  it("records a deleted user, and keeps their events", async () => {
    const { auth, signUp, events } = await setup({}, { user: { deleteUser: { enabled: true } } });
    const { user, headers } = await signUp("ada@example.com");
    await auth.api.deleteUser({ body: { password: PASSWORD }, headers });

    expect(await events({ type: "user-deleted" })).toEqual([
      expect.objectContaining({ userId: user.id, actorUserId: user.id, severity: "high" }),
    ]);
    expect(await events({ type: "sign-up", userId: user.id })).toHaveLength(1);
  });
});

describe("admin actions", () => {
  it("records the admin as actor and the target as user", async () => {
    const { auth, createUser, events } = await setup();
    const { user: root, headers } = await createUser("root@example.com", "admin");
    const { user } = await createUser("ada@example.com");
    await auth.api.setRole({ body: { userId: user.id, role: "admin" }, headers });
    await auth.api.banUser({ body: { userId: user.id, banReason: "spam" }, headers });
    await auth.api.unbanUser({ body: { userId: user.id }, headers });

    const adminEvents = (await events()).filter((event) => event.type.startsWith("admin."));
    expect(adminEvents.map((event) => [event.type, event.severity, event.metadata])).toEqual([
      ["admin.set-role", "critical", { role: "admin" }],
      ["admin.ban-user", "high", { reason: "spam", expiresIn: null }],
      ["admin.unban-user", "high", null],
    ]);
    for (const event of adminEvents) {
      expect(event).toMatchObject({ actorUserId: root.id, userId: user.id });
    }
  });

  it("records a user an admin creates and removes", async () => {
    const { auth, createUser, events } = await setup();
    const { user: root, headers } = await createUser("root@example.com", "admin");
    const { user } = await auth.api.createUser({
      body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
      headers,
    });
    await auth.api.removeUser({ body: { userId: user.id }, headers });

    expect(await events({ type: "sign-up", userId: user.id })).toEqual([
      expect.objectContaining({ actorUserId: root.id, metadata: { method: "admin" } }),
    ]);
    expect(await events({ type: "admin.create-user" })).toEqual([
      expect.objectContaining({ userId: user.id, actorUserId: root.id }),
    ]);
    expect(await events({ type: "user-deleted" })).toEqual([
      expect.objectContaining({ userId: user.id, actorUserId: root.id }),
    ]);
    // No account-linked for the new user's password.
    expect(await events({ type: "account-linked" })).toEqual([]);
  });

  it("records a session an admin revokes, for its user", async () => {
    const { auth, createUser, signUp, events } = await setup();
    const { headers } = await createUser("root@example.com", "admin");
    const { user } = await signUp("ada@example.com");
    const { sessions } = await auth.api.listUserSessions({ body: { userId: user.id }, headers });
    await auth.api.revokeUserSession({
      body: { sessionToken: sessions[0]?.token as string },
      headers,
    });
    expect(await events({ type: "admin.revoke-user-session" })).toEqual([
      expect.objectContaining({ userId: user.id }),
    ]);
  });

  it("records stopping an impersonation with the admin as actor", async () => {
    const { auth, createUser, events } = await setup();
    const { user: root, headers } = await createUser("root@example.com", "admin");
    const { user } = await createUser("ada@example.com");
    const result = await auth.api.impersonateUser({
      body: { userId: user.id },
      headers,
      returnHeaders: true,
    });
    const impersonated = new Headers({ cookie: cookiesFrom(result.headers) });
    await auth.api.stopImpersonating({ headers: impersonated });

    expect(await events({ type: "admin.stop-impersonating" })).toEqual([
      expect.objectContaining({ userId: user.id, actorUserId: root.id }),
    ]);
  });

  it("records a refused admin action as a failure", async () => {
    const { auth, createUser, events } = await setup();
    const { user: mallory, headers } = await createUser("mallory@example.com");
    const { user } = await createUser("ada@example.com");
    await expect(
      auth.api.setRole({ body: { userId: user.id, role: "admin" }, headers }),
    ).rejects.toThrow();

    expect(await events({ type: "admin.set-role" })).toEqual([
      expect.objectContaining({
        status: "failure",
        actorUserId: mallory.id,
        userId: user.id,
        errorCode: "YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE",
      }),
    ]);
  });
});

describe("request details", () => {
  it("stores the IP address from the configured header and the user agent", async () => {
    const { auth, signUp, events } = await setup(
      {},
      { advanced: { ipAddress: { ipAddressHeaders: ["x-client-ip"] } } },
    );
    await signUp("ada@example.com");
    await auth.api.signInEmail({
      body: { email: "ada@example.com", password: PASSWORD },
      headers: new Headers({ "x-client-ip": "203.0.113.7", "user-agent": "Test/1.0" }),
    });
    const signIns = await events({ type: "sign-in" });
    expect(signIns.at(-1)).toMatchObject({ ipAddress: "203.0.113.7", userAgent: "Test/1.0" });
  });

  it("stores neither when capture is off", async () => {
    const { auth, signUp, events } = await setup({ captureIp: false, captureUserAgent: false });
    await signUp("ada@example.com");
    await auth.api.signInEmail({
      body: { email: "ada@example.com", password: PASSWORD },
      headers: new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "Test/1.0" }),
    });
    expect((await events({ type: "sign-in" })).at(-1)).toMatchObject({
      ipAddress: null,
      userAgent: null,
    });
  });
});

describe("options", () => {
  it("records only the listed events and groups", async () => {
    const { auth, createUser, signUp, events } = await setup({ events: ["sign-up", "admin.*"] });
    const { headers } = await createUser("root@example.com", "admin");
    const { user } = await signUp("ada@example.com");
    await auth.api.banUser({ body: { userId: user.id }, headers });
    expect((await events()).map((event) => event.type)).toEqual([
      "sign-up", // root, saved by the test
      "sign-up",
      "admin.ban-user",
    ]);
  });

  it("records extra paths", async () => {
    const { auth, signUp, events } = await setup({ paths: { "/update-user": "profile.updated" } });
    const { user, headers } = await signUp("ada@example.com");
    await auth.api.updateUser({ body: { name: "Ada L." }, headers });
    expect(await events({ type: "profile.updated" })).toEqual([
      expect.objectContaining({ userId: user.id, actorUserId: user.id, severity: "low" }),
    ]);
  });

  it("applies severity overrides", async () => {
    const { signUp, events } = await setup({ severity: { "sign-up": "high" } });
    await signUp("ada@example.com");
    expect((await events({ type: "sign-up" }))[0]?.severity).toBe("high");
  });

  it("lets beforeLog change or drop events", async () => {
    const { signUp, events } = await setup({
      beforeLog: (event) => (event.type === "sign-in" ? null : { ...event, ipAddress: "0.0.0.0" }),
    });
    await signUp("ada@example.com");
    expect(await events()).toEqual([
      expect.objectContaining({ type: "sign-up", ipAddress: "0.0.0.0" }),
    ]);
  });

  it("drops the event when beforeLog throws, without failing the request", async () => {
    const { signUp, events, context } = await setup({
      beforeLog: () => {
        throw new Error("boom");
      },
    });
    const error = vi.spyOn(context.logger, "error").mockImplementation(() => {});
    await expect(signUp("ada@example.com")).resolves.toBeTruthy();
    expect(await events()).toEqual([]);
    expect(error).toHaveBeenCalled();
  });

  it("calls onEvent with stored events; its errors are logged", async () => {
    const seen: AuditEvent[] = [];
    const { signUp, context } = await setup({
      onEvent: (event) => {
        seen.push(event);
        throw new Error("SIEM down");
      },
    });
    const error = vi.spyOn(context.logger, "error").mockImplementation(() => {});
    await signUp("ada@example.com");
    expect(seen.map((event) => event.type)).toEqual(["sign-up", "sign-in"]);
    expect(seen[0]?.id).toBeTruthy();
    expect(error).toHaveBeenCalledWith("[audit-log] onEvent threw an error", expect.any(Error));
  });

  it("keeps auth working when storage fails", async () => {
    const storage = memoryStorage();
    storage.write = async () => {
      throw new Error("database down");
    };
    const { signUp, context } = await setup({ storage });
    const error = vi.spyOn(context.logger, "error").mockImplementation(() => {});
    await expect(signUp("ada@example.com")).resolves.toBeTruthy();
    expect(error).toHaveBeenCalled();
  });

  it("stores events in custom storage, without a table", async () => {
    const storage = memoryStorage();
    const { signUp, context } = await setup({ storage });
    await signUp("ada@example.com");
    expect(storage.events.map((event) => event.type)).toEqual(["sign-up", "sign-in"]);
    await expect(context.adapter.findMany({ model: "auditEvent" })).rejects.toThrow();
  });

  it("warns when two-factor comes after it, which would record unfinished sign-ins", async () => {
    const warn = vi.fn();
    const { auth } = await getTestInstance(
      {
        logger: { level: "warn", log: (level, message) => level === "warn" && warn(message) },
        plugins: [auditLog(), twoFactor()],
      },
      { disableTestUser: true },
    );
    await auth.$context;
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("after two-factor"));
  });
});

describe("custom events", () => {
  it("records events from the server, with redacted secrets", async () => {
    const { auth, createUser, events } = await setup();
    const { user } = await createUser("ada@example.com");
    const { event } = await auth.api.recordAuditEvent({
      body: {
        type: "billing.plan-changed",
        userId: user.id,
        severity: "medium",
        metadata: { plan: "pro", apiKey: "sk_live_1", nested: { password: "x" } },
      },
    });
    expect(event).toMatchObject({ type: "billing.plan-changed", severity: "medium" });
    expect((await events({ type: "billing.plan-changed" }))[0]?.metadata).toEqual({
      plan: "pro",
      apiKey: "[redacted]",
      nested: { password: "[redacted]" },
    });
  });

  it("rejects invalid types and oversized metadata", async () => {
    const { auth } = await setup();
    await expect(auth.api.recordAuditEvent({ body: { type: "has space" } })).rejects.toThrow();
    await expectError(
      auth.api.recordAuditEvent({ body: { type: "big", metadata: { blob: "x".repeat(5000) } } }),
      400,
      "METADATA_TOO_LARGE",
    );
  });

  it("is not reachable over HTTP", async () => {
    const { client } = await setup();
    const result = await client.$fetch("/audit-log/record-event", {
      method: "POST",
      body: { type: "forged" },
    });
    expect(result.error?.status).toBe(404);
  });
});

describe("list-events", () => {
  it("lists a user's own events, newest first, through the client", async () => {
    const { client, signUp } = await setup();
    const { user, headers } = await signUp("ada@example.com");
    await signUp("bob@example.com");

    const { data } = await client.auditLog.listEvents({ fetchOptions: { headers } });
    expect(data?.total).toBe(2);
    expect(data?.events.map((event) => event.type)).toEqual(["sign-in", "sign-up"]);
    expect(data?.events.every((event) => event.userId === user.id)).toBe(true);
  });

  it("filters by type, status, and time, and paginates", async () => {
    const { auth, signUp } = await setup();
    const { headers } = await signUp("ada@example.com");
    await auth.api
      .signInEmail({ body: { email: "ada@example.com", password: "wrong-password" } })
      .catch(() => {});

    const failures = await auth.api.listAuditEvents({
      query: { type: "sign-in", status: "failure", limit: 20, offset: 0 },
      headers,
    });
    expect(failures.events).toHaveLength(1);
    const page = await auth.api.listAuditEvents({ query: { limit: 1, offset: 1 }, headers });
    expect(page).toMatchObject({ total: 3, events: [{ type: "sign-in", status: "success" }] });
    const future = await auth.api.listAuditEvents({
      query: { from: new Date(Date.now() + 60_000), limit: 20, offset: 0 },
      headers,
    });
    expect(future.total).toBe(0);
  });

  it("forbids other users' events to non-admins", async () => {
    const { auth, signUp } = await setup();
    const { headers } = await signUp("ada@example.com");
    const { user: bob } = await signUp("bob@example.com");
    await expectError(
      auth.api.listAuditEvents({ query: { userId: bob.id, limit: 20, offset: 0 }, headers }),
      403,
      "YOU_ARE_NOT_ALLOWED_TO_LIST_OTHER_USERS_EVENTS",
    );
  });

  it("lets admins list everyone's events", async () => {
    const { auth, createUser, signUp } = await setup({ adminUserIds: [] });
    const { headers } = await createUser("root@example.com", "admin");
    const { user } = await signUp("ada@example.com");
    await signUp("bob@example.com");

    const all = await auth.api.listAuditEvents({ query: { limit: 20, offset: 0 }, headers });
    expect(all.total).toBe(5); // root's sign-up, and two each for Ada and Bob
    const ada = await auth.api.listAuditEvents({
      query: { userId: user.id, limit: 20, offset: 0 },
      headers,
    });
    expect(ada.total).toBe(2);
  });

  it("hides who else acted on a user's account from them, but not from admins", async () => {
    const { auth, test, createUser, events } = await setup();
    const { headers: adminHeaders } = await createUser("root@example.com", "admin");
    const { user } = await createUser("ada@example.com");
    await auth.api.banUser({
      body: { userId: user.id },
      headers: new Headers({
        cookie: adminHeaders.get("cookie") ?? "",
        "x-forwarded-for": "198.51.100.9",
        "user-agent": "AdminBrowser/1.0",
      }),
    });
    await auth.api.unbanUser({ body: { userId: user.id }, headers: adminHeaders });
    // The ban revoked Ada's sessions: sign her in again.
    const headers = await test.getAuthHeaders({ userId: user.id });
    expect((await events({ type: "admin.ban-user" }))[0]?.ipAddress).toBe("198.51.100.9");

    const own = await auth.api.listAuditEvents({ query: { type: "admin.ban-user" }, headers });
    expect(own.events[0]).toMatchObject({ ipAddress: null, userAgent: null, sessionId: null });
    const asAdmin = await auth.api.listAuditEvents({
      query: { type: "admin.ban-user" },
      headers: adminHeaders,
    });
    expect(asAdmin.events[0]).toMatchObject({
      ipAddress: "198.51.100.9",
      userAgent: "AdminBrowser/1.0",
    });
  });

  it("requires a session", async () => {
    const { client } = await setup();
    const { error } = await client.auditLog.listEvents();
    expect(error?.status).toBe(401);
  });
});

describe("retention", () => {
  it("deletes expired events from the server-only endpoint", async () => {
    const storage = memoryStorage();
    const { auth, signUp } = await setup({ storage });
    await signUp("ada@example.com");
    for (const event of storage.events) event.createdAt = new Date(Date.now() - 40 * 86_400_000);
    await auth.api.recordAuditEvent({ body: { type: "fresh" } });

    expect(await auth.api.deleteExpiredAuditEvents({ body: { days: 30 } })).toEqual({ deleted: 2 });
    expect(storage.events.map((event) => event.type)).toEqual(["fresh"]);
    await expectError(
      auth.api.deleteExpiredAuditEvents({ body: {} }),
      400,
      "RETENTION_NOT_CONFIGURED",
    );
  });

  it("sweeps in the background, at most once per interval", async () => {
    const storage = memoryStorage();
    const sweep = vi.spyOn(storage, "deleteOlderThan");
    const { auth } = await setup({ storage, retention: { days: 30 } });
    await auth.api.recordAuditEvent({ body: { type: "one" } });
    await auth.api.recordAuditEvent({ body: { type: "two" } });
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(1));
    const cutoff = sweep.mock.calls[0]?.[0] as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(30 * 86_400_000 - 1000);
  });

  it("never fails the request when the sweep fails", async () => {
    const storage = memoryStorage();
    storage.deleteOlderThan = async () => {
      throw new Error("database down");
    };
    const { auth, context } = await setup({ storage, retention: { days: 1 } });
    const error = vi.spyOn(context.logger, "error").mockImplementation(() => {});
    await expect(auth.api.recordAuditEvent({ body: { type: "one" } })).resolves.toBeTruthy();
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith("[audit-log] retention sweep failed", expect.any(Error)),
    );
  });
});
