import type { BetterAuthPlugin } from "@better-auth/core";
import { findAll } from "@repo/plugin-utils/pagination";
import { resetTestDatabase, testDatabase } from "@repo/tooling/test-helpers";
import { admin, anonymous, magicLink, testUtils } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import { waitlistClient } from "../src/client";
import type { WaitlistConfirmation, WaitlistInvite, WaitlistOptions } from "../src/index";
import { waitlist } from "../src/index";

const ADMIN_EMAIL = "admin@example.org";

/**
 * A fresh auth instance with the waitlist, the admin plugin, and an admin
 * user (allowed past the waitlist). Double opt-in is off unless a test
 * passes `confirmEmail: true`; `confirmations` and `invites` collect what
 * would be emailed. `magicLinks` collects the links sent by the magic link
 * plugin, a sign-up path other than `/sign-up/email`.
 */
async function setup(options: WaitlistOptions = {}, extraPlugins: BetterAuthPlugin[] = []) {
  const invites: WaitlistInvite[] = [];
  const confirmations: WaitlistConfirmation[] = [];
  const magicLinks: { email: string; token: string }[] = [];
  /** The newest token each email got (confirmation, `onJoin`, invite): only hashes are stored. */
  const tokens = new Map<string, string>();
  const { auth, client } = await getTestInstance(
    {
      plugins: [
        waitlist({
          confirmEmail: false,
          sendConfirmationEmail: (confirmation) => {
            confirmations.push(confirmation);
            tokens.set(confirmation.email, confirmation.token);
          },
          sendInvite: (invite) => {
            invites.push(invite);
            tokens.set(invite.email, invite.token);
          },
          ...options,
          onJoin: (entry) => {
            tokens.set(entry.email, entry.token);
            return options.onJoin?.(entry);
          },
          allow: [ADMIN_EMAIL, ...(options.allow ?? [])],
        }),
        admin(),
        magicLink({
          sendMagicLink: ({ email, token }) => {
            magicLinks.push({ email, token });
          },
        }),
        testUtils(),
        ...extraPlugins,
      ],
    },
    { ...testDatabase(), disableTestUser: true, clientOptions: { plugins: [waitlistClient()] } },
  );
  const context = await auth.$context;
  await resetTestDatabase(context);
  const { test } = context;
  const adminUser = await test.saveUser(test.createUser({ email: ADMIN_EMAIL, role: "admin" }));
  const adminHeaders = await test.getAuthHeaders({ userId: adminUser.id });

  const join = (email: string) => auth.api.joinWaitlist({ body: { email } });
  /**
   * Joins one second apart, so the order is fixed. Entries created in the
   * same millisecond are ordered by their random ids.
   */
  const joinInOrder = async (...emails: string[]) => {
    const start = Date.now() - emails.length * 1000;
    try {
      for (const [i, email] of emails.entries()) {
        vi.useFakeTimers({ now: start + i * 1000, toFake: ["Date"] });
        await join(email);
      }
    } finally {
      vi.useRealTimers();
    }
  };
  const signUp = (email: string, extra: Record<string, unknown> = {}, headers?: Headers) =>
    auth.api.signUpEmail({
      body: { email, password: "password1234", name: "Someone", ...extra },
      ...(headers ? { headers } : {}),
    });
  const entryFor = async (email: string) =>
    (await auth.api.listWaitlistEntries({ query: { search: email }, headers: adminHeaders }))
      .entries[0];
  /** The entry's newest token, from the emails and `onJoin`: the admin endpoints don't return it. */
  const tokenFor = async (email: string) => present(tokens.get(email), `token for ${email}`);
  /** What the database holds in place of the token and invite code. */
  const storedFor = async (email: string) => {
    const entry = await context.adapter.findOne<{
      tokenHash: string;
      inviteCodeHash: string | null;
      confirmationsSent: number;
      confirmedAt: Date | null;
    }>({
      model: "waitlistEntry",
      where: [{ field: "email", value: email }],
    });
    return present(entry, `entry for ${email}`);
  };
  const approve = async (email: string) => {
    const entry = await entryFor(email);
    if (!entry) throw new Error(`no entry for ${email}`);
    const { entries } = await auth.api.approveWaitlistEntries({
      body: { ids: [entry.id] },
      headers: adminHeaders,
    });
    return present(entries[0], `approved entry for ${email}`);
  };

  return {
    auth,
    client,
    context,
    test,
    adminUser,
    adminHeaders,
    invites,
    confirmations,
    magicLinks,
    join,
    joinInOrder,
    signUp,
    entryFor,
    tokenFor,
    storedFor,
    approve,
  };
}

/** Hex SHA-256, how the plugin stores tokens and invite codes. */
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Narrows away `null` and `undefined`, failing the test with `what` otherwise. */
function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

async function expectError(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toMatchObject({ statusCode: status, body: { code } });
}

