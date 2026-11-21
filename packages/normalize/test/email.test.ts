import { auditLog, memoryStorage } from "@checodo/better-auth-audit-log";
import type { BetterAuthOptions } from "better-auth";
import { magicLink, testUtils } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it } from "vitest";
import type { EmailNormalizationOptions } from "../src/email";
import { emailNormalization } from "../src/email";

const PASSWORD = "password1234";

async function setup(
  options: EmailNormalizationOptions = {},
  config: Partial<BetterAuthOptions> = {},
) {
  const { auth } = await getTestInstance(
    {
      ...config,
      emailAndPassword: { enabled: true, ...config.emailAndPassword },
      plugins: [testUtils(), magicLink({ sendMagicLink: () => {} }), emailNormalization(options)],
    },
    { disableTestUser: true },
  );
  const context = await auth.$context;
  const signUp = (email: string) =>
    auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "Ada" } });
  const stored = (id: string) =>
    context.adapter.findOne<{ email: string; normalizedEmail: string | null }>({
      model: "user",
      where: [{ field: "id", value: id }],
    });
  return { auth, context, signUp, stored };
}

const userExists = { statusCode: 422, body: { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" } };

describe("emailNormalization", () => {
  it("stores the normalized address", async () => {
    const { signUp, stored } = await setup();
    const { user } = await signUp("A.da+News@Gmail.com");
    expect(await stored(user.id)).toMatchObject({
      email: "a.da+news@gmail.com",
      normalizedEmail: "ada@gmail.com",
    });
  });

  it("refuses a second account for the same inbox, like an existing email", async () => {
    const { signUp } = await setup();
    await signUp("ada@gmail.com");
    await expect(signUp("a.da+second@gmail.com")).rejects.toMatchObject(userExists);
    await expect(signUp("ada@googlemail.com")).rejects.toMatchObject(userExists);
    await expect(signUp("ada@gmail.com")).rejects.toMatchObject(userExists);
    await expect(signUp("bob@gmail.com")).resolves.toBeTruthy();
  });

  describe.each([
    { mode: "autoSignIn: false", emailAndPassword: { enabled: true, autoSignIn: false } },
    {
      mode: "requireEmailVerification",
      emailAndPassword: { enabled: true, requireEmailVerification: true },
    },
  ])("where better-auth hides existing users ($mode)", ({ emailAndPassword }) => {
    async function hidden() {
      const notified: string[] = [];
      const instance = await setup(
        {},
        {
          emailAndPassword: {
            ...emailAndPassword,
            onExistingUserSignUp: async ({ user }) => {
              notified.push(user.email);
            },
          },
          user: { additionalFields: { plan: { type: "string", required: false } } },
        },
      );
      await instance.signUp("ada@gmail.com");
      /** better-auth's answer for an email: the response, or the error's status and code. */
      const answer = async (email: string, password = PASSWORD) => {
        try {
          const { token, user } = await instance.auth.api.signUpEmail({
            body: { email, password, name: "Eve", plan: "pro" } as never,
          });
          return { token, keys: Object.keys(user).sort(), email: user.email };
        } catch (error) {
          const { statusCode, body } = error as { statusCode: number; body?: { code?: string } };
          return { statusCode, code: body?.code };
        }
      };
      return { ...instance, notified, answer };
    }

    it("answers an alias like an existing email", async () => {
      const { answer, context, notified } = await hidden();
      const fresh = await answer("new@gmail.com");
      const existing = await answer("ada@gmail.com");
      const alias = await answer("a.da+x@gmail.com");
      expect(alias).toEqual({ ...existing, email: "a.da+x@gmail.com" });
      expect(alias).toMatchObject({ token: null, keys: (fresh as { keys: string[] }).keys });
      expect(notified).toEqual(["ada@gmail.com", "ada@gmail.com"]);
      expect(await context.adapter.count({ model: "user" })).toBe(2);
    });

    it("checks the input first, like for any email", async () => {
      const { answer } = await hidden();
      const unknown = await answer("zed@gmail.com", "x");
      expect(unknown).toMatchObject({ statusCode: 400 });
      expect(await answer("ada@gmail.com", "x")).toEqual(unknown);
      expect(await answer("a.da@gmail.com", "x")).toEqual(unknown);
    });
  });

  it("refuses an alias on every way of creating a user", async () => {
    const { context, signUp } = await setup();
    await signUp("ada@gmail.com");
    await expect(
      context.internalAdapter.createUser(
        { email: "a.d.a@gmail.com", name: "Eve" },
        "server" as never,
      ),
    ).rejects.toMatchObject({ body: { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" } });
  });

  it("updates the normalized address when the email changes, and refuses another's inbox", async () => {
    const { context, signUp, stored } = await setup();
    const ada = await signUp("ada@gmail.com");
    const bob = await signUp("bob@gmail.com");
    await context.internalAdapter.updateUser(bob.user.id, { email: "bob.new@gmail.com" });
    expect(await stored(bob.user.id)).toMatchObject({ normalizedEmail: "bobnew@gmail.com" });
    await expect(
      context.internalAdapter.updateUser(bob.user.id, { email: "a.da@gmail.com" }),
    ).rejects.toMatchObject({ body: { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" } });
    // Ada may write her own address in another form.
    await context.internalAdapter.updateUser(ada.user.id, { email: "ada@gmail.com" });
  });

  it("signs in with another form of the address only with allowNormalizedSignIn", async () => {
    const off = await setup();
    await off.signUp("ada@gmail.com");
    await expect(
      off.auth.api.signInEmail({ body: { email: "a.da+x@gmail.com", password: PASSWORD } }),
    ).rejects.toMatchObject({ statusCode: 401 });

    const on = await setup({ allowNormalizedSignIn: true });
    await on.signUp("ada@gmail.com");
    const result = await on.auth.api.signInEmail({
      body: { email: "a.da+x@gmail.com", password: PASSWORD },
    });
    expect(result.user.email).toBe("ada@gmail.com");
    await expect(
      on.auth.api.signInEmail({ body: { email: "a.da@gmail.com", password: "wrong-password" } }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("backfills existing users and reports inboxes with two accounts", async () => {
    const { auth, context } = await setup();
    // Users from before the plugin: no normalized address yet.
    const create = (email: string) =>
      context.adapter.create<{ email: string; name: string }, { id: string }>({
        model: "user",
        data: {
          email,
          name: "x",
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as never,
      });
    const ada = await create("ada@gmail.com");
    const alias = await create("a.da@gmail.com");
    await create("bob@example.com");

    const first = await auth.api.backfillNormalizedEmails({ body: { limit: 2 } });
    expect(first.checked).toBe(2);
    expect(first.nextAfterId).not.toBeNull();
    const second = await auth.api.backfillNormalizedEmails({
      body: { afterId: first.nextAfterId ?? undefined, limit: 2 },
    });
    expect(second.nextAfterId).toBeNull();
    expect([...first.conflicts, ...second.conflicts]).toHaveLength(1);
    expect(first.updated + second.updated).toBe(2);
    const normalized = await context.adapter.findMany<{
      id: string;
      normalizedEmail: string | null;
    }>({
      model: "user",
    });
    const byId = new Map(normalized.map((user) => [user.id, user.normalizedEmail]));
    expect([byId.get(ada.id), byId.get(alias.id)].filter(Boolean)).toEqual(["ada@gmail.com"]);
    // Running it again changes nothing.
    const again = await auth.api.backfillNormalizedEmails({ body: { limit: 10 } });
    expect(again.updated).toBe(0);
  });

  it("validates its options", () => {
    expect(() => emailNormalization({ subaddressing: "some" as never })).toThrow(/subaddressing/);
    expect(() => emailNormalization({ normalize: "x" as never })).toThrow(/normalize/);
  });

  it("uses a custom normalizer", async () => {
    const { signUp, stored } = await setup({ normalize: (email) => email.split("@")[1] ?? null });
    const { user } = await signUp("ada@example.com");
    expect(await stored(user.id)).toMatchObject({ normalizedEmail: "example.com" });
    await expect(signUp("bob@example.com")).rejects.toMatchObject(userExists);
  });

  it("records a refused alias in the audit log", async () => {
    const storage = memoryStorage();
    const { auth } = await getTestInstance(
      {
        emailAndPassword: { enabled: true },
        plugins: [emailNormalization(), auditLog({ storage })],
      },
      { disableTestUser: true },
    );
    const signUp = (email: string) =>
      auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "Ada" } });
    const { user } = await signUp("ada@gmail.com");
    await expect(signUp("a.da@gmail.com")).rejects.toMatchObject(userExists);
    expect(
      storage.events.filter((event) => event.type === "normalize.email-alias-refused"),
    ).toEqual([
      expect.objectContaining({
        status: "failure",
        userId: user.id,
        actorUserId: null,
        metadata: { email: "a.da@gmail.com" },
      }),
    ]);
  });
});
