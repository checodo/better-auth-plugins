import { tryGetCurrentAuthEndpointContext } from "@better-auth/core/context";
import type { OAuthProvider } from "@better-auth/core/oauth2";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
  validateToken,
} from "@better-auth/core/oauth2";
import type { EpicOptions, EpicProfile } from "../types";
import { placeholderEmail } from "../utils/email";
import type { ProviderDefinition } from "./types";

/**
 * From Epic's discovery document,
 * https://api.epicgames.dev/epic/oauth/v1/.well-known/openid-configuration
 */
export const EPIC_ISSUER = "https://api.epicgames.dev/epic/oauth/v1";
export const EPIC_AUTHORIZATION_ENDPOINT = "https://www.epicgames.com/id/authorize";
export const EPIC_TOKEN_ENDPOINT = "https://api.epicgames.dev/epic/oauth/v1/token";
export const EPIC_JWKS_ENDPOINT = "https://api.epicgames.dev/epic/oauth/v1/.well-known/jwks.json";
/** `basic_profile` is required by Epic Account Services; `openid` returns an ID token. */
const DEFAULT_SCOPES = ["basic_profile", "openid"];

/**
 * Epic Games (Epic Account Services) over OpenID Connect. The player is
 * identified by the ID token, verified against Epic's keys, issuer, and
 * this client id. Epic shares no email address.
 */
export function epic(options: EpicOptions, emailDomain: string): ProviderDefinition {
  const provider: OAuthProvider<EpicProfile> = {
    id: "epic",
    name: "Epic Games",
    issuer: EPIC_ISSUER,
    accountSubject: ({ profile }) => profile.sub,
    createAuthorizationURL({ state, scopes, codeVerifier, redirectURI, additionalParams }) {
      const allScopes = options.disableDefaultScope ? [] : [...DEFAULT_SCOPES];
      if (options.scope) allScopes.push(...options.scope);
      if (scopes) allScopes.push(...scopes);
      return createAuthorizationURL({
        id: "epic",
        options,
        authorizationEndpoint: EPIC_AUTHORIZATION_ENDPOINT,
        scopes: [...new Set(allScopes)],
        state,
        codeVerifier: options.pkce ? codeVerifier : undefined,
        redirectURI,
        prompt: options.prompt,
        additionalParams,
      });
    },
    validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
      return validateAuthorizationCode({
        code,
        codeVerifier: options.pkce ? codeVerifier : undefined,
        redirectURI,
        options,
        tokenEndpoint: EPIC_TOKEN_ENDPOINT,
        authentication: "basic",
      });
    },
    refreshAccessToken: (refreshToken) =>
      refreshAccessToken({
        refreshToken,
        options: { clientId: options.clientId, clientSecret: options.clientSecret },
        tokenEndpoint: EPIC_TOKEN_ENDPOINT,
        authentication: "basic",
      }),
    async getUserInfo(tokens) {
      if (!tokens.idToken) {
        tryGetCurrentAuthEndpointContext()?.context.logger.error(
          '[authentication] Epic returned no ID token; keep the "openid" scope',
        );
        return null;
      }
      let payload: EpicProfile;
      try {
        ({ payload } = await validateToken<EpicProfile>(tokens.idToken, EPIC_JWKS_ENDPOINT, {
          issuer: EPIC_ISSUER,
          audience: options.clientId,
          requiredClaims: ["sub"],
        }));
      } catch (error) {
        // `null` fails the sign-in with better-auth's error redirect, not a 500.
        tryGetCurrentAuthEndpointContext()?.context.logger.error(
          "[authentication] Epic's ID token didn't verify",
          error,
        );
        return null;
      }
      const mapped = await options.mapProfileToUser?.(payload);
      return {
        user: {
          name: payload.dn || `Epic ${payload.sub}`,
          email: placeholderEmail(payload.sub, emailDomain),
          emailVerified: false,
          ...mapped,
        },
        data: payload,
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
