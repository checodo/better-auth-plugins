import { blocklist } from "@checodo/better-auth-blocklist";
import { referral } from "@checodo/better-auth-referral";
import { waitlist } from "@checodo/better-auth-waitlist";
import { admin, testUtils } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import type { AuditEvent, AuditLogOptions } from "../src/index";
import { auditLog, memoryStorage } from "../src/index";

const PASSWORD = "password1234";

/**
 * The audit log with this repository's other plugins, which record their
 * events through `getPlugin("audit-log")?.recordEvent`.
 */
async function setup(options: AuditLogOptions = {}) {
  const storage = memoryStorage();
  const { auth } = await getTestInstance(
    {
      plugins: [
        blocklist({ email: { domains: ["blocked.test"] } }),
        waitlist({ confirmEmail: false, allow: ["example.com"] }),
        referral({ steps: ["first-purchase"] }),
        admin(),
        testUtils(),
        auditLog({ storage, ...options }),
      ],
    },
    { disableTestUser: true },
  );
  const context = await auth.$context;
  const { test } = context;
  const createUser = async (email: string, role?: string) => {
    const user = await test.saveUser(test.createUser({ email, ...(role ? { role } : {}) }));
    return { user, headers: await test.getAuthHeaders({ userId: user.id }) };
  };
  const events = (type: string): AuditEvent[] =>
    storage.events.filter((event) => event.type === type);
  return { auth, context, createUser, events, storage };
}

describe("blocklist", () => {
  it("records a blocked sign-up, without a user", async () => {
    const { auth, events } = await setup();
    await expect(
      auth.api.signUpEmail({
        body: { email: "eve@blocked.test", password: PASSWORD, name: "Eve" },
      }),
    ).rejects.toThrow();

    expect(events("blocklist.blocked")).toEqual([
      expect.objectContaining({
        status: "failure",
        severity: "medium",
        userId: null,
        actorUserId: null,
        errorCode: "EMAIL_NOT_ALLOWED",
        metadata: {
          target: "email",
          value: "eve@blocked.test",
          rule: { type: "domain", value: "blocked.test" },
        },
      }),
    ]);
  });

  it("never records a blocked password, not even as the matched rule's value", async () => {
    // The blocklist stores the attempt under `value` and `rule.value`,
    // which the key-based redaction can't recognize as secrets: the
    // blocklist has to redact them itself.
    const storage = memoryStorage();
    const { auth } = await getTestInstance(
      {
        plugins: [
          blocklist({
            password: { values: ["password123", { value: "hunter", type: "contains" }] },
          }),
          auditLog({ storage }),
        ],
      },
      { disableTestUser: true },
    );
    // The last one contains the email's local part, for the context check,
    // which ignores words shorter than four characters.
    const attempts = ["password123", "Hunter-and-more", "jane-2024!"];
    for (const password of attempts) {
      await expect(
        auth.api.signUpEmail({ body: { email: "jane@example.com", password, name: "Jane" } }),
      ).rejects.toThrow();
    }

    const blocked = storage.events.filter((event) => event.type === "blocklist.blocked");
    expect(blocked.map((event) => event.metadata)).toEqual([
      { target: "password", value: "[redacted]", rule: { type: "exact", value: "[redacted]" } },
      { target: "password", value: "[redacted]", rule: { type: "contains", value: "[redacted]" } },
      // The context check names where the word came from, not the password.
      { target: "password", value: "[redacted]", rule: { type: "contains", value: "[email]" } },
    ]);
    // Nothing anywhere in the log, in any event, contains an attempt.
    const stored = JSON.stringify(storage.events).toLowerCase();
    for (const secret of ["password123", "hunter", "jane-2024"]) {
      expect(stored).not.toContain(secret);
    }
  });

  it("records rules an admin creates and deletes", async () => {
    const { auth, createUser, events } = await setup();
    const { user: root, headers } = await createUser("root@example.com", "admin");
    const { rule } = await auth.api.createBlocklistRule({
      body: { target: "username", value: "Root", type: "exact" },
      headers,
    });
    await auth.api.deleteBlocklistRule({ body: { id: rule.id }, headers });

    const expected = { ruleId: rule.id, target: "username", type: "exact", value: "root" };
    expect(events("blocklist.rule-created")).toEqual([
      expect.objectContaining({ actorUserId: root.id, severity: "high", metadata: expected }),
    ]);
    expect(events("blocklist.rule-deleted")).toEqual([
      expect.objectContaining({ actorUserId: root.id, metadata: expected }),
    ]);
  });
});

