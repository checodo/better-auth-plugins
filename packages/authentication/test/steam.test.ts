import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTHENTICATION_CALLBACK_ERRORS } from "../src/index";
import { STEAM_OPENID_ENDPOINT, steamAuthorizationURL } from "../src/providers/steam";
import type { SteamOptions } from "../src/types";
import {
  API_KEY,
  BASE_URL,
  cookiesFrom,
  STEAM_ID,
  setup,
  steamAssertion,
  stubFetch,
  stubSteam,
} from "./helpers";

afterEach(() => vi.restoreAllMocks());

async function signInWithSteam(options: SteamOptions = { apiKey: API_KEY }) {
  const instance = await setup({ steam: options });
  const { url, cookie } = await instance.start("steam");
  const returnTo = url.searchParams.get("openid.return_to") as string;
  return { ...instance, url, cookie, returnTo };
}

describe("Steam sign-in", () => {
  it("sends the player to Steam's OpenID endpoint, back to better-auth's callback", async () => {
    const { url, returnTo } = await signInWithSteam();
    expect(`${url.origin}${url.pathname}`).toBe(STEAM_OPENID_ENDPOINT);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.realm": "http://localhost:3000",
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    });
    expect(returnTo).toMatch(new RegExp(`^${BASE_URL}/callback/steam\\?state=[\\w-]+$`));
  });

  it("creates the user and the account, then redirects to callbackURL with a session", async () => {
    const requests = stubSteam();
    const { callback, cookie, returnTo, accounts, findUser } = await signInWithSteam();
    const { response, location } = await callback(steamAssertion(returnTo), cookie);

    expect(location).toBe("/dashboard");
    expect(response.headers.getSetCookie().join()).toContain("session_token=");
    const [account] = await accounts("steam");
    expect(account).toMatchObject({ accountId: STEAM_ID });
    expect(account?.accessToken ?? null).toBeNull();
    expect(await findUser(account?.userId as string)).toMatchObject({
      name: "Gabe",
      email: `${STEAM_ID}@steam.invalid`,
      emailVerified: false,
      image: "https://avatars.steamstatic.com/full.jpg",
    });

    // Steam confirmed the assertion: every openid field, in check_authentication mode.
    const check = new URLSearchParams(String(requests[0]?.init?.body));
    expect(check.get("openid.mode")).toBe("check_authentication");
    expect(check.get("openid.sig")).toBe("c2lnbmF0dXJl");
    expect(check.has("state")).toBe(false);
  });

  it("signs a returning player in to the same user", async () => {
    stubSteam();
    const { auth, start, callback, accounts } = await signInWithSteam();
    for (let i = 0; i < 2; i++) {
      const { url, cookie } = await start("steam");
      const { location } = await callback(
        steamAssertion(url.searchParams.get("openid.return_to") as string),
        cookie,
      );
      expect(location).toBe("/dashboard");
    }
    expect(await accounts("steam")).toHaveLength(1);
    expect(auth).toBeTruthy();
  });

  it("names the player after the SteamID without an API key", async () => {
    const requests = stubSteam();
    const { callback, cookie, returnTo, accounts, findUser } = await signInWithSteam({});
    await callback(steamAssertion(returnTo), cookie);
    const [account] = await accounts("steam");
    expect((await findUser(account?.userId as string))?.name).toBe(`Steam ${STEAM_ID}`);
    expect(requests.some((request) => request.url.host === "api.steampowered.com")).toBe(false);
  });

  it("signs in when the profile can't be loaded, without logging the API key", async () => {
    stubFetch({
      [STEAM_OPENID_ENDPOINT]: () =>
        new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"),
      "https://api.steampowered.com/": () => {
        throw new Error(`network down for https://api.steampowered.com/?key=${API_KEY}`);
      },
    });
    const { callback, cookie, returnTo, context } = await signInWithSteam();
    const logged = vi.spyOn(context.logger, "warn");
    const error = vi.spyOn(context.logger, "error");
    const { location } = await callback(steamAssertion(returnTo), cookie);
    expect(location).toBe("/dashboard");
    expect(JSON.stringify([logged.mock.calls, error.mock.calls])).not.toContain(API_KEY);
  });

  it("maps the profile with mapProfileToUser", async () => {
    stubSteam();
    const { callback, cookie, returnTo, accounts, findUser } = await signInWithSteam({
      apiKey: API_KEY,
      mapProfileToUser: (profile) => ({ name: `${profile.personaname} (Steam)` }),
    });
    await callback(steamAssertion(returnTo), cookie);
    const [account] = await accounts("steam");
    expect((await findUser(account?.userId as string))?.name).toBe("Gabe (Steam)");
  });
});

