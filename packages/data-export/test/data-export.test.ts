import type { BetterAuthOptions, BetterAuthPlugin } from "@better-auth/core";
import type { AuditEvent } from "@checodo/better-auth-audit-log";
import { auditLog, memoryStorage } from "@checodo/better-auth-audit-log";
import { waitlist } from "@checodo/better-auth-waitlist";
import { resetTestDatabase, testDatabase } from "@repo/tooling/test-helpers";
import { admin, testUtils } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import type { DataExport, DataExportOptions } from "../src/index";
import { dataExport, isSecretField } from "../src/index";

const PASSWORD = "password1234";

/**
 * An app model in better-auth's schema: notes that reference the user,
 * and comments that reference a note (two steps away from the user).
 */
const notes = {
  id: "notes",
  schema: {
    note: {
      fields: {
        userId: { type: "string", required: true, references: { model: "user", field: "id" } },
        text: { type: "string", required: true },
        shareToken: { type: "string", required: false },
      },
    },
    noteComment: {
      fields: {
        noteId: { type: "string", required: true, references: { model: "note", field: "id" } },
        text: { type: "string", required: true },
      },
    },
  },
} satisfies BetterAuthPlugin;

async function setup(
  options: DataExportOptions = {},
  extraPlugins: BetterAuthPlugin[] = [],
  config: Partial<BetterAuthOptions> = {},
) {
  const { auth } = await getTestInstance(
    {
      ...config,
      emailAndPassword: { enabled: true },
      plugins: [admin(), testUtils(), notes, ...extraPlugins, dataExport(options)],
    },
    { ...testDatabase(), disableTestUser: true },
  );
  const context = await auth.$context;
  await resetTestDatabase(context);
  const { adapter, test } = context;

  /** Signs up with a password (a credential account and a session). */
  const signUp = async (email: string) => {
    const { user } = await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: email.split("@")[0] ?? "user" },
    });
    return { user, headers: await test.getAuthHeaders({ userId: user.id }) };
  };
  const addNote = async (userId: string, text: string) => {
    const note = await adapter.create<Record<string, unknown>, { id: string }>({
      model: "note",
      data: { userId, text, shareToken: `share-${text}` },
    });
    await adapter.create({ model: "noteComment", data: { noteId: note.id, text: `on ${text}` } });
    return note;
  };
  const download = (headers: Headers) =>
    auth.api.downloadDataExport({ headers }) as Promise<DataExport>;
  return { auth, context, adapter, test, signUp, addNote, download };
}

describe("the user's own export", () => {
  it("has the user, their accounts and sessions, without secrets", async () => {
    const { signUp, download } = await setup();
    const { user, headers } = await signUp("ada@example.com");
    const data = await download(headers);

    expect(data.user).toMatchObject({ id: user.id, email: "ada@example.com", name: "ada" });
    expect(data.data.account).toEqual([
      expect.objectContaining({ userId: user.id, providerId: "credential" }),
    ]);
    expect(data.data.account?.[0]).not.toHaveProperty("password");
    expect(data.data.session?.length).toBeGreaterThan(0);
    for (const session of data.data.session ?? []) expect(session).not.toHaveProperty("token");
    expect(data.omitted).toMatchObject({
      account: expect.arrayContaining(["password"]),
      session: ["token"],
      verification: ["*"],
    });
    expect(Date.parse(data.exportedAt)).not.toBeNaN();
  });

  it("finds the app's models through the schema, two steps away, and not other users' rows", async () => {
    const { signUp, addNote, download } = await setup();
    const ada = await signUp("ada@example.com");
    const bob = await signUp("bob@example.com");
    await addNote(ada.user.id, "first");
    await addNote(ada.user.id, "second");
    await addNote(bob.user.id, "bob's");

    const data = await download(ada.headers);
    expect(data.data.note?.map((note) => note.text).sort()).toEqual(["first", "second"]);
    expect(data.data.noteComment?.map((comment) => comment.text).sort()).toEqual([
      "on first",
      "on second",
    ]);
    expect(data.omitted.note).toEqual(["shareToken"]);
    expect(JSON.stringify(data)).not.toContain("bob");
  });

  it("is a download that isn't cached, over HTTP", async () => {
    const { auth, signUp } = await setup();
    const { headers } = await signUp("ada@example.com");
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/data-export/download", { headers }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="data-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(((await response.json()) as DataExport).user.email).toBe("ada@example.com");
  });

  it("needs a session, and a fresh one", async () => {
    const { auth, adapter, signUp, download } = await setup();
    await expect(download(new Headers())).rejects.toMatchObject({ statusCode: 401 });

    const { user, headers } = await signUp("ada@example.com");
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await adapter.updateMany({
      model: "session",
      where: [{ field: "userId", value: user.id }],
      update: { createdAt: old },
    });
    await expect(auth.api.downloadDataExport({ headers })).rejects.toMatchObject({
      statusCode: 403,
      body: { code: "SESSION_NOT_FRESH" },
    });
  });
});

