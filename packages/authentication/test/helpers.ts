import type { BetterAuthOptions } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { vi } from "vitest";
import { authenticationClient } from "../src/client";
import type { AuthenticationOptions } from "../src/index";
import { authentication } from "../src/index";
import { STEAM_OPENID_ENDPOINT } from "../src/providers/steam";

export const BASE_URL = "http://localhost:3000/api/auth";

type Route = (request: { url: URL; init: RequestInit | undefined }) => Response | Promise<Response>;

/**
 * Stubs `fetch` for provider servers: each route handles requests whose URL
 * starts with its key. Records every request. Anything else goes to the
 * real `fetch` (the test client's own requests).
 */
export function stubFetch(routes: Record<string, Route>) {
  const realFetch = globalThis.fetch;
  const requests: { url: URL; init: RequestInit | undefined }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const match = Object.keys(routes).find((prefix) => url.toString().startsWith(prefix));
    if (!match) return realFetch(input, init);
    requests.push({ url, init });
    return (routes[match] as Route)({ url, init });
  });
  return requests;
}

/** A `cookie` header with the cookies a response set (the last value of each wins). */
export function cookiesFrom(headers: Headers): string {
  const cookies = new Map<string, string>();
  for (const cookie of headers.getSetCookie()) {
    const [pair = ""] = cookie.split(";");
    const name = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(pair.indexOf("=") + 1);
    if (value) cookies.set(name, value);
    else cookies.delete(name);
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

export async function setup(
  options: AuthenticationOptions,
  config: Partial<BetterAuthOptions> = {},
) {
  const { auth, client } = await getTestInstance(
    { ...config, plugins: [authentication(options), testUtils(), ...(config.plugins ?? [])] },
    { disableTestUser: true, clientOptions: { plugins: [authenticationClient()] } },
  );
  const context = await auth.$context;

  /**
   * Starts a social sign-in like the client does; returns the provider URL
   * and the cookies to send back with the callback.
   */
  const start = async (provider: string, extra: Record<string, unknown> = {}) => {
    const result = await auth.api.signInSocial({
      body: { provider, callbackURL: "/dashboard", ...extra },
      returnHeaders: true,
    });
    return {
      url: new URL(result.response.url as string),
      cookie: cookiesFrom(result.headers),
    };
  };
  /** Calls the callback like the browser does after the provider. */
  const callback = async (url: URL | string, cookie: string) => {
    const response = await auth.handler(new Request(url, { headers: { cookie } }));
    return { response, location: response.headers.get("location") ?? "" };
  };
  const accounts = (providerId: string) =>
    context.adapter.findMany<{ userId: string; accountId: string; accessToken?: string | null }>({
      model: "account",
      where: [{ field: "providerId", value: providerId }],
    });
  const findUser = (id: string) =>
    context.adapter.findOne<{
      id: string;
      name: string;
      email: string;
      emailVerified: boolean;
      image?: string | null;
    }>({
      model: "user",
      where: [{ field: "id", value: id }],
    });

  return { auth, client, context, start, callback, accounts, findUser };
}

const base64url = (data: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof data === "string" ? data : new Uint8Array(data)).toString("base64url");

/** An RS256 key pair, its public JWKS, and a function that signs JWTs with it. */
export async function createSigner() {
  type Key = Parameters<typeof crypto.subtle.sign>[1];
  const { privateKey, publicKey } = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as unknown as { privateKey: Key; publicKey: Key };
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  const jwks = { keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }] };
  const sign = async (payload: Record<string, unknown>) => {
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" }));
    const body = base64url(JSON.stringify(payload));
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(`${header}.${body}`),
    );
    return `${header}.${body}.${base64url(signature)}`;
  };
  return { jwks, sign };
}

export const STEAM_ID = "76561197960287930";
export const API_KEY = "STEAM-API-KEY-1234";

/**
 * Steam's two servers: the OpenID endpoint answers `check_authentication`
 * with `valid`, and the Web API returns a player when asked with the key.
 */
export function stubSteam({ valid = true, player = true } = {}) {
  return stubFetch({
    [STEAM_OPENID_ENDPOINT]: () =>
      new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`),
    "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/": ({ url }) =>
      Response.json({
        response: {
          players:
            player && url.searchParams.get("key") === API_KEY
              ? [
                  {
                    steamid: url.searchParams.get("steamids"),
                    personaname: "Gabe",
                    avatarfull: "https://avatars.steamstatic.com/full.jpg",
                  },
                ]
              : [],
        },
      }),
  });
}

/** What Steam sends back after the player signed in: `return_to` plus a signed assertion. */
export function steamAssertion(returnTo: string, overrides: Record<string, string | null> = {}) {
  const url = new URL(returnTo);
  const identity = `https://steamcommunity.com/openid/id/${STEAM_ID}`;
  const fields: Record<string, string | null> = {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": STEAM_OPENID_ENDPOINT,
    "openid.claimed_id": identity,
    "openid.identity": identity,
    "openid.return_to": returnTo,
    "openid.response_nonce": "2026-11-11T10:00:00Zabcdef",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2lnbmF0dXJl",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return url;
}