describe("Steam account linking", () => {
  /**
   * Signs a user in, starts linkSocial, and returns Steam's answer to send
   * back. `refused`: the link is expected to fail, so better-auth's error
   * log is muted (it logs before `link` returns).
   */
  async function link(
    config: Parameters<typeof setup>[1] = {},
    steam: SteamOptions = {},
    { refused = false } = {},
  ) {
    stubSteam();
    const instance = await setup({ steam: { apiKey: API_KEY, ...steam } }, config);
    const { auth, context } = instance;
    if (refused) vi.spyOn(context.logger, "error").mockImplementation(() => {});
    const user = await context.test.saveUser(context.test.createUser({ email: "ada@example.com" }));
    const headers = await context.test.getAuthHeaders({ userId: user.id });
    const linked = await auth.api.linkSocialAccount({
      body: { provider: "steam", callbackURL: "/settings" },
      headers,
      returnHeaders: true,
    });
    const url = new URL(linked.response.url as string);
    const cookie = [headers.get("cookie"), cookiesFrom(linked.headers)].filter(Boolean).join("; ");
    const result = await instance.callback(
      steamAssertion(url.searchParams.get("openid.return_to") as string),
      cookie,
    );
    return { ...instance, ...result, user };
  }

  it("links Steam to the signed-in user, with linking configured for it", async () => {
    const { location, accounts, user, context } = await link({
      account: { accountLinking: { trustedProviders: ["steam"], allowDifferentEmails: true } },
    });
    expect(location).toBe("/settings");
    expect(await accounts("steam")).toEqual([
      expect.objectContaining({ userId: user.id, accountId: STEAM_ID }),
    ]);
    // The user keeps their own email; no placeholder user is created.
    expect(await context.adapter.count({ model: "user" })).toBe(1);
  });

  it("keeps the user's real email when Steam sign-ins override user info", async () => {
    const { start, callback, findUser, user } = await link(
      { account: { accountLinking: { trustedProviders: ["steam"], allowDifferentEmails: true } } },
      { overrideUserInfoOnSignIn: true },
    );
    const { url, cookie } = await start("steam");
    const { location } = await callback(
      steamAssertion(url.searchParams.get("openid.return_to") as string),
      cookie,
    );

    expect(location).toBe("/dashboard");
    // The name comes from Steam; the email stays the user's own.
    expect(await findUser(user.id)).toMatchObject({
      name: "Gabe",
      email: "ada@example.com",
      emailVerified: user.emailVerified,
    });
  });

  it("is refused by better-auth's default linking rules (no verified, matching email)", async () => {
    const { location, accounts } = await link({}, {}, { refused: true });
    expect(location).toContain("error=");
    expect(await accounts("steam")).toEqual([]);
  });
});

