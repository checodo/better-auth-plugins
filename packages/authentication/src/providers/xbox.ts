import { tryGetCurrentAuthEndpointContext } from "@better-auth/core/context";
import type { OAuthProvider } from "@better-auth/core/oauth2";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "@better-auth/core/oauth2";
import type { XboxOptions, XboxProfile } from "../types";
import { placeholderEmail } from "../utils/email";
import type { ProviderDefinition } from "./types";

/**
 * Microsoft's documented flow for Xbox sign-in on websites ("Xbox services
 * sign-in for title websites", Microsoft Game Development Kit): Microsoft
 * account OAuth on the `consumers` tenant with `xboxlive.signin`, then an
 * Xbox user token, then an XSTS token whose claims name the player.
 */
export const XBOX_AUTHORIZATION_ENDPOINT =
  "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
export const XBOX_TOKEN_ENDPOINT = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
export const XBOX_USER_AUTH_ENDPOINT = "https://user.auth.xboxlive.com/user/authenticate";
export const XBOX_XSTS_ENDPOINT = "https://xsts.auth.xboxlive.com/xsts/authorize";
const XBOX_TIMEOUT_MS = 10_000;

interface XboxTokenResponse {
  Token?: string;
  DisplayClaims?: { xui?: Record<string, string>[] };
}

async function postXbox(url: string, body: unknown): Promise<XboxTokenResponse | null> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-xbl-contract-version": "1",
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(XBOX_TIMEOUT_MS),
  });
  if (!response.ok) {
    // XErr names the reason, e.g. 2148916233: the account has no Xbox
    // profile. Only the status and that code are logged, never the body.
    const xErr = response.headers.get("x-err") ?? "none";
    tryGetCurrentAuthEndpointContext()?.context.logger.error(
      `[authentication] Xbox token request to ${new URL(url).host} failed (${response.status}, XErr ${xErr})`,
    );
    return null;
  }
  try {
    return (await response.json()) as XboxTokenResponse;
  } catch {
    tryGetCurrentAuthEndpointContext()?.context.logger.error(
      `[authentication] Xbox token response from ${new URL(url).host} isn't JSON`,
    );
    return null;
  }
}

/** Exchanges a Microsoft access token for the player's XSTS claims (XUID, gamertag). */
export async function fetchXboxProfile(
  accessToken: string,
  { relyingParty, sandboxId }: { relyingParty: string; sandboxId: string },
): Promise<XboxProfile | null> {
  const user = await postXbox(XBOX_USER_AUTH_ENDPOINT, {
    RelyingParty: "http://auth.xboxlive.com",
    TokenType: "JWT",
    Properties: {
      AuthMethod: "RPS",
      SiteName: "user.auth.xboxlive.com",
      RpsTicket: `d=${accessToken}`,
    },
  });
  if (!user?.Token) return null;
  const xsts = await postXbox(XBOX_XSTS_ENDPOINT, {
    RelyingParty: relyingParty,
    TokenType: "JWT",
    Properties: { SandboxId: sandboxId, UserTokens: [user.Token] },
  });
  const claims = xsts?.DisplayClaims?.xui?.[0];
  if (!claims?.xid) {
    if (xsts) {
      tryGetCurrentAuthEndpointContext()?.context.logger.error(
        "[authentication] the XSTS token has no XUID (xid claim); check the relying party",
      );
    }
    return null;
  }
  return claims as XboxProfile;
}

/**
 * Xbox, for apps enrolled in the Xbox developer program (Microsoft only
 * grants `xboxlive.signin` to them). The player is identified by the XUID
 * from XSTS; Xbox shares no email address.
 */
export function xbox(options: XboxOptions, emailDomain: string): ProviderDefinition {
  const relyingParty = options.relyingParty ?? "http://xboxlive.com";
  const sandboxId = options.sandboxId ?? "RETAIL";
  // Microsoft allows no other scopes in this request.
  const scopes = ["xboxlive.signin", ...(options.offlineAccess ? ["xboxlive.offline_access"] : [])];

  const provider: OAuthProvider<XboxProfile> = {
    id: "xbox",
    name: "Xbox",
    accountSubject: ({ profile }) => profile.xid,
    createAuthorizationURL({ state, codeVerifier, redirectURI, additionalParams }) {
      return createAuthorizationURL({
        id: "xbox",
        options,
        authorizationEndpoint: XBOX_AUTHORIZATION_ENDPOINT,
        scopes,
        state,
        codeVerifier,
        redirectURI,
        prompt: options.prompt,
        additionalParams,
      });
    },
    validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
      return validateAuthorizationCode({
        code,
        codeVerifier,
        redirectURI,
        options,
        tokenEndpoint: XBOX_TOKEN_ENDPOINT,
        authentication: "post",
      });
    },
    refreshAccessToken: (refreshToken) =>
      refreshAccessToken({
        refreshToken,
        options: { clientId: options.clientId, clientSecret: options.clientSecret },
        tokenEndpoint: XBOX_TOKEN_ENDPOINT,
        authentication: "post",
      }),
    async getUserInfo(tokens) {
      if (!tokens.accessToken) return null;
      let profile: XboxProfile | null = null;
      try {
        profile = await fetchXboxProfile(tokens.accessToken, { relyingParty, sandboxId });
      } catch (error) {
        // Network failure or timeout: fail the sign-in like any other refusal.
        tryGetCurrentAuthEndpointContext()?.context.logger.error(
          "[authentication] Xbox Live couldn't be reached",
          error,
        );
      }
      if (!profile) return null;
      const mapped = await options.mapProfileToUser?.(profile);
      return {
        user: {
          name: profile.gtg || `Xbox ${profile.xid}`,
          email: placeholderEmail(profile.xid, emailDomain),
          emailVerified: false,
          ...mapped,
        },
        data: profile,
      };
    },
    disableSignUp: options.disableSignUp,
    disableImplicitSignUp: options.disableImplicitSignUp,
    options: {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      redirectURI: options.redirectURI,
      disableSignUp: options.disableSignUp,
      disableImplicitSignUp: options.disableImplicitSignUp,
      overrideUserInfoOnSignIn: options.overrideUserInfoOnSignIn,
    },
  };
  return { provider: provider as unknown as OAuthProvider, emailDomain };
}