describe("waitlist", () => {
  it("records approvals, rejections, and deletions by an admin", async () => {
    const { auth, createUser, events } = await setup();
    const { user: root, headers } = await createUser("root@example.com", "admin");
    await auth.api.joinWaitlist({ body: { email: "ada@elsewhere.test" } });
    await auth.api.joinWaitlist({ body: { email: "bob@elsewhere.test" } });
    const { entries } = await auth.api.listWaitlistEntries({ query: {}, headers });
    const [ada, bob] = ["ada", "bob"].map((name) =>
      entries.find((entry) => entry.email.startsWith(name)),
    );

    await auth.api.approveWaitlistEntries({ body: { ids: [ada?.id as string] }, headers });
    await auth.api.rejectWaitlistEntry({ body: { id: bob?.id as string }, headers });
    await auth.api.deleteWaitlistEntry({ body: { id: bob?.id as string }, headers });

    expect(events("waitlist.approved")).toEqual([
      expect.objectContaining({
        actorUserId: root.id,
        metadata: { entryId: ada?.id, email: "ada@elsewhere.test", renewed: false },
      }),
    ]);
    expect(events("waitlist.rejected")[0]).toMatchObject({ actorUserId: root.id });
    expect(events("waitlist.entry-deleted")[0]).toMatchObject({
      actorUserId: root.id,
      metadata: { email: "bob@elsewhere.test", status: "rejected" },
    });
    // The invite code never reaches the log.
    expect(JSON.stringify(events("waitlist.approved"))).not.toContain("inviteCode");
  });

  it("records confirmations and people leaving, without an actor", async () => {
    const storage = memoryStorage();
    const tokens: string[] = [];
    const { auth } = await getTestInstance(
      {
        plugins: [
          waitlist({ sendConfirmationEmail: ({ token }) => void tokens.push(token) }),
          auditLog({ storage }),
        ],
      },
      { disableTestUser: true },
    );
    await auth.api.joinWaitlist({ body: { email: "ada@elsewhere.test" } });
    const [token] = tokens as [string];
    await auth.api.confirmWaitlistEmail({ body: { token } });
    await auth.api.confirmWaitlistEmail({ body: { token } });
    await auth.api.leaveWaitlist({ body: { token } });

    const of = (type: string) => storage.events.filter((event) => event.type === type);
    expect(of("waitlist.confirmed")).toEqual([
      expect.objectContaining({
        userId: null,
        actorUserId: null,
        severity: "low",
        metadata: { entryId: expect.any(String), email: "ada@elsewhere.test" },
      }),
    ]);
    expect(of("waitlist.left")).toEqual([
      expect.objectContaining({
        actorUserId: null,
        severity: "low",
        metadata: expect.objectContaining({ email: "ada@elsewhere.test", status: "pending" }),
      }),
    ]);
  });

  it("records leaving once when the link is opened twice at once", async () => {
    const storage = memoryStorage();
    const tokens: string[] = [];
    const { auth } = await getTestInstance(
      {
        plugins: [
          waitlist({ confirmEmail: false, onJoin: ({ token }) => void tokens.push(token) }),
          auditLog({ storage }),
        ],
      },
      { disableTestUser: true },
    );
    await auth.api.joinWaitlist({ body: { email: "ada@elsewhere.test" } });
    const [token] = tokens as [string];
    // Both requests find the entry before either deletes it.
    const { adapter } = await auth.$context;
    const deleteMany = adapter.deleteMany.bind(adapter);
    vi.spyOn(adapter, "deleteMany").mockImplementation(async (data) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return deleteMany(data);
    });
    const answers = await Promise.all([
      auth.api.leaveWaitlist({ body: { token } }),
      auth.api.leaveWaitlist({ body: { token } }),
    ]);
    expect(answers).toEqual([{ success: true }, { success: true }]);
    expect(storage.events.filter((event) => event.type === "waitlist.left")).toHaveLength(1);
  });

  it("records an automatic approval without an actor", async () => {
    const storage = memoryStorage();
    const { auth } = await getTestInstance(
      {
        plugins: [waitlist({ confirmEmail: false, autoApprove: true }), auditLog({ storage })],
      },
      { disableTestUser: true },
    );
    await auth.api.joinWaitlist({ body: { email: "ada@elsewhere.test" } });
    expect(storage.events.filter((event) => event.type === "waitlist.approved")).toEqual([
      expect.objectContaining({
        actorUserId: null,
        metadata: expect.objectContaining({ email: "ada@elsewhere.test" }),
      }),
    ]);
  });
});