describe("Steam assertions that are refused", () => {
  const failed = `error=${AUTHENTICATION_CALLBACK_ERRORS.STEAM_VERIFICATION_FAILED}`;

  it("when Steam says it is not valid", async () => {
    stubSteam({ valid: false });
    const { callback, cookie, returnTo, accounts } = await signInWithSteam();
    const { location } = await callback(steamAssertion(returnTo), cookie);
    expect(location).toContain(failed);
    expect(await accounts("steam")).toEqual([]);
  });

  it.each([
    [
      "a claimed id that isn't a SteamID",
      { "openid.claimed_id": "https://evil.example/openid/id/1" },
    ],
    [
      "an identity that differs from the claimed id",
      { "openid.identity": "https://steamcommunity.com/openid/id/76561197960287931" },
    ],
    ["another OP endpoint", { "openid.op_endpoint": "https://evil.example/openid/login" }],
    ["another return_to", { "openid.return_to": `${BASE_URL}/callback/steam?state=other` }],
    [
      "return_to left unsigned",
      { "openid.signed": "signed,op_endpoint,claimed_id,identity,response_nonce,assoc_handle" },
    ],
    ["no signature", { "openid.sig": null }],
    ["a mode other than id_res", { "openid.mode": "setup_needed" }],
  ])("for %s, without asking Steam", async (_name, overrides) => {
    const requests = stubSteam();
    const { callback, cookie, returnTo, accounts } = await signInWithSteam();
    const { location } = await callback(steamAssertion(returnTo, overrides), cookie);
    expect(location).toContain(failed);
    expect(requests).toEqual([]);
    expect(await accounts("steam")).toEqual([]);
  });

  it("when the assertion is POSTed, without asking Steam", async () => {
    const requests = stubSteam();
    const { auth, cookie, returnTo, accounts } = await signInWithSteam();
    const response = await auth.handler(
      new Request(steamAssertion(returnTo), { method: "POST", headers: { cookie } }),
    );
    expect(response.status).toBe(302);
    expect(requests).toEqual([]);
    expect(await accounts("steam")).toEqual([]);
  });

  it("when the player cancelled on Steam", async () => {
    stubSteam();
    const { callback, cookie, returnTo } = await signInWithSteam();
    const url = new URL(returnTo);
    url.searchParams.set("openid.ns", "http://specs.openid.net/auth/2.0");
    url.searchParams.set("openid.mode", "cancel");
    const { location } = await callback(url, cookie);
    expect(location).toContain(`error=${AUTHENTICATION_CALLBACK_ERRORS.STEAM_SIGN_IN_CANCELLED}`);
  });

  it("when someone passes a code instead of an assertion", async () => {
    stubSteam();
    const { callback, cookie, returnTo, accounts } = await signInWithSteam();
    const url = new URL(returnTo);
    url.searchParams.set("code", "guessed-code");
    const { location } = await callback(url, cookie);
    expect(location).toContain(failed);
    expect(await accounts("steam")).toEqual([]);
  });

  it("when the assertion arrives without the browser's state cookie", async () => {
    stubSteam();
    const { callback, returnTo, accounts, context } = await signInWithSteam();
    vi.spyOn(context.logger, "error").mockImplementation(() => {});
    const { location } = await callback(steamAssertion(returnTo), "");
    expect(location).toContain("error=");
    expect(await accounts("steam")).toEqual([]);
  });

  it("when the same assertion is replayed", async () => {
    stubSteam();
    const { callback, cookie, returnTo, accounts, context } = await signInWithSteam();
    const assertion = steamAssertion(returnTo);
    expect((await callback(assertion, cookie)).location).toBe("/dashboard");
    // The state was used up; Steam would refuse the nonce as well.
    vi.spyOn(context.logger, "error").mockImplementation(() => {});
    expect((await callback(assertion, cookie)).location).toContain("error=");
    expect(await accounts("steam")).toHaveLength(1);
  });

  it("when Steam can't be reached", async () => {
    stubFetch({
      [STEAM_OPENID_ENDPOINT]: () => {
        throw new Error("timeout");
      },
    });
    const { callback, cookie, returnTo, context } = await signInWithSteam();
    vi.spyOn(context.logger, "error").mockImplementation(() => {});
    const { location } = await callback(steamAssertion(returnTo), cookie);
    expect(location).toContain(failed);
  });
});

describe("steamAuthorizationURL", () => {
  it("uses the return URL's origin as realm", () => {
    const url = steamAuthorizationURL("https://app.example.com/api/auth/callback/steam?state=x");
    expect(url.searchParams.get("openid.realm")).toBe("https://app.example.com");
  });
});