describe("join", () => {
  it("adds a normalized email as pending", async () => {
    const { join, entryFor } = await setup();
    await expect(join("  Ada@Example.COM ")).resolves.toEqual({ success: true });
    expect(await entryFor("ada@example.com")).toMatchObject({
      email: "ada@example.com",
      status: "pending",
    });
  });

  it("answers the same for new, waiting, and registered emails", async () => {
    const { join, adminUser } = await setup();
    const first = await join("ada@example.com");
    const again = await join("ada@example.com");
    const existingUser = await join(adminUser.email);
    expect([first, again, existingUser]).toEqual([
      { success: true },
      { success: true },
      { success: true },
    ]);
  });

  it("does not add emails that already have an account", async () => {
    const { auth, join, adminHeaders, adminUser } = await setup();
    await join(adminUser.email);
    const { total } = await auth.api.listWaitlistEntries({ headers: adminHeaders });
    expect(total).toBe(0);
  });

  it("calls onJoin only for new entries", async () => {
    const onJoin = vi.fn();
    const { join } = await setup({ onJoin });
    await join("ada@example.com");
    await join("ada@example.com");
    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(onJoin).toHaveBeenCalledWith(expect.objectContaining({ email: "ada@example.com" }));
  });

  it("keeps metadata as JSON and caps its size", async () => {
    const { auth, entryFor } = await setup();
    await auth.api.joinWaitlist({ body: { email: "ada@example.com", metadata: { source: "hn" } } });
    expect((await entryFor("ada@example.com"))?.metadata).toBe('{"source":"hn"}');

    await expectError(
      auth.api.joinWaitlist({
        body: { email: "bob@example.com", metadata: { blob: "x".repeat(3000) } },
      }),
      400,
      "METADATA_TOO_LARGE",
    );
  });

  it("rejects invalid emails", async () => {
    const { join } = await setup();
    await expect(join("not-an-email")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("stops at maxEntries for every email", async () => {
    const { join } = await setup({ maxEntries: 1 });
    await join("ada@example.com");
    await expectError(join("bob@example.com"), 403, "WAITLIST_FULL");
    await expectError(join("ada@example.com"), 403, "WAITLIST_FULL");
  });

  it("frees a place in maxEntries when an entry is rejected or its user signs up", async () => {
    const { auth, adminHeaders, join, entryFor, approve, signUp } = await setup({ maxEntries: 2 });
    await join("ada@example.com");
    await join("bob@example.com");
    await expectError(join("carol@example.com"), 403, "WAITLIST_FULL");

    const bob = await entryFor("bob@example.com");
    await auth.api.rejectWaitlistEntry({ body: { id: bob?.id as string }, headers: adminHeaders });
    await join("carol@example.com");
    await expectError(join("dan@example.com"), 403, "WAITLIST_FULL");

    await approve("ada@example.com");
    await signUp("ada@example.com");
    await expect(join("dan@example.com")).resolves.toBeDefined();
  });

  it("holds maxEntries when joins race for the last place", async () => {
    const { auth, adminHeaders, join } = await setup({ maxEntries: 2 });
    await join("ada@example.com");
    const results = await Promise.allSettled(
      ["bob", "carol", "dan", "erin"].map((name) => join(`${name}@example.com`)),
    );
    const stats = await auth.api.getWaitlistStats({ headers: adminHeaders });
    expect(stats.pending).toBeLessThanOrEqual(2);
    // Whoever didn't get a place was told so, and has no entry.
    const joined = results.filter((result) => result.status === "fulfilled").length;
    expect(stats.pending).toBe(1 + joined);
  });

  it("keeps a confirmation an admin acted on while the waitlist overfilled", async () => {
    // The confirmation takes a place; before it checks for overfilling,
    // another entry takes the last place and an admin approves this one.
    // Undoing the confirmation then doesn't apply: it stands.
    const { auth, context, join, confirmations, entryFor, storedFor } = await setup({
      confirmEmail: true,
      maxEntries: 1,
    });
    await join("ada@example.com");
    await join("bob@example.com");
    const ada = present(await entryFor("ada@example.com"), "ada");
    const bob = present(await entryFor("bob@example.com"), "bob");
    const update = context.adapter.update.bind(context.adapter);
    vi.spyOn(context.adapter, "update").mockImplementation(async (data) => {
      const result = await update(data);
      if ((data.update as { status?: string }).status === "pending") {
        vi.mocked(context.adapter.update).mockRestore();
        await update({
          model: "waitlistEntry",
          where: [{ field: "id", value: bob.id }],
          update: { status: "pending" },
        });
        await update({
          model: "waitlistEntry",
          where: [{ field: "id", value: ada.id }],
          update: { status: "approved" },
        });
      }
      return result;
    });

    const token = present(confirmations[0], "ada's confirmation").token;
    await expect(auth.api.confirmWaitlistEmail({ body: { token } })).resolves.toEqual({
      success: true,
    });
    expect((await entryFor("ada@example.com"))?.status).toBe("approved");
    expect((await storedFor("ada@example.com")).confirmedAt).toBeInstanceOf(Date);
  });

  it("refuses a confirmation whose entry was deleted while it was checked", async () => {
    // The link was valid when read, then the cleanup deleted the expired
    // entry before the confirmation was written.
    const { auth, context, join, confirmations, entryFor } = await setup({ confirmEmail: true });
    await join("ada@example.com");
    const ada = present(await entryFor("ada@example.com"), "ada");
    const update = context.adapter.update.bind(context.adapter);
    vi.spyOn(context.adapter, "update").mockImplementation(async (data) => {
      vi.mocked(context.adapter.update).mockRestore();
      await context.adapter.deleteMany({
        model: "waitlistEntry",
        where: [{ field: "id", value: ada.id }],
      });
      return update(data);
    });

    const token = present(confirmations[0], "ada's confirmation").token;
    await expectError(auth.api.confirmWaitlistEmail({ body: { token } }), 400, "INVALID_TOKEN");
  });

  it("holds maxEntries when confirmations race for the last place", async () => {
    const { auth, adminHeaders, join, confirmations } = await setup({
      confirmEmail: true,
      maxEntries: 1,
    });
    for (const name of ["ada", "bob", "carol"]) await join(`${name}@example.com`);
    await Promise.allSettled(
      confirmations.map(({ token }) => auth.api.confirmWaitlistEmail({ body: { token } })),
    );
    const stats = await auth.api.getWaitlistStats({ headers: adminHeaders });
    expect(stats.pending).toBeLessThanOrEqual(1);
    // The others stay unconfirmed, so they can confirm once there's room.
    expect(stats.unconfirmed).toBe(3 - stats.pending);
    const { entries } = await auth.api.listWaitlistEntries({
      query: { status: "unconfirmed" },
      headers: adminHeaders,
    });
    expect(entries.map((entry) => entry.confirmedAt ?? null)).toEqual(entries.map(() => null));
  });

  it("auto-approves with a function", async () => {
    const { join, entryFor, invites } = await setup({
      autoApprove: (email) => email.endsWith("@partner.com"),
    });
    await join("ada@partner.com");
    await join("bob@example.com");
    expect((await entryFor("ada@partner.com"))?.status).toBe("approved");
    expect((await entryFor("bob@example.com"))?.status).toBe("pending");
    expect(invites.map((invite) => invite.email)).toEqual(["ada@partner.com"]);
  });
});

describe("double opt-in", () => {
  it("keeps new entries unconfirmed and sends a confirmation link", async () => {
    const onJoin = vi.fn();
    const { join, entryFor, tokenFor, confirmations } = await setup({
      confirmEmail: true,
      onJoin,
    });
    await expect(join("ada@example.com")).resolves.toEqual({ success: true });

    expect((await entryFor("ada@example.com"))?.status).toBe("unconfirmed");
    expect(confirmations).toEqual([
      {
        email: "ada@example.com",
        token: await tokenFor("ada@example.com"),
        expiresAt: expect.any(Date),
      },
    ]);
    expect(onJoin).not.toHaveBeenCalled();
  });

  it("confirms with the token, then calls onJoin and autoApprove", async () => {
    const onJoin = vi.fn();
    const { auth, join, entryFor, confirmations, invites } = await setup({
      confirmEmail: true,
      onJoin,
      autoApprove: true,
    });
    await join("ada@example.com");
    expect(invites).toEqual([]);

    const token = present(confirmations[0], "confirmation").token;
    await expect(auth.api.confirmWaitlistEmail({ body: { token } })).resolves.toEqual({
      success: true,
    });
    expect((await entryFor("ada@example.com"))?.status).toBe("approved");
    expect(onJoin).toHaveBeenCalledOnce();
    expect(invites.map((invite) => invite.email)).toEqual(["ada@example.com"]);

    // Opening the link again changes nothing.
    await auth.api.confirmWaitlistEmail({ body: { token } });
    expect(onJoin).toHaveBeenCalledOnce();
  });

  it("records when the email was confirmed, once", async () => {
    const { auth, join, entryFor, confirmations } = await setup({ confirmEmail: true });
    await join("ada@example.com");
    expect((await entryFor("ada@example.com"))?.confirmedAt ?? null).toBeNull();

    const before = Date.now();
    const { token } = present(confirmations[0], "confirmation");
    await auth.api.confirmWaitlistEmail({ body: { token } });
    const confirmedAt = present((await entryFor("ada@example.com"))?.confirmedAt, "confirmedAt");
    expect(new Date(confirmedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(new Date(confirmedAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    // Opening the link again keeps the first time.
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
    try {
      await auth.api.confirmWaitlistEmail({ body: { token } });
    } finally {
      vi.useRealTimers();
    }
    expect((await entryFor("ada@example.com"))?.confirmedAt).toEqual(confirmedAt);
  });

  it("leaves confirmedAt empty when nobody confirmed the email", async () => {
    const withoutOptIn = await setup();
    await withoutOptIn.join("ada@example.com");
    expect((await withoutOptIn.entryFor("ada@example.com"))?.confirmedAt ?? null).toBeNull();

    // Invited directly, whether the email had joined (unconfirmed) or not.
    const { auth, join, adminHeaders } = await setup({ confirmEmail: true });
    await join("bob@example.com");
    for (const email of ["bob@example.com", "carol@example.com"]) {
      const { entry } = await auth.api.createWaitlistInvite({
        body: { email },
        headers: adminHeaders,
      });
      expect(entry.confirmedAt ?? null).toBeNull();
    }
  });

  it("rejects unknown and expired tokens", async () => {
    const { auth, join, confirmations } = await setup({
      confirmEmail: true,
      confirmationExpiresIn: 60,
    });
    await expectError(
      auth.api.confirmWaitlistEmail({ body: { token: "nope" } }),
      400,
      "INVALID_TOKEN",
    );

    await join("ada@example.com");
    const token = present(confirmations[0], "confirmation").token;
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
    try {
      await expectError(auth.api.confirmWaitlistEmail({ body: { token } }), 400, "INVALID_TOKEN");
    } finally {
      vi.useRealTimers();
    }
  });

  it("resends the link when an unconfirmed email joins again", async () => {
    const { auth, join, confirmations } = await setup({ confirmEmail: true });
    await join("ada@example.com");
    const later = (minutes: number) =>
      vi.useFakeTimers({ now: Date.now() + minutes * 60_000, toFake: ["Date"] });
    try {
      later(6);
      await join("ada@example.com");
    } finally {
      vi.useRealTimers();
    }
    expect(confirmations).toHaveLength(2);
    // A new link, valid for longer; only the hash of the old one was kept,
    // so it stops working.
    const [first, second] = [
      present(confirmations[0], "first"),
      present(confirmations[1], "second"),
    ];
    expect(second.token).not.toBe(first.token);
    expect(second.expiresAt.getTime()).toBeGreaterThan(first.expiresAt.getTime());
    await expectError(
      auth.api.confirmWaitlistEmail({ body: { token: first.token } }),
      400,
      "INVALID_TOKEN",
    );
    await expect(auth.api.confirmWaitlistEmail({ body: { token: second.token } })).resolves.toEqual(
      { success: true },
    );
  });

  it("resends at most once every 5 minutes, and 3 times in total", async () => {
    const { join, confirmations } = await setup({ confirmEmail: true });
    const start = Date.now();
    const joinAt = async (minutes: number) => {
      vi.useFakeTimers({ now: start + minutes * 60_000, toFake: ["Date"] });
      try {
        await expect(join("ada@example.com")).resolves.toEqual({ success: true });
      } finally {
        vi.useRealTimers();
      }
    };

    await joinAt(0); // first email
    await joinAt(1); // too soon
    await joinAt(4); // too soon
    expect(confirmations).toHaveLength(1);

    await joinAt(5); // resend 1
    await joinAt(10); // resend 2
    await joinAt(15); // resend 3
    await joinAt(20); // limit reached
    await joinAt(60);
    expect(confirmations).toHaveLength(4);
  });

  it("doesn't count unconfirmed entries toward maxEntries", async () => {
    const { auth, join, confirmations } = await setup({ confirmEmail: true, maxEntries: 1 });
    await join("ada@example.com");
    await join("bob@example.com");
    expect(confirmations).toHaveLength(2);

    const [ada, bob] = confirmations;
    await auth.api.confirmWaitlistEmail({ body: { token: present(ada, "ada").token } });
    // Full now: confirming another entry, or joining, fails.
    await expectError(
      auth.api.confirmWaitlistEmail({ body: { token: present(bob, "bob").token } }),
      403,
      "WAITLIST_FULL",
    );
    await expectError(join("carol@example.com"), 403, "WAITLIST_FULL");
  });

  it("deletes unconfirmed entries once their link has expired", async () => {
    const { join, entryFor } = await setup({ confirmEmail: true, confirmationExpiresIn: 60 });
    await join("ada@example.com");
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
    try {
      await join("bob@example.com");
      expect(await entryFor("ada@example.com")).toBeUndefined();
      expect((await entryFor("bob@example.com"))?.status).toBe("unconfirmed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't let admins approve unconfirmed entries in bulk", async () => {
    const { auth, join, entryFor, adminHeaders } = await setup({ confirmEmail: true });
    await join("ada@example.com");
    const entry = present(await entryFor("ada@example.com"), "entry");
    const byId = await auth.api.approveWaitlistEntries({
      body: { ids: [entry.id] },
      headers: adminHeaders,
    });
    const byCount = await auth.api.approveWaitlistEntries({
      body: { count: 10 },
      headers: adminHeaders,
    });
    expect([byId.entries, byCount.entries]).toEqual([[], []]);
  });

  it("lets admins invite an unconfirmed email directly", async () => {
    const { auth, join, adminHeaders } = await setup({ confirmEmail: true });
    await join("ada@example.com");
    const { entry } = await auth.api.createWaitlistInvite({
      body: { email: "ada@example.com" },
      headers: adminHeaders,
    });
    expect(entry.status).toBe("approved");
  });
});

describe("status and leaving", () => {
  it("shows the status and position with the entry's token", async () => {
    const { auth, joinInOrder, approve, tokenFor } = await setup();
    await joinInOrder("a@example.com", "b@example.com", "c@example.com");
    const c = { token: await tokenFor("c@example.com") };

    expect(await auth.api.getWaitlistStatus({ query: { token: c.token } })).toEqual({
      email: "c@example.com",
      status: "pending",
      position: 3,
      inviteExpiresAt: null,
    });

    const a = await approve("a@example.com");
    expect(await auth.api.getWaitlistStatus({ query: { token: c.token } })).toMatchObject({
      position: 2,
    });
    const aToken = await tokenFor("a@example.com");
    expect(await auth.api.getWaitlistStatus({ query: { token: aToken } })).toMatchObject({
      status: "approved",
      position: null,
      inviteExpiresAt: a.inviteExpiresAt,
    });
  });

  it("rejects unknown tokens", async () => {
    const { auth } = await setup();
    await expectError(
      auth.api.getWaitlistStatus({ query: { token: "nope" } }),
      400,
      "INVALID_TOKEN",
    );
    await expectError(auth.api.leaveWaitlist({ body: { token: "nope" } }), 400, "INVALID_TOKEN");
  });

  it("deletes the entry when leaving", async () => {
    const { auth, join, entryFor, tokenFor } = await setup();
    await join("ada@example.com");
    const token = await tokenFor("ada@example.com");
    await expect(auth.api.leaveWaitlist({ body: { token } })).resolves.toEqual({ success: true });
    expect(await entryFor("ada@example.com")).toBeUndefined();
  });

  it("gives every entry a different token", async () => {
    const { join, tokenFor } = await setup();
    await join("ada@example.com");
    await join("bob@example.com");
    const ada = await tokenFor("ada@example.com");
    expect(ada).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(ada).not.toBe(await tokenFor("bob@example.com"));
  });

  it("stores only hashes of tokens and invite codes", async () => {
    const { join, approve, tokenFor, storedFor } = await setup();
    await join("ada@example.com");
    const { inviteCode } = await approve("ada@example.com");
    const stored = await storedFor("ada@example.com");
    expect(stored.tokenHash).toBe(await sha256(await tokenFor("ada@example.com")));
    expect(stored.inviteCodeHash).toBe(await sha256(present(inviteCode, "invite code")));
  });
});

describe("sign-up gate", () => {
  it("blocks emails that are not on the waitlist or not approved", async () => {
    const { join, signUp } = await setup();
    await expectError(signUp("stranger@example.com"), 403, "EMAIL_NOT_APPROVED");
    await join("ada@example.com");
    await expectError(signUp("ada@example.com"), 403, "EMAIL_NOT_APPROVED");
  });

  it("lets approved emails sign up and marks them registered", async () => {
    const { join, approve, signUp, entryFor, storedFor } = await setup();
    await join("ada@example.com");
    await approve("ada@example.com");
    await expect(signUp("Ada@Example.com")).resolves.toMatchObject({
      user: { email: "ada@example.com" },
    });
    expect(await entryFor("ada@example.com")).toMatchObject({ status: "registered" });
    // The invite is used up.
    expect((await storedFor("ada@example.com")).inviteCodeHash).toBeNull();
  });

  it("gates sign-up paths other than email, like magic links", async () => {
    const { auth, join, approve, magicLinks } = await setup();
    await auth.api.signInMagicLink({ body: { email: "ada@example.com" }, headers: new Headers() });
    const blocked = present(magicLinks.at(-1), "magic link");
    await expect(
      auth.api.magicLinkVerify({ query: { token: blocked.token }, headers: new Headers() }),
    ).rejects.toThrow();

    await join("ada@example.com");
    await approve("ada@example.com");
    await auth.api.signInMagicLink({ body: { email: "ada@example.com" }, headers: new Headers() });
    const allowed = present(magicLinks.at(-1), "magic link");
    await expect(
      auth.api.magicLinkVerify({ query: { token: allowed.token }, headers: new Headers() }),
    ).resolves.toMatchObject({ user: { email: "ada@example.com" } });
  });

  it("gates users created by server code", async () => {
    const { test } = await setup();
    await expectError(
      test.saveUser(test.createUser({ email: "script@example.com" })),
      403,
      "EMAIL_NOT_APPROVED",
    );
  });

  it("lets the admin plugin create users by default", async () => {
    const { auth, adminHeaders } = await setup();
    await expect(
      auth.api.createUser({
        body: { email: "made@example.com", password: "password1234", name: "Made" },
        headers: adminHeaders,
      }),
    ).resolves.toMatchObject({ user: { email: "made@example.com" } });
  });

  it("uses a custom bypass", async () => {
    const { auth, adminHeaders, signUp } = await setup({
      bypass: (context) => context?.path === "/sign-up/email",
    });
    await expect(signUp("ada@example.com")).resolves.toBeTruthy();
    await expectError(
      auth.api.createUser({
        body: { email: "made@example.com", password: "password1234", name: "Made" },
        headers: adminHeaders,
      }),
      403,
      "EMAIL_NOT_APPROVED",
    );
  });

  it("blocks anonymous sign-in unless bypass lets it through", async () => {
    const instance = (options: WaitlistOptions) =>
      getTestInstance(
        { plugins: [waitlist({ confirmEmail: false, ...options }), anonymous()] },
        { disableTestUser: true },
      );
    const blocked = await instance({});
    await expect(
      blocked.auth.api.signInAnonymous({ headers: new Headers() }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const open = await instance({ bypass: (context) => context?.path === "/sign-in/anonymous" });
    await expect(open.auth.api.signInAnonymous({ headers: new Headers() })).resolves.toBeTruthy();
  });

  it("lets allowed emails and domains through", async () => {
    const { signUp } = await setup({ allow: ["vip@example.com", "acme.com"] });
    await expect(signUp("VIP@example.com")).resolves.toBeTruthy();
    await expect(signUp("ada@team.acme.com")).resolves.toBeTruthy();
    await expectError(signUp("ada@notacme.com"), 403, "EMAIL_NOT_APPROVED");
  });

  it("is open with enabled: false, but still records registrations", async () => {
    const { join, signUp, entryFor } = await setup({ enabled: false });
    await join("ada@example.com");
    await expect(signUp("ada@example.com")).resolves.toBeTruthy();
    await expect(signUp("bob@example.com")).resolves.toBeTruthy();
    expect((await entryFor("ada@example.com"))?.status).toBe("registered");
  });

  it("blocks approvals whose invite has expired", async () => {
    const { join, approve, signUp } = await setup({ inviteExpiresIn: 60 });
    await join("ada@example.com");
    await approve("ada@example.com");
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
    try {
      await expectError(signUp("ada@example.com"), 403, "EMAIL_NOT_APPROVED");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never expires approvals with inviteExpiresIn: 0", async () => {
    const { join, approve } = await setup({ inviteExpiresIn: 0 });
    await join("ada@example.com");
    const entry = await approve("ada@example.com");
    expect(entry.inviteExpiresAt).toBeNull();
  });
});

describe("invite codes", () => {
  it("sends an invite with the code and a new token on approval", async () => {
    const { auth, join, approve, invites, tokenFor, entryFor } = await setup();
    await join("ada@example.com");
    const joinToken = await tokenFor("ada@example.com");
    const entry = await approve("ada@example.com");
    expect(invites).toEqual([
      {
        email: "ada@example.com",
        inviteCode: entry.inviteCode,
        expiresAt: entry.inviteExpiresAt,
        token: await tokenFor("ada@example.com"),
      },
    ]);
    expect(entry.inviteCode).toMatch(/^[A-Za-z0-9]{32}$/);
    // Only the hash of the token from the join was stored, so the invite
    // carries a new one and the old links stop working.
    expect(await tokenFor("ada@example.com")).not.toBe(joinToken);
    await expectError(
      auth.api.getWaitlistStatus({ query: { token: joinToken } }),
      400,
      "INVALID_TOKEN",
    );
    // The code is only returned when issued: listing shows `null`.
    expect((await entryFor("ada@example.com"))?.inviteCode).toBeNull();
  });

  it("checks codes without revealing the email", async () => {
    const { auth, join, approve } = await setup();
    await join("ada@example.com");
    const { inviteCode } = await approve("ada@example.com");
    expect(
      await auth.api.checkWaitlistInvite({ query: { code: present(inviteCode, "invite code") } }),
    ).toEqual({
      valid: true,
    });
    expect(await auth.api.checkWaitlistInvite({ query: { code: "nope" } })).toEqual({
      valid: false,
    });
  });

  it("requires the code in the body or header with requireInviteCode", async () => {
    const { join, approve, signUp } = await setup({ requireInviteCode: true });
    await join("ada@example.com");
    await join("bob@example.com");
    const ada = await approve("ada@example.com");
    const bob = await approve("bob@example.com");

    await expectError(signUp("ada@example.com"), 403, "INVITE_CODE_REQUIRED");
    await expectError(
      signUp("ada@example.com", { inviteCode: bob.inviteCode }),
      403,
      "INVALID_INVITE_CODE",
    );
    await expect(signUp("ada@example.com", { inviteCode: ada.inviteCode })).resolves.toBeTruthy();
    await expect(
      signUp(
        "bob@example.com",
        {},
        new Headers({ "x-invite-code": present(bob.inviteCode, "invite code") }),
      ),
    ).resolves.toBeTruthy();
  });

  it("doesn't reveal approved emails when the code is required", async () => {
    const { join, approve, signUp } = await setup({ requireInviteCode: true });
    await join("ada@example.com");
    const ada = await approve("ada@example.com");

    // Without a code: the same error for an approved and an unknown email.
    await expectError(signUp("ada@example.com"), 403, "INVITE_CODE_REQUIRED");
    await expectError(signUp("stranger@example.com"), 403, "INVITE_CODE_REQUIRED");
    // With someone else's code: the same error as a wrong code.
    await expectError(
      signUp("stranger@example.com", { inviteCode: ada.inviteCode }),
      403,
      "INVALID_INVITE_CODE",
    );
  });

  it("reports expired codes as invalid", async () => {
    const { auth, join, approve } = await setup({ inviteExpiresIn: 60 });
    await join("ada@example.com");
    const { inviteCode } = await approve("ada@example.com");
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
    try {
      expect(
        await auth.api.checkWaitlistInvite({ query: { code: present(inviteCode, "code") } }),
      ).toEqual({ valid: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("can't be reused after registration", async () => {
    const { auth, join, approve, signUp } = await setup();
    await join("ada@example.com");
    const { inviteCode } = await approve("ada@example.com");
    await signUp("ada@example.com");
    expect(
      await auth.api.checkWaitlistInvite({ query: { code: present(inviteCode, "invite code") } }),
    ).toEqual({
      valid: false,
    });
  });
});

describe("admin endpoints", () => {
  it("are forbidden for users without an admin role", async () => {
    const { auth, test } = await setup({ allow: ["user@example.org"] });
    const user = await test.saveUser(test.createUser({ email: "user@example.org" }));
    const headers = await test.getAuthHeaders({ userId: user.id });
    await expectError(
      auth.api.listWaitlistEntries({ headers }),
      403,
      "YOU_ARE_NOT_ALLOWED_TO_MANAGE_WAITLIST",
    );
    await expectError(
      auth.api.approveWaitlistEntries({ body: { count: 1 }, headers }),
      403,
      "YOU_ARE_NOT_ALLOWED_TO_MANAGE_WAITLIST",
    );
    await expectError(
      auth.api.createWaitlistInvite({ body: { email: "x@example.com" }, headers }),
      403,
      "YOU_ARE_NOT_ALLOWED_TO_MANAGE_WAITLIST",
    );
  });

  it("require a session", async () => {
    const { auth } = await setup();
    await expect(auth.api.getWaitlistStats({ headers: new Headers() })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it("allow adminUserIds and comma-separated roles", async () => {
    const { auth, test } = await setup({
      allow: ["owner@example.org", "mod@example.org"],
      adminUserIds: ["owner-id"],
      adminRoles: ["moderator"],
    });
    const owner = await test.saveUser(
      test.createUser({ id: "owner-id", email: "owner@example.org" }),
    );
    const mod = await test.saveUser(
      test.createUser({ email: "mod@example.org", role: "user, moderator" }),
    );
    for (const user of [owner, mod]) {
      const headers = await test.getAuthHeaders({ userId: user.id });
      await expect(auth.api.getWaitlistStats({ headers })).resolves.toMatchObject({ total: 0 });
    }
  });

  it("never return entry tokens", async () => {
    const { auth, join, approve, adminHeaders } = await setup();
    await join("ada@example.com");
    const approved = await approve("ada@example.com");
    const { entries } = await auth.api.listWaitlistEntries({ headers: adminHeaders });
    const { entry: invited } = await auth.api.createWaitlistInvite({
      body: { email: "bob@example.com" },
      headers: adminHeaders,
    });
    const { entry: rejected } = await auth.api.rejectWaitlistEntry({
      body: { id: approved.id },
      headers: adminHeaders,
    });
    for (const entry of [approved, ...entries, invited, rejected]) {
      expect(entry).not.toHaveProperty("token");
    }
  });

  it("list, filter, and paginate entries oldest first", async () => {
    const { auth, joinInOrder, approve, adminHeaders } = await setup();
    await joinInOrder("a@example.com", "b@example.com", "c@example.com");
    await approve("b@example.com");

    const page = await auth.api.listWaitlistEntries({
      query: { limit: 2, offset: 0 },
      headers: adminHeaders,
    });
    expect(page.total).toBe(3);
    expect(page.entries.map((entry) => entry.email)).toEqual(["a@example.com", "b@example.com"]);

    const pending = await auth.api.listWaitlistEntries({
      query: { status: "pending" },
      headers: adminHeaders,
    });
    expect(pending.entries.map((entry) => entry.email)).toEqual(["a@example.com", "c@example.com"]);
  });

  it("count entries per status", async () => {
    const { auth, joinInOrder, approve, signUp, adminHeaders } = await setup();
    await joinInOrder("a@example.com", "b@example.com", "c@example.com");
    await approve("a@example.com");
    await approve("b@example.com");
    await signUp("b@example.com");
    expect(await auth.api.getWaitlistStats({ headers: adminHeaders })).toEqual({
      unconfirmed: 0,
      pending: 1,
      approved: 1,
      rejected: 0,
      registered: 1,
      total: 3,
    });
  });

  it("approve the next pending entries by count", async () => {
    const { auth, joinInOrder, adminHeaders, adminUser } = await setup();
    await joinInOrder("a@example.com", "b@example.com", "c@example.com");
    const { entries } = await auth.api.approveWaitlistEntries({
      body: { count: 2 },
      headers: adminHeaders,
    });
    expect(entries.map((entry) => [entry.email, entry.status, entry.approvedBy])).toEqual([
      ["a@example.com", "approved", adminUser.id],
      ["b@example.com", "approved", adminUser.id],
    ]);
  });

  it("need exactly one of ids and count to approve", async () => {
    const { auth, adminHeaders } = await setup();
    await expect(
      auth.api.approveWaitlistEntries({ body: {}, headers: adminHeaders }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      auth.api.approveWaitlistEntries({ body: { ids: ["x"], count: 1 }, headers: adminHeaders }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("renew an invite when approving again, and skip registered entries", async () => {
    const { auth, join, approve, signUp, entryFor, adminHeaders } = await setup();
    await join("ada@example.com");
    const first = await approve("ada@example.com");
    const second = await approve("ada@example.com");
    expect(second.inviteCode).not.toBe(first.inviteCode);

    await signUp("ada@example.com");
    const entry = await entryFor("ada@example.com");
    const { entries } = await auth.api.approveWaitlistEntries({
      body: { ids: [present(entry, "entry").id] },
      headers: adminHeaders,
    });
    expect(entries).toEqual([]);
  });

  it("reject an entry, invalidating its invite", async () => {
    const onReject = vi.fn();
    const { auth, join, approve, signUp, adminHeaders } = await setup({ onReject });
    await join("ada@example.com");
    const approved = await approve("ada@example.com");
    const { entry } = await auth.api.rejectWaitlistEntry({
      body: { id: approved.id },
      headers: adminHeaders,
    });
    expect(entry).toMatchObject({ status: "rejected", inviteCode: null });
    expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ email: "ada@example.com" }));
    await expectError(signUp("ada@example.com"), 403, "EMAIL_NOT_APPROVED");
  });

  it("delete an entry", async () => {
    const { auth, join, entryFor, adminHeaders } = await setup();
    await join("ada@example.com");
    const entry = await entryFor("ada@example.com");
    await auth.api.deleteWaitlistEntry({
      body: { id: present(entry, "entry").id },
      headers: adminHeaders,
    });
    expect(await entryFor("ada@example.com")).toBeUndefined();
    await expectError(
      auth.api.deleteWaitlistEntry({
        body: { id: present(entry, "entry").id },
        headers: adminHeaders,
      }),
      404,
      "ENTRY_NOT_FOUND",
    );
  });

  it("invite an email directly", async () => {
    const { auth, signUp, invites, adminHeaders } = await setup();
    const { entry } = await auth.api.createWaitlistInvite({
      body: { email: "Guest@Example.com" },
      headers: adminHeaders,
    });
    expect(entry).toMatchObject({ email: "guest@example.com", status: "approved" });
    expect(invites.map((invite) => invite.email)).toEqual(["guest@example.com"]);
    await expect(signUp("guest@example.com")).resolves.toBeTruthy();
  });
});

describe("concurrent requests", () => {
  /**
   * Delays every adapter write, so all concurrent requests have read the
   * entry before any of them writes: the case the conditional updates
   * guard against. Without it, on Postgres and MySQL a request can read
   * after another one's write and legitimately act on the new state (an
   * approval of an approved entry renews its invite).
   */
  function slowWrites(context: Awaited<ReturnType<typeof setup>>["context"]) {
    const update = context.adapter.update.bind(context.adapter);
    vi.spyOn(context.adapter, "update").mockImplementation(async (data) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return update(data);
    });
  }

  it("resend the confirmation link once when the same email joins again at once", async () => {
    const { auth, join, confirmations, storedFor } = await setup({ confirmEmail: true });
    await join("ada@example.com");
    vi.useFakeTimers({ now: Date.now() + 6 * 60_000, toFake: ["Date"] });
    try {
      const answers = await Promise.all(Array.from({ length: 5 }, () => join("ada@example.com")));
      expect(answers).toEqual(Array.from({ length: 5 }, () => ({ success: true })));
    } finally {
      vi.useRealTimers();
    }

    expect(confirmations).toHaveLength(2);
    const stored = await storedFor("ada@example.com");
    expect(stored.confirmationsSent).toBe(2);
    // The one link sent is the one that works.
    const sent = present(confirmations[1], "resent confirmation");
    expect(stored.tokenHash).toBe(await sha256(sent.token));
    await expect(auth.api.confirmWaitlistEmail({ body: { token: sent.token } })).resolves.toEqual({
      success: true,
    });
  });

  it("never send more than 4 confirmation emails, even to concurrent joins", async () => {
    const { join, confirmations } = await setup({ confirmEmail: true });
    const start = Date.now();
    await join("ada@example.com");
    for (const minutes of [5, 10, 15, 20, 25]) {
      vi.useFakeTimers({ now: start + minutes * 60_000, toFake: ["Date"] });
      try {
        await Promise.all(Array.from({ length: 3 }, () => join("ada@example.com")));
      } finally {
        vi.useRealTimers();
      }
    }
    expect(confirmations).toHaveLength(4);
  });

  it("run onJoin and send one invite when the link is opened several times at once", async () => {
    const onJoin = vi.fn();
    const { auth, context, join, confirmations, invites, storedFor } = await setup({
      confirmEmail: true,
      autoApprove: true,
      onJoin,
    });
    await join("ada@example.com");
    const { token } = present(confirmations[0], "confirmation");
    slowWrites(context);

    const answers = await Promise.all(
      Array.from({ length: 5 }, () => auth.api.confirmWaitlistEmail({ body: { token } })),
    );
    expect(answers).toEqual(Array.from({ length: 5 }, () => ({ success: true })));
    expect(onJoin).toHaveBeenCalledOnce();
    expect(invites).toHaveLength(1);
    expect((await storedFor("ada@example.com")).confirmedAt).not.toBeNull();
    // The invite code sent is the one stored.
    const stored = await storedFor("ada@example.com");
    expect(stored.inviteCodeHash).toBe(await sha256(present(invites[0], "invite").inviteCode));
  });

  it("send one invite when admins approve the same entry at once", async () => {
    const { auth, context, join, entryFor, invites, storedFor, adminHeaders } = await setup();
    await join("ada@example.com");
    const { id } = present(await entryFor("ada@example.com"), "entry");
    slowWrites(context);

    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        auth.api.approveWaitlistEntries({ body: { ids: [id] }, headers: adminHeaders }),
      ),
    );
    const approved = results.flatMap((result) => result.entries);
    expect(approved).toHaveLength(1);
    expect(invites).toHaveLength(1);
    const { inviteCode } = present(approved[0], "approved entry");
    expect(present(invites[0], "invite").inviteCode).toBe(inviteCode);
    expect((await storedFor("ada@example.com")).inviteCodeHash).toBe(
      await sha256(present(inviteCode, "invite code")),
    );
  });

  it("let only one of a concurrent approval and rejection win", async () => {
    const { auth, context, join, entryFor, invites, adminHeaders } = await setup();
    await join("ada@example.com");
    const { id } = present(await entryFor("ada@example.com"), "entry");
    slowWrites(context);

    const [approval, rejection] = await Promise.allSettled([
      auth.api.approveWaitlistEntries({ body: { ids: [id] }, headers: adminHeaders }),
      auth.api.rejectWaitlistEntry({ body: { id }, headers: adminHeaders }),
    ]);
    const approvedCount = approval.status === "fulfilled" ? approval.value.entries.length : 0;
    const rejected = rejection.status === "fulfilled";
    expect(approvedCount + (rejected ? 1 : 0)).toBe(1);
    if (!rejected) {
      expect(rejection.reason).toMatchObject({
        statusCode: 409,
        body: { code: "ENTRY_CHANGED" },
      });
    }
    const entry = present(await entryFor("ada@example.com"), "entry");
    expect(entry.status).toBe(rejected ? "rejected" : "approved");
    expect(invites).toHaveLength(approvedCount);
  });
});

describe("cleanup", () => {
  const DAY = 86_400_000;

  /** Runs `fn` with `Date` moved `ms` into the future. */
  async function later<T>(ms: number, fn: () => Promise<T>): Promise<T> {
    vi.useFakeTimers({ now: Date.now() + ms, toFake: ["Date"] });
    try {
      return await fn();
    } finally {
      vi.useRealTimers();
    }
  }

  it("deletes expired unconfirmed entries on other waitlist requests, without a join", async () => {
    const { auth, join, entryFor, adminHeaders } = await setup({
      confirmEmail: true,
      confirmationExpiresIn: 60,
      retention: { sweepInterval: 30 },
    });
    await join("ada@example.com");
    await later(61_000, async () => {
      await auth.api.getWaitlistStats({ headers: adminHeaders });
      // The cleanup runs in the background.
      await vi.waitFor(async () => expect(await entryFor("ada@example.com")).toBeUndefined());
    });
  });

  it("cleans up at most once per sweepInterval", async () => {
    const { auth, context, join, adminHeaders } = await setup();
    const deleteMany = vi.spyOn(context.adapter, "deleteMany");
    const stats = () => auth.api.getWaitlistStats({ headers: adminHeaders });
    await join("ada@example.com");
    await stats();
    await stats();
    // `setup`'s admin requests may have swept already; none since.
    const calls = deleteMany.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(1);
    await later(3601_000, stats);
    await vi.waitFor(() => expect(deleteMany.mock.calls.length).toBe(calls + 1));
  });

  it("deletes rejected and registered entries after their retention", async () => {
    const { auth, join, approve, signUp, entryFor, adminHeaders } = await setup({
      retention: { rejected: 30, registered: 10 },
    });
    for (const name of ["ada", "bob", "carol"]) await join(`${name}@example.com`);
    const ada = present(await entryFor("ada@example.com"), "entry");
    await auth.api.rejectWaitlistEntry({ body: { id: ada.id }, headers: adminHeaders });
    await approve("bob@example.com");
    await signUp("bob@example.com");

    const cleanUp = () => auth.api.deleteExpiredWaitlistEntries();
    await expect(cleanUp()).resolves.toEqual({ deleted: 0 });
    await expect(later(11 * DAY, cleanUp)).resolves.toEqual({ deleted: 1 });
    expect(await entryFor("bob@example.com")).toBeUndefined();
    await expect(later(31 * DAY, cleanUp)).resolves.toEqual({ deleted: 1 });
    expect(await entryFor("ada@example.com")).toBeUndefined();
    // Still waiting: never deleted.
    expect((await entryFor("carol@example.com"))?.status).toBe("pending");
  });

  it("keeps rejected and registered entries without retention", async () => {
    const { auth, join, approve, signUp, entryFor, adminHeaders } = await setup();
    await join("ada@example.com");
    await join("bob@example.com");
    const ada = present(await entryFor("ada@example.com"), "entry");
    await auth.api.rejectWaitlistEntry({ body: { id: ada.id }, headers: adminHeaders });
    await approve("bob@example.com");
    await signUp("bob@example.com");
    await expect(later(1000 * DAY, () => auth.api.deleteExpiredWaitlistEntries())).resolves.toEqual(
      { deleted: 0 },
    );
    expect((await entryFor("ada@example.com"))?.status).toBe("rejected");
    expect((await entryFor("bob@example.com"))?.status).toBe("registered");
  });

  it("counts the expired unconfirmed entries a cron call deletes", async () => {
    const { auth, join, entryFor } = await setup({ confirmEmail: true, confirmationExpiresIn: 60 });
    await join("ada@example.com");
    await join("bob@example.com");
    await expect(auth.api.deleteExpiredWaitlistEntries()).resolves.toEqual({ deleted: 0 });
    await expect(later(61_000, () => auth.api.deleteExpiredWaitlistEntries())).resolves.toEqual({
      deleted: 2,
    });
    expect(await entryFor("ada@example.com")).toBeUndefined();
  });
});

describe("callbacks", () => {
  it("log errors without changing the response", async () => {
    const failure = new Error("mail service down");
    const { context, join, approve } = await setup({
      onJoin: () => {
        throw failure;
      },
      sendInvite: () => {
        throw failure;
      },
    });
    const logError = vi.spyOn(context.logger, "error").mockImplementation(() => {});

    await expect(join("ada@example.com")).resolves.toEqual({ success: true });
    await expect(approve("ada@example.com")).resolves.toMatchObject({ status: "approved" });
    expect(logError).toHaveBeenCalledWith("[waitlist] onJoin threw an error", failure);
    expect(logError).toHaveBeenCalledWith("[waitlist] sendInvite threw an error", failure);
  });

  it("log sendConfirmationEmail errors without changing the response", async () => {
    const failure = new Error("mail service down");
    const { context, join, entryFor } = await setup({
      confirmEmail: true,
      sendConfirmationEmail: () => {
        throw failure;
      },
    });
    const logError = vi.spyOn(context.logger, "error").mockImplementation(() => {});
    await expect(join("ada@example.com")).resolves.toEqual({ success: true });
    expect((await entryFor("ada@example.com"))?.status).toBe("unconfirmed");
    expect(logError).toHaveBeenCalledWith(
      "[waitlist] sendConfirmationEmail threw an error",
      failure,
    );
  });
});

describe("rate limits", () => {
  it("limit the public endpoints to 5 requests a minute", async () => {
    const { client } = await getTestInstance(
      {
        rateLimit: { enabled: true },
        advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
        plugins: [waitlist({ confirmEmail: false })],
      },
      { disableTestUser: true, clientOptions: { plugins: [waitlistClient()] } },
    );
    const headers = { "x-forwarded-for": "203.0.113.7" };
    const statuses: (number | undefined)[] = [];
    for (let i = 0; i < 6; i++) {
      const { error } = await client.waitlist.join({ email: `user${i}@example.com` }, { headers });
      statuses.push(error?.status);
    }
    expect(statuses).toEqual([undefined, undefined, undefined, undefined, undefined, 429]);
  });
});

describe("client", () => {
  it("calls the public and admin endpoints", async () => {
    const { client, adminHeaders } = await setup();
    const joined = await client.waitlist.join({ email: "ada@example.com" });
    expect(joined.data).toEqual({ success: true });

    const checked = await client.waitlist.checkInvite({ query: { code: "nope" } });
    expect(checked.data).toEqual({ valid: false });

    const listed = await client.waitlist.listEntries({
      query: { status: "pending" },
      fetchOptions: { headers: adminHeaders },
    });
    expect(listed.data?.total).toBe(1);

    const approved = await client.waitlist.approveEntries({ count: 1 }, { headers: adminHeaders });
    expect(approved.data?.entries[0]?.status).toBe("approved");
  });

  it("confirms, shows the status, and leaves with a token", async () => {
    const { client, confirmations } = await setup({ confirmEmail: true });
    await client.waitlist.join({ email: "ada@example.com" });
    const token = present(confirmations[0], "confirmation").token;

    expect((await client.waitlist.confirm({ token })).data).toEqual({ success: true });
    expect((await client.waitlist.getStatus({ query: { token } })).data).toMatchObject({
      status: "pending",
      position: 1,
    });
    expect((await client.waitlist.leave({ token })).data).toEqual({ success: true });
    const { error } = await client.waitlist.getStatus({ query: { token } });
    expect(error?.code).toBe("INVALID_TOKEN");
  });

  it("returns error codes", async () => {
    const { client } = await setup();
    const { error } = await client.waitlist.getStats();
    expect(error?.status).toBe(401);
  });
});

describe("findAll on this database", () => {
  it("reads every row page by page, after the last id", async () => {
    const { context } = await setup();
    for (let i = 0; i < 25; i++) {
      await context.adapter.create({
        model: "waitlistEntry",
        data: {
          email: `person-${i}@example.com`,
          status: "pending",
          tokenHash: `token-hash-${i}`,
          confirmationsSent: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    const rows = await findAll<{ id: string; email: string }>(
      context.adapter,
      { model: "waitlistEntry", where: [{ field: "status", value: "pending" }] },
      7,
    );
    expect(rows).toHaveLength(25);
    expect(new Set(rows.map((row) => row.email)).size).toBe(25);
  });
});

describe("deleted users", () => {
  it("deletes a deleted user's waitlist entry, which holds their email", async () => {
    const { context, join, approve, signUp, entryFor } = await setup();
    await join("ada@example.com");
    await approve("ada@example.com");
    const { user } = await signUp("ada@example.com");
    expect(await entryFor("ada@example.com")).toMatchObject({ status: "registered" });

    await context.internalAdapter.deleteUser(user.id);

    expect(
      await context.adapter.count({
        model: "waitlistEntry",
        where: [{ field: "email", value: "ada@example.com" }],
      }),
    ).toBe(0);
  });
});
