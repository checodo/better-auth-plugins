import { admin, magicLink, testUtils } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import { referralClient } from "../src/client";
import type { Referral, ReferralOptions } from "../src/index";
import { referral } from "../src/index";
import { claimReferralPlace } from "../src/referrals";
import { CODE_ALPHABET } from "../src/utils/code";

const PASSWORD = "password1234";

/**
 * A fresh auth instance with the referral plugin, the admin plugin, and
 * the magic link plugin (a sign-up path other than `/sign-up/email`).
 */
async function setup(options: ReferralOptions = {}) {
  const magicLinks: { email: string; token: string }[] = [];
  const { auth, client } = await getTestInstance(
    {
      plugins: [
        referral(options),
        admin(),
        magicLink({
          sendMagicLink: ({ email, token }) => {
            magicLinks.push({ email, token });
          },
        }),
        testUtils(),
      ],
    },
    { disableTestUser: true, clientOptions: { plugins: [referralClient()] } },
  );
  const context = await auth.$context;
  const { test } = context;

  /** A saved user with session headers, optionally with a role. */
  const createUser = async (email: string, role?: string) => {
    const user = await test.saveUser(test.createUser({ email, ...(role ? { role } : {}) }));
    return { user, headers: await test.getAuthHeaders({ userId: user.id }) };
  };
  /** A user with a referral code. */
  const referrer = async (email = "ada@example.com") => {
    const { user, headers } = await createUser(email);
    const { code } = await auth.api.createReferralCode({ headers });
    return { user, headers, code };
  };
  const signUp = (email: string, extra: Record<string, unknown> = {}, headers?: Headers) =>
    auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: email.split("@")[0] ?? "user", ...extra },
      ...(headers ? { headers } : {}),
    });
  const referralOf = (userId: string) =>
    context.adapter.findOne<Referral>({
      model: "referral",
      where: [{ field: "referredUserId", value: userId }],
    });

  return { auth, client, context, test, magicLinks, createUser, referrer, signUp, referralOf };
}

async function expectError(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toMatchObject({ statusCode: status, body: { code } });
}