describe("requests the download refuses", () => {
  it("refuses a download started from another site", async () => {
    const storage = memoryStorage();
    const { auth, signUp } = await setup({}, [auditLog({ storage })]);
    const { headers } = await signUp("ada@example.com");
    const request = (site: string) =>
      auth.handler(
        new Request("http://localhost:3000/api/auth/data-export/download", {
          headers: { cookie: headers.get("cookie") ?? "", "sec-fetch-site": site },
        }),
      );
    const cross = await request("cross-site");
    expect(cross.status).toBe(403);
    expect(await cross.json()).toMatchObject({ code: "CROSS_SITE_REQUEST" });
    expect((await storage.read({ type: "data-export.completed", limit: 5, offset: 0 })).total).toBe(
      0,
    );
    expect((await request("same-origin")).status).toBe(200);
    expect((await request("none")).status).toBe(200);
  });

  it("uses freshAge instead of better-auth's session.freshAge", async () => {
    const { auth, adapter, signUp } = await setup({ freshAge: 60 });
    const { user, headers } = await signUp("ada@example.com");
    await auth.api.downloadDataExport({ headers });
    await adapter.updateMany({
      model: "session",
      where: [{ field: "userId", value: user.id }],
      update: { createdAt: new Date(Date.now() - 2 * 60 * 1000) },
    });
    await expect(auth.api.downloadDataExport({ headers })).rejects.toMatchObject({
      statusCode: 403,
      body: { code: "SESSION_NOT_FRESH" },
    });

    const off = await setup({ freshAge: 0 });
    const ada = await off.signUp("ada@example.com");
    await off.adapter.updateMany({
      model: "session",
      where: [{ field: "userId", value: ada.user.id }],
      update: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });
    await expect(off.auth.api.downloadDataExport({ headers: ada.headers })).resolves.toBeTruthy();
  });

  it("is rate limited per IP address", async () => {
    const { auth, signUp } = await setup({ rateLimit: { window: 60, max: 2 } }, [], {
      rateLimit: { enabled: true },
    });
    const { headers } = await signUp("ada@example.com");
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await auth.handler(
        new Request("http://localhost:3000/api/auth/data-export/download", {
          headers: { cookie: headers.get("cookie") ?? "", "x-forwarded-for": "203.0.113.7" },
        }),
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });
});

describe("options", () => {
  it("leaves out more fields and whole models with omit", async () => {
    const { signUp, addNote, download } = await setup({
      omit: { user: ["image"], note: true },
    });
    const { user, headers } = await signUp("ada@example.com");
    await addNote(user.id, "private");
    const data = await download(headers);
    expect(data.user).not.toHaveProperty("image");
    expect(data.data).not.toHaveProperty("note");
    expect(data.omitted).toMatchObject({ user: ["image"], note: ["*"] });
  });

  it("adds the app's data from contributors", async () => {
    const orders = vi.fn(async (user: { id: string }) => [{ orderId: "o-1", userId: user.id }]);
    const { signUp, download } = await setup({ contributors: { orders } });
    const { user, headers } = await signUp("ada@example.com");
    const data = await download(headers);
    expect(data.app).toEqual({ orders: [{ orderId: "o-1", userId: user.id }] });
    expect(orders).toHaveBeenCalledWith({ id: user.id, email: "ada@example.com", name: "ada" });
  });

  it("refuses an export with more than maxRows rows", async () => {
    const storage = memoryStorage();
    const { signUp, addNote, download } = await setup({ maxRows: 6 }, [auditLog({ storage })]);
    const { user, headers } = await signUp("ada@example.com");
    await download(headers); // user, account, session, sign-up events: fits
    for (let i = 0; i < 3; i++) await addNote(user.id, `note ${i}`);
    await expect(download(headers)).rejects.toMatchObject({
      statusCode: 422,
      body: { code: "EXPORT_TOO_LARGE" },
    });
    const { events } = await storage.read({ type: "data-export.failed", limit: 10, offset: 0 });
    expect(events).toEqual([
      expect.objectContaining({
        userId: user.id,
        status: "failure",
        errorCode: "EXPORT_TOO_LARGE",
      }),
    ]);
  });

  it("calls onExport after an export; its errors are logged, not thrown", async () => {
    const onExport = vi.fn(async () => {
      throw new Error("mail server down");
    });
    const { signUp, download } = await setup({ onExport });
    const { user, headers } = await signUp("ada@example.com");
    await expect(download(headers)).resolves.toBeTruthy();
    expect(onExport).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { id: user.id, email: "ada@example.com", name: "ada" },
        via: "user",
        actorUserId: user.id,
        rows: expect.any(Number),
      }),
      undefined,
    );
  });

  it("fails with EXPORT_FAILED when a contributor throws, and logs which one", async () => {
    const storage = memoryStorage();
    const { auth, context, signUp, download } = await setup(
      {
        contributors: {
          orders: () => {
            throw new Error("orders database down");
          },
        },
      },
      [auditLog({ storage })],
    );
    const error = vi.spyOn(context.logger, "error").mockImplementation(() => {});
    const { user, headers } = await signUp("ada@example.com");
    await expect(download(headers)).rejects.toMatchObject({
      statusCode: 500,
      body: { code: "EXPORT_FAILED" },
    });
    expect(error).toHaveBeenCalledWith(
      '[data-export] contributor "orders" failed',
      expect.any(Error),
    );
    const { events } = await storage.read({ type: "data-export.failed", limit: 5, offset: 0 });
    expect(events).toEqual([
      expect.objectContaining({ userId: user.id, errorCode: "EXPORT_FAILED" }),
    ]);
    await expect(auth.api.exportUserData({ body: { userId: user.id } })).rejects.toMatchObject({
      body: { code: "EXPORT_FAILED" },
    });
  });

  it("refuses invalid options", () => {
    expect(() => dataExport({ maxRows: 0 })).toThrow(/maxRows/);
    expect(() => dataExport({ omit: { user: "image" as never } })).toThrow(/omit\.user/);
    expect(() => dataExport({ contributors: { orders: "x" as never } })).toThrow(/orders/);
    expect(() => dataExport({ rateLimit: { window: 0, max: 3 } })).toThrow(/rateLimit/);
    expect(() => dataExport({ freshAge: -1 })).toThrow(/freshAge/);
  });
});

