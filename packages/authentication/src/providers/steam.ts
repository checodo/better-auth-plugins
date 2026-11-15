import type { HookEndpointContext } from "@better-auth/core";
import { tryGetCurrentAuthEndpointContext } from "@better-auth/core/context";
import type { OAuth2Tokens, OAuthProvider } from "@better-auth/core/oauth2";
import { createAuthMiddleware } from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import { AUTHENTICATION_CALLBACK_ERRORS } from "../error-codes";
import type { SteamOptions, SteamProfile } from "../types";
import { placeholderEmail } from "../utils/email";
import type { ProviderDefinition } from "./types";

export const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
/** OpenID 2.0 requires these to be signed in a positive assertion. */
const REQUIRED_SIGNED = [
  "op_endpoint",
  "return_to",
  "response_nonce",
  "assoc_handle",
  "claimed_id",
  "identity",
];
/** How long the one-time code from the callback hook is valid. */
const CODE_TTL_MS = 60_000;
const STEAM_TIMEOUT_MS = 10_000;

const codeIdentifier = (code: string) => `steam-openid:${code}`;

/** Where Steam sends the player back: better-auth's own callback, with the OAuth state. */
export function steamReturnTo(redirectURI: string, state: string): string {
  const url = new URL(redirectURI);
  url.searchParams.set("state", state);
  return url.toString();
}

/** Steam's sign-in page for an OpenID 2.0 `checkid_setup` request. */
export function steamAuthorizationURL(returnTo: string): URL {
  const url = new URL(STEAM_OPENID_ENDPOINT);
  url.searchParams.set("openid.ns", OPENID_NS);
  url.searchParams.set("openid.mode", "checkid_setup");
  url.searchParams.set("openid.return_to", returnTo);
  url.searchParams.set("openid.realm", new URL(returnTo).origin);
  url.searchParams.set("openid.identity", IDENTIFIER_SELECT);
  url.searchParams.set("openid.claimed_id", IDENTIFIER_SELECT);
  return url;
}

/** Parses OpenID's key-value form (`key:value` lines). */
function parseKeyValue(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text.split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) result.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  return result;
}

/**
 * Checks Steam's positive assertion and returns the SteamID64, or `null`.
 * Everything in the query is untrusted until Steam confirms it: the
 * fields are checked against what this request expects, then sent back to
 * Steam (`check_authentication`), which verifies the signature and that
 * the nonce wasn't used before.
 */
