import { blocklist } from "@checodo/better-auth-blocklist";
import type { BetterAuthOptions } from "better-auth";
import type { GithubProfile } from "better-auth/social-providers";
import { getTestInstance } from "better-auth/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditEvent } from "../src/index";
import { auditLog } from "../src/index";

/**
 * A real social sign-in through better-auth's GitHub provider: the sign-in
 * request, then the callback with the provider's code. GitHub's token
 * endpoint is stubbed and the profile comes from `getUserInfo`, so no
 * network is needed; state, cookies, and the callback endpoint are real.
 */
async function setup(email: string, config: Partial<BetterAuthOptions> = {}) {
  /** Event types sent to a destination. */
  const forwarded: string[] = [];
  const { auth } = await getTestInstance(
    {
      ...config,
      socialProviders: {
        github: {
          clientId: "test-client",
          clientSecret: "test-secret",
          getUserInfo: async () => ({
            user: { name: "Ada", email, emailVerified: true },
            // GitHub's account id; only the fields used here.
            data: { id: "42", login: "ada" } as GithubProfile,
          }),
        },
      },
      // The default storage, a database table: what a rolled-back transaction affects.
      plugins: [
        blocklist({ email: { domains: ["blocked.test"] } }),
        auditLog({
          destinations: [
            {
              name: "test",
              send: (batch) => void forwarded.push(...batch.map((event) => event.type)),
            },
          ],
        }),
      ],
    },
    { disableTestUser: true },
  );

  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.startsWith("https://github.com/login/oauth/access_token")) {
      return Response.json({ access_token: "gh-token", token_type: "bearer", scope: "user:email" });
    }
    return realFetch(input, init);
  });

  /** Signs in with GitHub; returns the callback's response. */
  const signInWithGitHub = async () => {
    const start = await auth.api.signInSocial({
      body: { provider: "github", callbackURL: "/dashboard" },
      returnHeaders: true,
    });
    const state = new URL(start.response.url as string).searchParams.get("state") as string;
    const cookie = start.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    return auth.handler(
      new Request(`http://localhost:3000/api/auth/callback/github?code=gh-code&state=${state}`, {
        headers: { cookie },
      }),
    );
  };
  const context = await auth.$context;
  /** Stored events of `type`, read from the table. */
  const events = async (type: string): Promise<AuditEvent[]> => {
    const rows = await context.adapter.findMany<AuditEvent & { metadata: string | null }>({
      model: "auditEvent",
      where: [{ field: "type", value: type }],
    });
    return rows.map((row) => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    }));
  };
  return { auth, signInWithGitHub, events, forwarded };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("social sign-in", () => {
  it("records the sign-up and sign-in of a new user, with the provider as method", async () => {
    const { auth, signInWithGitHub, events, forwarded } = await setup("ada@example.com");
    const response = await signInWithGitHub();
    expect(response.status).toBe(302);
    await auth.api.flushAuditDestinations();
    expect(forwarded).toEqual(["sign-up", "sign-in"]);
    expect(response.headers.get("location")).toContain("/dashboard");

    const [signUp] = await events("sign-up");
    expect(signUp).toMatchObject({ metadata: { method: "github" } });
    expect(await events("sign-in")).toEqual([
      expect.objectContaining({ userId: signUp?.userId, metadata: { method: "github" } }),
    ]);
    // The GitHub account is part of the sign-up, not a link.
    expect(await events("account-linked")).toEqual([]);
  });

  it("records a returning user's sign-in", async () => {
    const { signInWithGitHub, events } = await setup("ada@example.com");
    await signInWithGitHub();
    await signInWithGitHub();
    expect(await events("sign-up")).toHaveLength(1);
    expect(await events("sign-in")).toHaveLength(2);
  });

  it("records a blocked social sign-up, although its transaction rolls back", async () => {
    const { auth, signInWithGitHub, events, forwarded } = await setup("eve@blocked.test");
    const response = await signInWithGitHub();
    // better-auth redirects to its error page; no user is created.
    expect(response.headers.get("location")).toContain("error");
    expect(await events("sign-up")).toEqual([]);

    await vi.waitFor(async () =>
      expect(await events("blocklist.blocked")).toEqual([
        expect.objectContaining({
          status: "failure",
          metadata: expect.objectContaining({ value: "eve@blocked.test" }),
        }),
      ]),
    );
    // Destinations get committed events only: not the rolled-back sign-up.
    await auth.api.flushAuditDestinations();
    expect(forwarded).toEqual(["blocklist.blocked"]);
  });

  it("neither stores nor forwards a sign-up whose transaction rolls back", async () => {
    // The user is created, then the account fails: the whole sign-up rolls
    // back. better-auth runs after-hooks once the transaction commits.
    const { auth, signInWithGitHub, events, forwarded } = await setup("ada@example.com", {
      databaseHooks: {
        account: {
          create: {
            before: async () => {
              throw new Error("account refused");
            },
          },
        },
      },
    });
    const error = vi.spyOn((await auth.$context).logger, "error").mockImplementation(() => {});
    await signInWithGitHub();
    expect(await events("sign-up")).toEqual([]);
    await auth.api.flushAuditDestinations();
    expect(forwarded).not.toContain("sign-up");
    error.mockRestore();
  });
});