describe("referral", () => {
  it("records a referral, and its completion for the referrer", async () => {
    const { auth, createUser, events } = await setup();
    const { user: ada, headers } = await createUser("ada@example.com");
    const { code } = await auth.api.createReferralCode({ headers });
    const { user: bob } = await auth.api.signUpEmail({
      body: { email: "bob@example.com", password: PASSWORD, name: "Bob" },
      headers: new Headers({ "x-referral-code": code }),
    });

    expect(events("referral.created")).toEqual([
      expect.objectContaining({
        userId: bob.id,
        actorUserId: bob.id,
        metadata: expect.objectContaining({ referrerUserId: ada.id, code }),
      }),
    ]);
    expect(events("referral.completed")).toEqual([]);

    await auth.api.completeReferralStep({ body: { userId: bob.id, step: "first-purchase" } });
    await auth.api.completeReferralStep({ body: { userId: bob.id, step: "first-purchase" } });
    expect(events("referral.completed")).toEqual([
      expect.objectContaining({
        userId: ada.id,
        severity: "medium",
        metadata: expect.objectContaining({ referredUserId: bob.id }),
      }),
    ]);
  });
});

describe("referral rewards", () => {
  /** A referred user with one step left, with `onReferralCompleted` always failing. */
  async function failingReward(maxAttempts: number) {
    const storage = memoryStorage();
    const { auth } = await getTestInstance(
      {
        plugins: [
          referral({
            steps: ["first-purchase"],
            onReferralCompleted: () => {
              throw new Error("reward service down");
            },
            rewardRetry: { delay: 60_000, maxAttempts },
          }),
          testUtils(),
          auditLog({ storage }),
        ],
      },
      { disableTestUser: true },
    );
    const context = await auth.$context;
    vi.spyOn(context.logger, "error").mockImplementation(() => {});
    const ada = await context.test.saveUser(context.test.createUser({ email: "ada@example.com" }));
    const { code } = await auth.api.createReferralCode({
      headers: await context.test.getAuthHeaders({ userId: ada.id }),
    });
    const { user: bob } = await auth.api.signUpEmail({
      body: { email: "bob@example.com", password: PASSWORD, name: "Bob" },
      headers: new Headers({ "x-referral-code": code }),
    });
    const finish = () =>
      auth.api.completeReferralStep({ body: { userId: bob.id, step: "first-purchase" } });
    /** Retries with `Date` moved `minutes` ahead. */
    const retryLater = async (minutes: number, times = 1) => {
      vi.useFakeTimers({ now: Date.now() + minutes * 60_000, toFake: ["Date"] });
      try {
        await Promise.all(Array.from({ length: times }, () => auth.api.retryReferralRewards({})));
      } finally {
        vi.useRealTimers();
      }
    };
    const failed = () => storage.events.filter((event) => event.type === "referral.reward-failed");
    return { ada, bob, finish, retryLater, failed };
  }

  it("records a reward that failed for the last time, for the referrer", async () => {
    const { ada, bob, finish, failed } = await failingReward(1);
    await finish();
    expect(failed()).toEqual([
      expect.objectContaining({
        status: "failure",
        severity: "high",
        userId: ada.id,
        actorUserId: null,
        metadata: expect.objectContaining({ referredUserId: bob.id, attempts: 1 }),
      }),
    ]);
  });

  it("records nothing while attempts are left, and once after the last retry", async () => {
    const { finish, retryLater, failed } = await failingReward(3);
    await finish();
    await retryLater(2);
    expect(failed()).toEqual([]);
    // The last attempt, from concurrent retries, then nothing left to retry.
    await retryLater(4, 3);
    await retryLater(6);
    expect(failed()).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ attempts: 3 }) }),
    ]);
  });
});

describe("options", () => {
  it("apply to events from other plugins", async () => {
    const { auth, events } = await setup({ events: ["sign-up"] });
    await auth.api
      .signUpEmail({ body: { email: "eve@blocked.test", password: PASSWORD, name: "Eve" } })
      .catch(() => {});
    expect(events("blocklist.blocked")).toEqual([]);
  });
});