describe("codes", () => {
  it("creates a code once and returns it again", async () => {
    const { auth, createUser } = await setup();
    const { headers } = await createUser("ada@example.com");
    expect(await auth.api.getReferralCode({ headers })).toEqual({ code: null });

    const { code } = await auth.api.createReferralCode({ headers });
    expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{8}$`));
    expect(await auth.api.createReferralCode({ headers })).toEqual({ code });
    expect(await auth.api.getReferralCode({ headers })).toEqual({ code });
  });

  it("gives every user a different code", async () => {
    const { referrer } = await setup();
    const ada = await referrer("ada@example.com");
    const bob = await referrer("bob@example.com");
    expect(ada.code).not.toBe(bob.code);
  });

  it("uses codeLength", async () => {
    const { referrer } = await setup({ codeLength: 12 });
    expect((await referrer()).code).toHaveLength(12);
  });

  it("creates codes on sign-up with createCodeOnSignUp", async () => {
    const { auth, signUp } = await setup({ createCodeOnSignUp: true });
    const { token } = await signUp("ada@example.com");
    const headers = new Headers({ authorization: `Bearer ${token}` });
    const { code } = await auth.api.getReferralCode({ headers });
    expect(code).toHaveLength(8);
  });

  it("stores custom codes in uppercase and retries collisions", async () => {
    const codes = ["vip-ada", "vip-ada", "vip-bob"];
    const { referrer } = await setup({ generateCode: () => codes.shift() ?? "unused" });
    expect((await referrer("ada@example.com")).code).toBe("VIP-ADA");
    expect((await referrer("bob@example.com")).code).toBe("VIP-BOB");
  });

  it("gives up after repeated collisions", async () => {
    const { auth, referrer, createUser } = await setup({ generateCode: () => "SAME" });
    await referrer("ada@example.com");
    const { headers } = await createUser("bob@example.com");
    await expectError(auth.api.createReferralCode({ headers }), 500, "CODE_GENERATION_FAILED");
  });

  it("rejects malformed custom codes", async () => {
    const { auth, createUser } = await setup({ generateCode: () => "has spaces" });
    const { headers } = await createUser("ada@example.com");
    await expect(auth.api.createReferralCode({ headers })).rejects.toThrow(/generateCode/);
  });

  it("regenerates a code; the old one stops working, its referrals stay", async () => {
    const { auth, referrer, signUp, referralOf } = await setup({ steps: [] });
    const ada = await referrer();
    const bob = await signUp("bob@example.com", { referralCode: ada.code });

    const { code } = await auth.api.regenerateReferralCode({ headers: ada.headers });
    expect(code).not.toBe(ada.code);
    expect(await auth.api.getReferralCode({ headers: ada.headers })).toEqual({ code });
    expect(await auth.api.checkReferralCode({ query: { code: ada.code } })).toEqual({
      valid: false,
    });
    expect((await referralOf(bob.user.id))?.code).toBe(ada.code);

    const carol = await signUp("carol@example.com", { referralCode: code });
    expect((await referralOf(carol.user.id))?.referrerUserId).toBe(ada.user.id);
  });

  it("creates a code on regenerate when there is none yet", async () => {
    const { auth, createUser } = await setup();
    const { headers } = await createUser("ada@example.com");
    const { code } = await auth.api.regenerateReferralCode({ headers });
    expect(await auth.api.getReferralCode({ headers })).toEqual({ code });
  });

  it("requires a session", async () => {
    const { auth } = await setup();
    await expect(auth.api.createReferralCode({ headers: new Headers() })).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

describe("check-code", () => {
  it("says whether a code is usable, ignoring case and spaces", async () => {
    const { auth, referrer } = await setup();
    const { code } = await referrer();
    const check = (value: string) => auth.api.checkReferralCode({ query: { code: value } });
    expect(await check(` ${code.toLowerCase()} `)).toEqual({ valid: true });
    expect(await check("NOPE1234")).toEqual({ valid: false });
    expect(await check("not a code!")).toEqual({ valid: false });
  });

  it("reports codes that reached maxReferralsPerUser as invalid", async () => {
    const { auth, referrer, signUp } = await setup({ maxReferralsPerUser: 1 });
    const { code } = await referrer();
    await signUp("bob@example.com", { referralCode: code });
    expect(await auth.api.checkReferralCode({ query: { code } })).toEqual({ valid: false });
  });
});

describe("attribution", () => {
  it("records a referral from the sign-up body", async () => {
    const onReferral = vi.fn();
    const onReferralCompleted = vi.fn();
    const { referrer, signUp, referralOf } = await setup({ onReferral, onReferralCompleted });
    const ada = await referrer();

    const { user } = await signUp("bob@example.com", {
      referralCode: ` ${ada.code.toLowerCase()}`,
    });
    const stored = await referralOf(user.id);
    expect(stored).toMatchObject({
      referrerUserId: ada.user.id,
      referredUserId: user.id,
      code: ada.code,
      status: "completed",
    });
    expect(onReferral).toHaveBeenCalledWith(expect.objectContaining({ id: stored?.id }));
    expect(onReferralCompleted).toHaveBeenCalledOnce();
  });

  it("reads the x-referral-code header", async () => {
    const { referrer, signUp, referralOf } = await setup();
    const ada = await referrer();
    const { user } = await signUp(
      "bob@example.com",
      {},
      new Headers({ "x-referral-code": ada.code }),
    );
    expect((await referralOf(user.id))?.referrerUserId).toBe(ada.user.id);
  });

  it("works for sign-up paths other than email, like magic links", async () => {
    const { auth, referrer, magicLinks, referralOf } = await setup();
    const ada = await referrer();
    await auth.api.signInMagicLink({ body: { email: "bob@example.com" }, headers: new Headers() });
    const link = magicLinks.at(-1);
    const result = await auth.api.magicLinkVerify({
      query: { token: link?.token ?? "" },
      headers: new Headers({ "x-referral-code": ada.code }),
    });
    expect((await referralOf(result.user.id))?.referrerUserId).toBe(ada.user.id);
  });

  it("ignores unknown codes by default", async () => {
    const { signUp, referralOf } = await setup();
    const { user } = await signUp("bob@example.com", { referralCode: "NOPE1234" });
    expect(await referralOf(user.id)).toBeNull();
  });

  it("rejects the sign-up for unknown codes with invalidCode: reject", async () => {
    const { auth, signUp, context } = await setup({ invalidCode: "reject" });
    await expectError(
      signUp("bob@example.com", { referralCode: "NOPE1234" }),
      400,
      "INVALID_REFERRAL_CODE",
    );
    expect(await context.internalAdapter.findUserByEmail("bob@example.com")).toBeNull();
    // Signing up without a code still works.
    await expect(signUp("bob@example.com")).resolves.toBeTruthy();
    expect(auth).toBeTruthy();
  });

  it("stops at maxReferralsPerUser", async () => {
    const { referrer, signUp, referralOf } = await setup({ maxReferralsPerUser: 1 });
    const { code } = await referrer();
    const first = await signUp("bob@example.com", { referralCode: code });
    const second = await signUp("carol@example.com", { referralCode: code });
    expect(await referralOf(first.user.id)).not.toBeNull();
    expect(await referralOf(second.user.id)).toBeNull();
  });

  it("holds maxReferralsPerUser when sign-ups race for the last place", async () => {
    // Another sign-up with the same code is recorded after this one passed
    // the code check (both saw a free place). Its referral, not settled
    // yet, takes up the place, so this one doesn't get it.
    let race: (() => Promise<void>) | undefined;
    const onReferral = vi.fn();
    const { context, referrer, signUp, referralOf, createUser } = await setup({
      maxReferralsPerUser: 1,
      onReferral,
      allowReferral: async () => {
        await race?.();
        return true;
      },
    });
    const ada = await referrer();
    const carol = await createUser("carol@example.com");
    race = async () => {
      race = undefined;
      await context.adapter.create({
        model: "referral",
        data: {
          referrerUserId: ada.user.id,
          referredUserId: carol.user.id,
          code: ada.code,
          status: "completed",
          completedAt: new Date(),
          createdAt: new Date(Date.now() - 1000),
        },
      });
    };

    const bob = await signUp("bob@example.com", { referralCode: ada.code });
    expect(await referralOf(bob.user.id)).toBeNull();
    expect(await referralOf(carol.user.id)).not.toBeNull();
    expect(onReferral).not.toHaveBeenCalled();
  });

  it("holds maxReferralsPerUser when transactions commit out of order", async () => {
    // Two sign-ups: the earlier one's transaction commits after the later
    // one has settled. Counting the referrals made earlier kept both.
    const { context, referrer, createUser } = await setup({ maxReferralsPerUser: 1 });
    const ada = await referrer();
    const make = async (email: string, createdAt: Date) => {
      const { user } = await createUser(email);
      return context.adapter.create<Omit<Referral, "id">, Referral>({
        model: "referral",
        data: {
          referrerUserId: ada.user.id,
          referredUserId: user.id,
          code: ada.code,
          status: "pending",
          completedAt: null,
          createdAt,
        },
      });
    };
    const started = new Date(Date.now() - 1000);
    const later = await make("carol@example.com", new Date());
    expect(await claimReferralPlace(context.adapter, 1, later)).toBe(true);
    // The earlier sign-up's row only becomes visible now.
    const earlier = await make("bob@example.com", started);
    expect(await claimReferralPlace(context.adapter, 1, earlier)).toBe(false);
    expect(await context.adapter.count({ model: "referralSlot" })).toBe(1);
  });

  it("gives exactly maxReferralsPerUser places to referrals settling at once", async () => {
    const { context, referrer, createUser } = await setup({ maxReferralsPerUser: 2 });
    const ada = await referrer();
    const referrals: Referral[] = [];
    for (const name of ["bob", "carol", "dan", "eve", "fay"]) {
      const { user } = await createUser(`${name}@example.com`);
      referrals.push(
        await context.adapter.create<Omit<Referral, "id">, Referral>({
          model: "referral",
          data: {
            referrerUserId: ada.user.id,
            referredUserId: user.id,
            code: ada.code,
            status: "pending",
            completedAt: null,
            createdAt: new Date(),
          },
        }),
      );
    }
    // Each settles as if the others were not visible yet: the only thing
    // keeping them apart is the unique key of the place.
    const claim = (one: Referral) =>
      claimReferralPlace(
        { ...context.adapter, count: async ({ model }) => (model === "referral" ? 1 : 0) },
        2,
        one,
      );
    const kept = await Promise.all(referrals.map(claim));
    expect(kept.filter(Boolean)).toHaveLength(2);
    expect(await context.adapter.count({ model: "referralSlot" })).toBe(2);
  });

  it("counts maxReferralsPerUser across codes: a new code doesn't reset it", async () => {
    const { auth, referrer, signUp, referralOf } = await setup({ maxReferralsPerUser: 1 });
    const ada = await referrer();
    await signUp("bob@example.com", { referralCode: ada.code });
    const { code } = await auth.api.regenerateReferralCode({ headers: ada.headers });
    const carol = await signUp("carol@example.com", { referralCode: code });
    expect(await referralOf(carol.user.id)).toBeNull();
  });

  it("doesn't credit users banned with the admin plugin", async () => {
    const { auth, referrer, signUp, referralOf, createUser } = await setup();
    const ada = await referrer();
    const admin = await createUser("root@example.com", "admin");
    await auth.api.banUser({ body: { userId: ada.user.id }, headers: admin.headers });

    expect(await auth.api.checkReferralCode({ query: { code: ada.code } })).toEqual({
      valid: false,
    });
    const bob = await signUp("bob@example.com", { referralCode: ada.code });
    expect(await referralOf(bob.user.id)).toBeNull();

    await auth.api.unbanUser({ body: { userId: ada.user.id }, headers: admin.headers });
    const carol = await signUp("carol@example.com", { referralCode: ada.code });
    expect(await referralOf(carol.user.id)).not.toBeNull();
  });

  it("credits users again once a temporary ban has expired", async () => {
    const { auth, referrer, createUser } = await setup();
    const ada = await referrer();
    const admin = await createUser("root@example.com", "admin");
    await auth.api.banUser({
      body: { userId: ada.user.id, banExpiresIn: 60 },
      headers: admin.headers,
    });
    const check = () => auth.api.checkReferralCode({ query: { code: ada.code } });
    expect(await check()).toEqual({ valid: false });
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
    try {
      expect(await check()).toEqual({ valid: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets allowReferral skip referrals without failing the sign-up", async () => {
    const allowReferral = vi.fn(
      ({ referredUser }: { referredUser: { email: string } }) =>
        !referredUser.email.endsWith("@spam.test"),
    );
    const { referrer, signUp, referralOf } = await setup({ allowReferral });
    const { code, user: ada } = await referrer();

    const spam = await signUp("bot@spam.test", { referralCode: code });
    const real = await signUp("bob@example.com", { referralCode: code });
    expect(await referralOf(spam.user.id)).toBeNull();
    expect(await referralOf(real.user.id)).not.toBeNull();
    expect(allowReferral).toHaveBeenCalledWith(
      expect.objectContaining({ referrerUserId: ada.id, code }),
    );
  });

  it("skips the referral when allowReferral throws, and logs it", async () => {
    const failure = new Error("fraud service down");
    const { referrer, signUp, referralOf, context } = await setup({
      allowReferral: () => {
        throw failure;
      },
    });
    const logError = vi.spyOn(context.logger, "error").mockImplementation(() => {});
    const { code } = await referrer();
    const { user } = await signUp("bob@example.com", { referralCode: code });
    expect(await referralOf(user.id)).toBeNull();
    expect(logError).toHaveBeenCalledWith("[referral] allowReferral threw an error", failure);
  });

  it("logs callback errors without failing the sign-up", async () => {
    const failure = new Error("reward service down");
    const { referrer, signUp, referralOf, context } = await setup({
      onReferralCompleted: () => {
        throw failure;
      },
    });
    const logError = vi.spyOn(context.logger, "error").mockImplementation(() => {});
    const { code } = await referrer();
    const { user } = await signUp("bob@example.com", { referralCode: code });
    expect((await referralOf(user.id))?.status).toBe("completed");
    expect(logError).toHaveBeenCalledWith("[referral] onReferralCompleted threw an error", failure);
  });
});

describe("steps", () => {
  it("keep a referral pending until every step is done", async () => {
    const onStepCompleted = vi.fn();
    const onReferralCompleted = vi.fn();
    const { auth, referrer, signUp, referralOf } = await setup({
      steps: ["first-purchase", "second-purchase"],
      onStepCompleted,
      onReferralCompleted,
    });
    const { code } = await referrer();
    const { user } = await signUp("bob@example.com", { referralCode: code });
    expect((await referralOf(user.id))?.status).toBe("pending");

    const first = await auth.api.completeReferralStep({
      body: { userId: user.id, step: "first-purchase", metadata: { orderId: "o-1" } },
    });
    expect(first.referral).toMatchObject({ status: "pending", steps: ["first-purchase"] });
    expect(onReferralCompleted).not.toHaveBeenCalled();

    const second = await auth.api.completeReferralStep({
      body: { userId: user.id, step: "second-purchase" },
    });
    expect(second.referral).toMatchObject({
      status: "completed",
      steps: ["first-purchase", "second-purchase"],
      completedAt: expect.any(Date),
    });
    expect(onStepCompleted).toHaveBeenCalledTimes(2);
    expect(onReferralCompleted).toHaveBeenCalledOnce();
  });

  it("count each step once", async () => {
    const onStepCompleted = vi.fn();
    const onReferralCompleted = vi.fn();
    const { auth, referrer, signUp } = await setup({
      steps: ["first-purchase"],
      onStepCompleted,
      onReferralCompleted,
    });
    const { code } = await referrer();
    const { user } = await signUp("bob@example.com", { referralCode: code });
    for (let i = 0; i < 3; i++) {
      await auth.api.completeReferralStep({ body: { userId: user.id, step: "first-purchase" } });
    }
    expect(onStepCompleted).toHaveBeenCalledOnce();
    expect(onReferralCompleted).toHaveBeenCalledOnce();
  });

  it("keep the step metadata as JSON and cap its size", async () => {
    const { auth, referrer, signUp, context } = await setup({ steps: ["first-purchase"] });
    const { code } = await referrer();
    const { user } = await signUp("bob@example.com", { referralCode: code });
    await expectError(
      auth.api.completeReferralStep({
        body: { userId: user.id, step: "first-purchase", metadata: { blob: "x".repeat(3000) } },
      }),
      400,
      "METADATA_TOO_LARGE",
    );
    await auth.api.completeReferralStep({
      body: { userId: user.id, step: "first-purchase", metadata: { orderId: "o-1" } },
    });
    const step = await context.adapter.findOne<{ metadata: string }>({
      model: "referralStep",
      where: [{ field: "step", value: "first-purchase" }],
    });
    expect(step?.metadata).toBe('{"orderId":"o-1"}');
  });

  it("reject steps that aren't configured", async () => {
    const { auth, createUser } = await setup({ steps: ["first-purchase"] });
    const { user } = await createUser("bob@example.com");
    await expectError(
      auth.api.completeReferralStep({ body: { userId: user.id, step: "nope" } }),
      400,
      "UNKNOWN_REFERRAL_STEP",
    );
  });

  it("do nothing for users who weren't referred", async () => {
    const { auth, createUser } = await setup({ steps: ["first-purchase"] });
    const { user } = await createUser("bob@example.com");
    expect(
      await auth.api.completeReferralStep({ body: { userId: user.id, step: "first-purchase" } }),
    ).toEqual({ referral: null });
  });

  it("record email-verified when the referred user's email is verified", async () => {
    const onReferralCompleted = vi.fn();
    const { referrer, signUp, referralOf, context } = await setup({
      steps: ["email-verified"],
      onReferralCompleted,
    });
    const { code } = await referrer();
    const { user } = await signUp("bob@example.com", { referralCode: code });
    expect((await referralOf(user.id))?.status).toBe("pending");

    await context.internalAdapter.updateUser(user.id, { name: "Bob" });
    expect((await referralOf(user.id))?.status).toBe("pending");

    await context.internalAdapter.updateUser(user.id, { emailVerified: true });
    expect((await referralOf(user.id))?.status).toBe("completed");
    await context.internalAdapter.updateUser(user.id, { name: "Bobby" });
    expect(onReferralCompleted).toHaveBeenCalledOnce();
  });

  it("only look for a referral when an update verifies the email", async () => {
    const { referrer, signUp, context, auth } = await setup({ steps: ["email-verified"] });
    const { code } = await referrer();
    const { user } = await signUp("bob@example.com", { referralCode: code });
    await context.internalAdapter.updateUser(user.id, { emailVerified: true });
    const headers = await context.test.getAuthHeaders({ userId: user.id });

    const findOne = vi.spyOn(context.adapter, "findOne");
    await auth.api.updateUser({ body: { name: "Bobby" }, headers });
    const referralLookups = findOne.mock.calls.filter(([query]) => query.model === "referral");
    expect(referralLookups).toEqual([]);
    findOne.mockRestore();
  });

  it("aren't reachable over HTTP", async () => {
    const { client } = await setup({ steps: ["first-purchase"] });
    const { error } = await client.$fetch("/referral/complete-step", {
      method: "POST",
      body: { userId: "x", step: "first-purchase" },
    });
    expect(error?.status).toBe(404);
  });
});

describe("default steps", () => {
  const instance = (
    options: ReferralOptions,
    emailVerification?: { sendVerificationEmail: () => Promise<void> },
  ) => {
    const log = vi.fn();
    return getTestInstance(
      {
        plugins: [referral(options), testUtils()],
        logger: { log },
        ...(emailVerification ? { emailVerification } : {}),
      },
      { disableTestUser: true },
    ).then((result) => ({ ...result, log }));
  };
  const resolvedSteps = async (options: ReferralOptions, sendsVerification: boolean) => {
    const sendVerificationEmail = async () => {};
    const { auth, log } = await instance(
      options,
      sendsVerification ? { sendVerificationEmail } : undefined,
    );
    // The resolved steps show in how a referral starts.
    const context = await auth.$context;
    const ada = await context.test.saveUser(context.test.createUser({ email: "ada@example.com" }));
    const headers = await context.test.getAuthHeaders({ userId: ada.id });
    const { code } = await auth.api.createReferralCode({ headers });
    const { user } = await auth.api.signUpEmail({
      body: { email: "bob@example.com", password: PASSWORD, name: "Bob" },
      headers: new Headers({ "x-referral-code": code }),
    });
    const stored = await context.adapter.findOne<Referral>({
      model: "referral",
      where: [{ field: "referredUserId", value: user.id }],
    });
    return { status: stored?.status, log };
  };

  it("require email-verified when the app sends verification emails", async () => {
    expect((await resolvedSteps({}, true)).status).toBe("pending");
  });

  it("are empty otherwise, so referrals complete at sign-up", async () => {
    expect((await resolvedSteps({}, false)).status).toBe("completed");
  });

  it("never override explicit steps", async () => {
    expect((await resolvedSteps({ steps: [] }, true)).status).toBe("completed");
  });

  it("warn when rewards are paid at sign-up", async () => {
    const { log } = await resolvedSteps({ onReferralCompleted: () => {} }, false);
    expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("fake sign-ups"));

    const quiet = await resolvedSteps({ onReferralCompleted: () => {} }, true);
    expect(quiet.log).not.toHaveBeenCalledWith("warn", expect.stringContaining("fake sign-ups"));

    // An explicit `steps: []` is a choice, not an oversight.
    const chosen = await resolvedSteps({ steps: [], onReferralCompleted: () => {} }, false);
    expect(chosen.log).not.toHaveBeenCalledWith("warn", expect.stringContaining("fake sign-ups"));
  });
});

describe("listing", () => {
  it("shows referrers their own referrals with masked emails", async () => {
    const { auth, referrer, signUp } = await setup({ steps: ["first-purchase"] });
    const ada = await referrer("ada@example.com");
    const other = await referrer("zoe@example.com");
    const bob = await signUp("bob@example.com", { referralCode: ada.code });
    await signUp("carol@example.com", { referralCode: other.code });
    await auth.api.completeReferralStep({ body: { userId: bob.user.id, step: "first-purchase" } });

    const result = await auth.api.listReferrals({ headers: ada.headers });
    expect(result).toEqual({
      referrals: [
        {
          id: expect.any(String),
          status: "completed",
          steps: ["first-purchase"],
          createdAt: expect.any(Date),
          completedAt: expect.any(Date),
          referredUser: { name: "bob", email: "b***@example.com" },
        },
      ],
      total: 1,
      completed: 1,
    });
  });

  it("hides names with hideNames", async () => {
    const { auth, referrer, signUp } = await setup({ hideNames: true });
    const ada = await referrer();
    await signUp("bob@example.com", { referralCode: ada.code });
    const { referrals } = await auth.api.listReferrals({ headers: ada.headers });
    expect(referrals[0]?.referredUser).toEqual({ name: null, email: "b***@example.com" });
  });

  it("shows full emails with maskEmails: false", async () => {
    const { auth, referrer, signUp } = await setup({ maskEmails: false });
    const ada = await referrer();
    await signUp("bob@example.com", { referralCode: ada.code });
    const { referrals } = await auth.api.listReferrals({ headers: ada.headers });
    expect(referrals[0]?.referredUser.email).toBe("bob@example.com");
  });

  it("paginates newest first and filters by status", async () => {
    const { auth, referrer, signUp } = await setup({ steps: ["first-purchase"] });
    const ada = await referrer();
    const start = Date.now();
    for (const [i, name] of ["bob", "carol", "dave"].entries()) {
      vi.useFakeTimers({ now: start + i * 1000, toFake: ["Date"] });
      try {
        await signUp(`${name}@example.com`, { referralCode: ada.code });
      } finally {
        vi.useRealTimers();
      }
    }
    const page = await auth.api.listReferrals({
      query: { limit: 2, offset: 0 },
      headers: ada.headers,
    });
    expect(page.total).toBe(3);
    expect(page.referrals.map((r) => r.referredUser.name)).toEqual(["dave", "carol"]);

    const completed = await auth.api.listReferrals({
      query: { status: "completed" },
      headers: ada.headers,
    });
    expect(completed).toMatchObject({ referrals: [], total: 0, completed: 0 });
  });

  it("lets admins list all referrals, and nobody else", async () => {
    const { auth, referrer, signUp, createUser } = await setup();
    const ada = await referrer("ada@example.com");
    const zoe = await referrer("zoe@example.com");
    await signUp("bob@example.com", { referralCode: ada.code });
    await signUp("carol@example.com", { referralCode: zoe.code });
    const admin = await createUser("root@example.com", "admin");

    const all = await auth.api.listAllReferrals({ headers: admin.headers });
    expect(all.total).toBe(2);
    const filtered = await auth.api.listAllReferrals({
      query: { referrerUserId: ada.user.id },
      headers: admin.headers,
    });
    expect(filtered.referrals.map((r) => r.referrerUserId)).toEqual([ada.user.id]);

    await expectError(
      auth.api.listAllReferrals({ headers: ada.headers }),
      403,
      "YOU_ARE_NOT_ALLOWED_TO_LIST_REFERRALS",
    );
    await expect(auth.api.listAllReferrals({ headers: new Headers() })).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

describe("rate limits", () => {
  it("limit check-code to 5 requests a minute", async () => {
    const { client } = await getTestInstance(
      {
        rateLimit: { enabled: true },
        advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
        plugins: [referral()],
      },
      { disableTestUser: true, clientOptions: { plugins: [referralClient()] } },
    );
    const headers = { "x-forwarded-for": "203.0.113.7" };
    const statuses: (number | undefined)[] = [];
    for (let i = 0; i < 6; i++) {
      const { error } = await client.referral.checkCode({
        query: { code: "NOPE1234" },
        fetchOptions: { headers },
      });
      statuses.push(error?.status);
    }
    expect(statuses).toEqual([undefined, undefined, undefined, undefined, undefined, 429]);
  });
});

describe("client", () => {
  it("calls the endpoints", async () => {
    const { client, createUser, signUp } = await setup();
    const { headers } = await createUser("ada@example.com");
    const fetchOptions = { headers };

    const created = await client.referral.createCode({ fetchOptions });
    const code = created.data?.code ?? "";
    expect(code).toHaveLength(8);
    expect((await client.referral.getCode({ fetchOptions })).data).toEqual({ code });
    expect((await client.referral.checkCode({ query: { code } })).data).toEqual({ valid: true });

    await signUp("bob@example.com", { referralCode: code });
    const listed = await client.referral.listReferrals({ fetchOptions });
    expect(listed.data?.total).toBe(1);

    const { error } = await client.referral.listAllReferrals({ fetchOptions });
    expect(error?.code).toBe("YOU_ARE_NOT_ALLOWED_TO_LIST_REFERRALS");
  });
});
