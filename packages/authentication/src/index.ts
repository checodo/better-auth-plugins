import type { BetterAuthPlugin } from "@better-auth/core";
import { version } from "../package.json";
import { AUTHENTICATION_ERROR_CODES } from "./error-codes";
import { createReservedEmailHooks } from "./hooks/reserved-email";
import { resolveProviders } from "./options";
import type { AuthenticationOptions } from "./types";

export {
  AUTHENTICATION_CALLBACK_ERRORS,
  AUTHENTICATION_ERROR_CODES,
  type AuthenticationErrorCode,
} from "./error-codes";
export type {
  AuthenticationOptions,
  AuthenticationProviderId,
  CommonProviderOptions,
  EpicOptions,
  EpicProfile,
  SteamOptions,
  SteamProfile,
  XboxOptions,
  XboxProfile,
} from "./types";

/**
 * Adds Steam, Epic Games, and Xbox as social providers. They are used like
 * better-auth's built-in ones: `signIn.social({ provider: "steam" })`,
 * `linkSocial`, callbacks at `/callback/<provider>`, account linking,
 * `callbackURL` checks, and sign-up options all work the same way.
 *
 * @example
 * ```ts
 * import { betterAuth } from "better-auth";
 * import { authentication } from "@checodo/better-auth-authentication";
 *
 * export const auth = betterAuth({
 *   plugins: [
 *     authentication({
 *       steam: { apiKey: process.env.STEAM_API_KEY },
 *       epic: { clientId: "...", clientSecret: "..." },
 *     }),
 *   ],
 * });
 *
 * // client
 * await authClient.signIn.social({ provider: "steam", callbackURL: "/dashboard" });
 * ```
 */
export const authentication = (options: AuthenticationOptions) => {
  const definitions = resolveProviders(options);
  const before = definitions.flatMap((definition) => definition.hooks?.before ?? []);

  return {
    id: "authentication",
    version,
    init(ctx) {
      const ids = new Set(definitions.map((definition) => definition.provider.id));
      for (const existing of ctx.socialProviders) {
        if (ids.has(existing.id)) {
          ctx.logger.warn(
            `[authentication] the "${existing.id}" provider replaces a social provider with the same id`,
          );
        }
      }
      return {
        context: {
          socialProviders: [
            ...definitions.map((definition) => definition.provider),
            ...ctx.socialProviders.filter((provider) => !ids.has(provider.id)),
          ],
        },
        options: { databaseHooks: createReservedEmailHooks(definitions) },
      };
    },
    hooks: { before },
    $ERROR_CODES: AUTHENTICATION_ERROR_CODES,
    options,
  } satisfies BetterAuthPlugin;
};

export type AuthenticationPlugin = ReturnType<typeof authentication>;

/** Lets `auth.$context.getPlugin("authentication")` infer this plugin's exact type. */
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    authentication: {
      creator: typeof authentication;
    };
  }
}
