import { afterEach, describe, expect, it, vi } from "vitest";
import {
  XBOX_AUTHORIZATION_ENDPOINT,
  XBOX_TOKEN_ENDPOINT,
  XBOX_USER_AUTH_ENDPOINT,
  XBOX_XSTS_ENDPOINT,
} from "../src/providers/xbox";
import type { XboxOptions } from "../src/types";
import { setup, stubFetch } from "./helpers";

const CLIENT = { clientId: "azure-app-id", clientSecret: "azure-secret" };
const XUID = "2533274812345678";

afterEach(() => vi.restoreAllMocks());

/** Microsoft's token endpoint, then Xbox user auth and XSTS. */
function stubXbox({
  xsts = 200,
  userAuth = "ok",
}: {
  xsts?: number;
  userAuth?: "ok" | "not-json" | "unreachable";
} = {}) {
  return stubFetch({
    [XBOX_TOKEN_ENDPOINT]: () =>
      Response.json({ access_token: "msa-access", token_type: "Bearer", expires_in: 3600 }),
    [XBOX_USER_AUTH_ENDPOINT]: () => {
      if (userAuth === "unreachable") throw new TypeError("fetch failed");
      if (userAuth === "not-json") return new Response("<html>Service Unavailable</html>");
      return Response.json({ Token: "user-token", DisplayClaims: { xui: [{ uhs: "1234" }] } });
    },
    [XBOX_XSTS_ENDPOINT]: () =>
      xsts === 200
        ? Response.json({
            Token: "xsts-token",
            DisplayClaims: { xui: [{ uhs: "1234", xid: XUID, gtg: "MasterChief" }] },
          })
        : new Response("", { status: xsts, headers: { "x-err": "2148916233" } }),
  });
}

async function signInWithXbox(options: Partial<XboxOptions> = {}) {
  const instance = await setup({ xbox: { ...CLIENT, ...options } });
  const { url, cookie } = await instance.start("xbox");
  const back = new URL(url.searchParams.get("redirect_uri") as string);
  back.searchParams.set("code", "msa-code");
  back.searchParams.set("state", url.searchParams.get("state") as string);
  return { ...instance, url, cookie, back };
}

describe("Xbox sign-in", () => {
  it("sends the player to Microsoft's consumers tenant with xboxlive.signin only", async () => {
    const { url } = await signInWithXbox();
    expect(`${url.origin}${url.pathname}`).toBe(XBOX_AUTHORIZATION_ENDPOINT);
    expect(url.searchParams.get("scope")).toBe("xboxlive.signin");
    const offline = await signInWithXbox({ offlineAccess: true });
    expect(offline.url.searchParams.get("scope")).toBe("xboxlive.signin xboxlive.offline_access");
  });

  it("creates the user from the XSTS claims (XUID, gamertag)", async () => {
    const requests = stubXbox();
    const { callback, cookie, back, accounts, findUser } = await signInWithXbox();
    const { location } = await callback(back, cookie);

    expect(location).toBe("/dashboard");
    const [account] = await accounts("xbox");
    expect(account).toMatchObject({ accountId: XUID });
    expect(await findUser(account?.userId as string)).toMatchObject({
      name: "MasterChief",
      email: `${XUID}@xbox.invalid`,
      emailVerified: false,
    });

    const body = (url: string) =>
      JSON.parse(String(requests.find((request) => request.url.toString() === url)?.init?.body));
    expect(body(XBOX_USER_AUTH_ENDPOINT)).toEqual({
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: "d=msa-access",
      },
    });
    expect(body(XBOX_XSTS_ENDPOINT)).toEqual({
      RelyingParty: "http://xboxlive.com",
      TokenType: "JWT",
      Properties: { SandboxId: "RETAIL", UserTokens: ["user-token"] },
    });
  });

  it("uses a relying party and sandbox of its own", async () => {
    const requests = stubXbox();
    const { callback, cookie, back } = await signInWithXbox({
      relyingParty: "rp://my-title/",
      sandboxId: "XDKS.1",
    });
    await callback(back, cookie);
    const xsts = requests.find((request) => request.url.toString() === XBOX_XSTS_ENDPOINT);
    expect(JSON.parse(String(xsts?.init?.body))).toMatchObject({
      RelyingParty: "rp://my-title/",
      Properties: { SandboxId: "XDKS.1" },
    });
  });

  it("fails the sign-in when XSTS refuses, e.g. a Microsoft account without Xbox profile", async () => {
    stubXbox({ xsts: 401 });
    const { callback, cookie, back, accounts, context } = await signInWithXbox();
    const error = vi.spyOn(context.logger, "error").mockImplementation(() => {});
    const { location } = await callback(back, cookie);
    expect(location).toContain("error=");
    expect(await accounts("xbox")).toEqual([]);
    expect(JSON.stringify(error.mock.calls)).toContain("2148916233");
  });

  it("fails the sign-in, without a server error, when Xbox Live answers garbage or can't be reached", async () => {
    for (const userAuth of ["not-json", "unreachable"] as const) {
      stubXbox({ userAuth });
      const { callback, cookie, back, accounts, context } = await signInWithXbox();
      const error = vi.spyOn(context.logger, "error").mockImplementation(() => {});
      const { response, location } = await callback(back, cookie);
      expect(response.status).toBe(302);
      expect(location).toContain("error=");
      expect(await accounts("xbox")).toEqual([]);
      expect(JSON.stringify(error.mock.calls)).toContain("[authentication] Xbox");
      vi.restoreAllMocks();
    }
  });
});