export async function verifySteamAssertion(
  query: Record<string, unknown>,
  expectedReturnTo: string,
): Promise<string | null> {
  const get = (key: string) => {
    const value = query[`openid.${key}`];
    return typeof value === "string" ? value : undefined;
  };
  if (get("ns") !== OPENID_NS || get("mode") !== "id_res") return null;
  if (get("op_endpoint") !== STEAM_OPENID_ENDPOINT) return null;
  if (get("return_to") !== expectedReturnTo) return null;
  const claimedId = get("claimed_id");
  const steamId = claimedId ? CLAIMED_ID.exec(claimedId)?.[1] : undefined;
  if (!steamId || get("identity") !== claimedId) return null;
  const signed = new Set((get("signed") ?? "").split(","));
  if (!REQUIRED_SIGNED.every((field) => signed.has(field)) || !get("sig")) return null;

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith("openid.") && typeof value === "string") body.set(key, value);
  }
  body.set("openid.mode", "check_authentication");
  const response = await fetch(STEAM_OPENID_ENDPOINT, {
    method: "POST",
    body,
    redirect: "error",
    signal: AbortSignal.timeout(STEAM_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const answer = parseKeyValue(await response.text());
  return answer.get("ns") === OPENID_NS && answer.get("is_valid") === "true" ? steamId : null;
}

/** Loads the player's public profile; `null` if it can't be loaded. */
async function fetchSteamProfile(
  steamId: string,
  apiKey: string,
  apiBaseURL: string,
): Promise<SteamProfile | null> {
  const url = new URL("/ISteamUser/GetPlayerSummaries/v2/", apiBaseURL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("steamids", steamId);
  const response = await fetch(url, { signal: AbortSignal.timeout(STEAM_TIMEOUT_MS) });
  if (!response.ok) return null;
  const data = (await response.json()) as { response?: { players?: SteamProfile[] } };
  const player = data.response?.players?.find((p) => p.steamid === steamId);
  return player ?? null;
}

/**
 * Steam uses OpenID 2.0, not OAuth: it sends the player back with a signed
 * assertion instead of a code. Steam's `return_to` is better-auth's own
 * `/callback/steam`; a before-hook there verifies the assertion and swaps
 * it for a one-time `code`, which `validateAuthorizationCode` redeems. The
 * rest is better-auth's callback, like for any provider: state and CSRF
 * check, user and account, session, redirect.
 */
export function steam(options: SteamOptions, emailDomain: string): ProviderDefinition {
  const apiBaseURL = options.apiBaseURL ?? "https://api.steampowered.com";

  const provider: OAuthProvider<SteamProfile> = {
    id: "steam",
    name: "Steam",
    accountSubject: ({ profile }) => profile.steamid,
    createAuthorizationURL({ state, redirectURI }) {
      return steamAuthorizationURL(steamReturnTo(redirectURI, state));
    },
    async validateAuthorizationCode({ code }): Promise<OAuth2Tokens | null> {
      const ctx = tryGetCurrentAuthEndpointContext();
      if (!ctx) return null;
      const verified = await ctx.context.internalAdapter.consumeVerificationValue(
        codeIdentifier(code),
      );
      if (!verified || new Date(verified.expiresAt).getTime() < Date.now()) return null;
      return { tokenType: "steam-openid", raw: { steamid: verified.value } };
    },
    async getUserInfo(tokens) {
      const steamid = tokens.raw?.steamid;
      if (typeof steamid !== "string") return null;
      let profile: SteamProfile = { steamid };
      if (options.apiKey) {
        try {
          profile = (await fetchSteamProfile(steamid, options.apiKey, apiBaseURL)) ?? profile;
        } catch {
          // The profile is cosmetic; the sign-in is verified without it.
          // Not logged in detail: the request URL contains the API key.
          tryGetCurrentAuthEndpointContext()?.context.logger.warn(
            "[authentication] could not load the Steam profile",
          );
        }
      }
      const mapped = await options.mapProfileToUser?.(profile);
      return {
        user: {
          name: profile.personaname || `Steam ${steamid}`,
          email: placeholderEmail(steamid, emailDomain),
          emailVerified: false,
          image: profile.avatarfull,
          ...mapped,
        },
        data: profile,
      };
    },
    disableSignUp: options.disableSignUp,
    disableImplicitSignUp: options.disableImplicitSignUp,
    options: {
      disableSignUp: options.disableSignUp,
      disableImplicitSignUp: options.disableImplicitSignUp,
      overrideUserInfoOnSignIn: options.overrideUserInfoOnSignIn,
    },
  };

  const callbackHook = {
    matcher: (context: HookEndpointContext) =>
      context.path === "/callback/:id" && (context.params as { id?: unknown })?.id === "steam",
    handler: createAuthMiddleware(async (ctx) => {
      const query = (ctx.query ?? {}) as Record<string, unknown>;
      const state = typeof query.state === "string" ? query.state : undefined;
      // A `code` in the query never reaches the callback: on failure it is
      // blanked (and `error` makes the callback stop first), on success
      // replaced by the hook's own.
      const fail = (error: string) => ({ context: { query: { state, code: "", error } } });
      // Steam always returns with GET. better-auth turns a POST to the
      // callback into a GET redirect, which comes back here.
      if (!state || ctx.method !== "GET") {
        return fail(AUTHENTICATION_CALLBACK_ERRORS.STEAM_VERIFICATION_FAILED);
      }
      if (query["openid.mode"] === "cancel") {
        return fail(AUTHENTICATION_CALLBACK_ERRORS.STEAM_SIGN_IN_CANCELLED);
      }

      let steamId: string | null = null;
      try {
        const expected = steamReturnTo(`${ctx.context.baseURL}/callback/steam`, state);
        steamId = await verifySteamAssertion(query, expected);
      } catch (error) {
        ctx.context.logger.error("[authentication] Steam verification failed", error);
      }
      if (!steamId) return fail(AUTHENTICATION_CALLBACK_ERRORS.STEAM_VERIFICATION_FAILED);

      const code = generateRandomString(32);
      await ctx.context.internalAdapter.createVerificationValue({
        identifier: codeIdentifier(code),
        value: steamId,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });
      return { context: { query: { state, code } } };
    }),
  };

  return {
    provider: provider as unknown as OAuthProvider,
    emailDomain,
    hooks: { before: [callbackHook] },
  };
}
