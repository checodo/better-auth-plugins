import { getTestInstance } from "better-auth/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authentication } from "../src/index";
import { resolveProviders } from "../src/options";
import { isValidEmailDomain, placeholderEmail } from "../src/utils/email";
import { cookiesFrom, setup } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const epic = { clientId: "id", clientSecret: "secret" };

describe("options", () => {
  it("throws on invalid static configuration", () => {
    expect(() => resolveProviders({})).toThrow(/at least one provider/);
    expect(() => resolveProviders({ epic: { clientId: "", clientSecret: "x" } })).toThrow(
      /epic.clientId/,
    );
    expect(() => resolveProviders({ xbox: { clientId: "x", clientSecret: "" } })).toThrow(
      /xbox.clientSecret/,
    );
    expect(() => resolveProviders({ steam: { apiKey: " " } })).toThrow(/apiKey/);
    expect(() => resolveProviders({ steam: { emailDomain: "not a domain" } })).toThrow(
      /emailDomain/,
    );
    expect(() =>
      resolveProviders({
        steam: { emailDomain: "players.invalid" },
        epic: { ...epic, emailDomain: "players.invalid" },
      }),
    ).toThrow(/email domain of its own/);
  });

  it("builds placeholder emails on valid domains", () => {
    expect(placeholderEmail("ABC123", "steam.invalid")).toBe("abc123@steam.invalid");
    expect(isValidEmailDomain("players.example.com")).toBe(true);
    expect(isValidEmailDomain("localhost")).toBe(false);
  });
});

describe("providers", () => {
  it("are registered like built-in social providers, next to them", async () => {
    const { auth } = await getTestInstance(
      {
        socialProviders: { github: { clientId: "gh", clientSecret: "gh" } },
        plugins: [authentication({ steam: {}, epic, xbox: epic })],
      },
      { disableTestUser: true },
    );
    for (const provider of ["steam", "epic", "xbox", "github"]) {
      const { url } = await auth.api.signInSocial({ body: { provider, callbackURL: "/" } });
      expect(url).toBeTruthy();
    }
  });

  it("can be started from the client with signIn.social", async () => {
    const { client } = await setup({ steam: {} });
    const { data } = await client.signIn.social({
      provider: "steam",
      callbackURL: "/dashboard",
      disableRedirect: true,
    });
    expect(data?.url).toContain("steamcommunity.com/openid/login");
  });
});

describe("placeholder email domains", () => {
  it("can't be used to sign up with a password", async () => {
    const { auth } = await setup({ steam: {} }, { emailAndPassword: { enabled: true } });
    await expect(
      auth.api.signUpEmail({
        body: {
          email: "76561197960287930@steam.invalid",
          password: "password1234",
          name: "Mallory",
        },
      }),
    ).rejects.toMatchObject({ body: { code: "EMAIL_DOMAIN_RESERVED" } });
  });

  it("can't be taken by changing an email", async () => {
    const { auth } = await setup(
      { steam: { emailDomain: "players.example.com" } },
      {
        emailAndPassword: { enabled: true },
        user: { changeEmail: { enabled: true, updateEmailWithoutVerification: true } },
      },
    );
    const result = await auth.api.signUpEmail({
      body: { email: "mallory@example.com", password: "password1234", name: "Mallory" },
      returnHeaders: true,
    });
    const headers = new Headers({ cookie: cookiesFrom(result.headers) });
    await expect(
      auth.api.changeEmail({
        body: { newEmail: "76561197960287930@players.example.com" },
        headers,
      }),
    ).rejects.toMatchObject({ body: { code: "EMAIL_DOMAIN_RESERVED" } });
  });

  it("can still be used by server code outside a request", async () => {
    const { context } = await setup({ steam: {} });
    await expect(
      context.internalAdapter.createUser(
        { email: "imported@steam.invalid", name: "Imported" },
        { method: "admin" },
      ),
    ).resolves.toMatchObject({ email: "imported@steam.invalid" });
  });
});
