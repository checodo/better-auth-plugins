import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EPIC_AUTHORIZATION_ENDPOINT,
  EPIC_ISSUER,
  EPIC_JWKS_ENDPOINT,
  EPIC_TOKEN_ENDPOINT,
} from "../src/providers/epic";
import type { EpicOptions } from "../src/types";
import { createSigner, setup, stubFetch } from "./helpers";

const CLIENT = { clientId: "epic-client", clientSecret: "epic-secret" };
const ACCOUNT_ID = "4c5e5a2b1d6f4e0a9b8c7d6e5f4a3b2c";

afterEach(() => vi.restoreAllMocks());

// better-auth caches a key set by URL, so every test signs with Epic's one key.
const epicKeys = await createSigner();

/** Epic's token endpoint and key set, issuing an ID token with `claims`. */
async function stubEpic(claims: Record<string, unknown> = {}) {
  const { jwks, sign } = epicKeys;
  const now = Math.floor(Date.now() / 1000);
  const idToken = await sign({
    iss: EPIC_ISSUER,
    aud: CLIENT.clientId,
    sub: ACCOUNT_ID,
    dn: "Jazz",
    iat: now,
    exp: now + 600,
    ...claims,
  });
  return stubFetch({
    [EPIC_TOKEN_ENDPOINT]: () =>
      Response.json({
        access_token: "epic-access",
        refresh_token: "epic-refresh",
        token_type: "bearer",
        expires_in: 7200,
        id_token: idToken,
      }),
    [EPIC_JWKS_ENDPOINT]: () => Response.json(jwks),
  });
}

async function signInWithEpic(options: Partial<EpicOptions> = {}) {
  const instance = await setup({ epic: { ...CLIENT, ...options } });
  const { url, cookie } = await instance.start("epic");
  const back = new URL(url.searchParams.get("redirect_uri") as string);
  back.searchParams.set("code", "epic-code");
  back.searchParams.set("state", url.searchParams.get("state") as string);
  return { ...instance, url, cookie, back };
}

describe("Epic Games sign-in", () => {
  it("sends the player to Epic with basic_profile and openid, without PKCE", async () => {
    const { url } = await signInWithEpic();
    expect(`${url.origin}${url.pathname}`).toBe(EPIC_AUTHORIZATION_ENDPOINT);
    expect(url.searchParams.get("client_id")).toBe(CLIENT.clientId);
    expect(url.searchParams.get("scope")).toBe("basic_profile openid");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/callback/epic",
    );
    expect(url.searchParams.has("code_challenge")).toBe(false);
  });

  it("sends a PKCE challenge with pkce: true, and extra scopes", async () => {
    const { url } = await signInWithEpic({ pkce: true, scope: ["friends_list"] });
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("basic_profile openid friends_list");
  });

  it("creates the user from the verified ID token", async () => {
    const requests = await stubEpic();
    const { callback, cookie, back, accounts, findUser } = await signInWithEpic();
    const { location } = await callback(back, cookie);

    expect(location).toBe("/dashboard");
    const [account] = await accounts("epic");
    expect(account).toMatchObject({ accountId: ACCOUNT_ID, accessToken: "epic-access" });
    expect(await findUser(account?.userId as string)).toMatchObject({
      name: "Jazz",
      email: `${ACCOUNT_ID}@epic.invalid`,
      emailVerified: false,
    });

    // The client authenticates with HTTP Basic at Epic's token endpoint.
    const token = requests.find((request) => request.url.toString() === EPIC_TOKEN_ENDPOINT);
    const headers = new Headers(token?.init?.headers);
    expect(headers.get("authorization")).toBe(
      `Basic ${Buffer.from(`${CLIENT.clientId}:${CLIENT.clientSecret}`).toString("base64")}`,
    );
  });

  it.each([
    ["for another client", { aud: "someone-else" }],
    ["from another issuer", { iss: "https://evil.example" }],
    ["that expired", { exp: Math.floor(Date.now() / 1000) - 60 }],
  ])("refuses an ID token %s", async (_name, claims) => {
    await stubEpic(claims);
    const { callback, cookie, back, accounts, context } = await signInWithEpic();
    vi.spyOn(context.logger, "error").mockImplementation(() => {});
    const { location } = await callback(back, cookie);
    expect(location).toContain("error=");
    expect(await accounts("epic")).toEqual([]);
  });

  it("refuses an ID token signed by another key", async () => {
    const other = await createSigner();
    const forged = await other.sign({
      iss: EPIC_ISSUER,
      aud: CLIENT.clientId,
      sub: "attacker",
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    stubFetch({
      [EPIC_TOKEN_ENDPOINT]: () =>
        Response.json({ access_token: "a", token_type: "bearer", id_token: forged }),
      [EPIC_JWKS_ENDPOINT]: () => Response.json(epicKeys.jwks),
    });
    const { callback, cookie, back, accounts, context } = await signInWithEpic();
    vi.spyOn(context.logger, "error").mockImplementation(() => {});
    expect((await callback(back, cookie)).location).toContain("error=");
    expect(await accounts("epic")).toEqual([]);
  });
});