describe("exports for someone else", () => {
  it("exports any user from server code, and 404s an unknown one", async () => {
    const { auth, signUp } = await setup();
    const { user } = await signUp("ada@example.com");
    const data = (await auth.api.exportUserData({ body: { userId: user.id } })) as DataExport;
    expect(data.user.email).toBe("ada@example.com");
    await expect(auth.api.exportUserData({ body: { userId: "nobody" } })).rejects.toMatchObject({
      statusCode: 404,
      body: { code: "USER_NOT_FOUND" },
    });
  });

  it("lets admins export over HTTP only with the admin option", async () => {
    const off = await setup();
    const ada = await off.signUp("ada@example.com");
    const root = await off.test.saveUser(
      off.test.createUser({ email: "root@example.com", role: "admin" }),
    );
    const rootHeaders = await off.test.getAuthHeaders({ userId: root.id });
    await expect(
      off.auth.api.adminDataExport({ headers: rootHeaders, body: { userId: ada.user.id } }),
    ).rejects.toMatchObject({ statusCode: 403, body: { code: "NOT_ALLOWED" } });

    const on = await setup({ admin: true });
    const eve = await on.signUp("eve@example.com");
    const bob = await on.signUp("bob@example.com");
    const admin = await on.test.saveUser(
      on.test.createUser({ email: "root@example.com", role: "admin" }),
    );
    const adminHeaders = await on.test.getAuthHeaders({ userId: admin.id });
    const data = (await on.auth.api.adminDataExport({
      headers: adminHeaders,
      body: { userId: bob.user.id },
    })) as DataExport;
    expect(data.user.email).toBe("bob@example.com");
    await expect(
      on.auth.api.adminDataExport({ headers: eve.headers, body: { userId: bob.user.id } }),
    ).rejects.toMatchObject({ statusCode: 403, body: { code: "NOT_ALLOWED" } });
  });

  it("lets the admins in adminUserIds export, whatever their role", async () => {
    const instance = await setup({ admin: { adminRoles: [], adminUserIds: ["support-1"] } });
    const ada = await instance.signUp("ada@example.com");
    const support = await instance.test.saveUser(
      instance.test.createUser({ id: "support-1", email: "support@example.com" }),
    );
    const root = await instance.test.saveUser(
      instance.test.createUser({ email: "root@example.com", role: "admin" }),
    );
    const body = { userId: ada.user.id };
    await expect(
      instance.auth.api.adminDataExport({
        headers: await instance.test.getAuthHeaders({ userId: support.id }),
        body,
      }),
    ).resolves.toMatchObject({ user: { email: "ada@example.com" } });
    await expect(
      instance.auth.api.adminDataExport({
        headers: await instance.test.getAuthHeaders({ userId: root.id }),
        body,
      }),
    ).rejects.toMatchObject({ statusCode: 403, body: { code: "NOT_ALLOWED" } });
  });

  it("treats an admin impersonating the user as an admin export", async () => {
    /** Ada's session, made by `root` impersonating her (better-auth's admin plugin). */
    const impersonated = async (instance: Awaited<ReturnType<typeof setup>>) => {
      const ada = await instance.signUp("ada@example.com");
      const root = await instance.test.saveUser(
        instance.test.createUser({ email: "root@example.com", role: "admin" }),
      );
      await instance.adapter.updateMany({
        model: "session",
        where: [{ field: "userId", value: ada.user.id }],
        update: { impersonatedBy: root.id },
      });
      return { ada, root };
    };

    const off = await setup();
    const blocked = await impersonated(off);
    await expect(off.download(blocked.ada.headers)).rejects.toMatchObject({
      statusCode: 403,
      body: { code: "NOT_ALLOWED" },
    });

    const storage = memoryStorage();
    const on = await setup({ admin: true }, [auditLog({ storage })]);
    const { ada, root } = await impersonated(on);
    await expect(on.download(ada.headers)).resolves.toMatchObject({
      user: { email: "ada@example.com" },
    });
    const { events } = await storage.read({ type: "data-export.completed", limit: 5, offset: 0 });
    expect(events).toEqual([
      expect.objectContaining({
        userId: ada.user.id,
        actorUserId: root.id,
        metadata: expect.objectContaining({ via: "admin" }),
      }),
    ]);
  });
});

describe("other plugins", () => {
  it("adds the audit events about and by the user, and records the export", async () => {
    const storage = memoryStorage();
    const { auth, signUp, download } = await setup({}, [auditLog({ storage })]);
    const { user, headers } = await signUp("ada@example.com");
    await auth.api.exportUserData({ body: { userId: user.id } });
    const data = await download(headers);

    const types = (data.data.auditEvent ?? []).map((event) => event.type);
    expect(types).toContain("sign-up");
    expect(types).toContain("data-export.completed");
    const { events } = await storage.read({ type: "data-export.completed", limit: 10, offset: 0 });
    expect(events.map((event: AuditEvent) => event.metadata?.via).sort()).toEqual([
      "server",
      "user",
    ]);
  });

  it("adds the waitlist entry, without its hashes", async () => {
    const { auth, signUp, download } = await setup({}, [
      waitlist({ enabled: false, confirmEmail: false }),
    ]);
    // The generic plugin list hides the waitlist's endpoints from the inferred API.
    const api = auth.api as unknown as {
      joinWaitlist: (input: { body: { email: string } }) => Promise<unknown>;
    };
    await api.joinWaitlist({ body: { email: "ada@example.com" } });
    const { headers } = await signUp("ada@example.com");
    const data = await download(headers);
    expect(data.data.waitlistEntry).toEqual([
      expect.objectContaining({ email: "ada@example.com" }),
    ]);
    expect(data.data.waitlistEntry?.[0]).not.toHaveProperty("tokenHash");
    expect(data.omitted.waitlistEntry).toEqual(expect.arrayContaining(["tokenHash"]));
  });
});

describe("isSecretField", () => {
  it("knows passwords, tokens, secrets, keys, and hashes", () => {
    for (const field of [
      "password",
      "token",
      "accessToken",
      "refreshToken",
      "idToken",
      "secret",
      "clientSecret",
      "backupCodes",
      "key",
      "privateKey",
      "tokenHash",
      "inviteCodeHash",
    ]) {
      expect(isSecretField(field), field).toBe(true);
    }
    for (const field of ["email", "accessTokenExpiresAt", "code", "ipAddress", "userAgent"]) {
      expect(isSecretField(field), field).toBe(false);
    }
  });
});
