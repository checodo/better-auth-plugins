import type { BetterAuthPlugin } from "@better-auth/core";
import type { OAuthProvider } from "@better-auth/core/oauth2";

/**
 * What a provider file contributes to the plugin. Adding a provider means
 * one file returning this, one key in `AuthenticationOptions`, one test
 * file, and one docs section.
 */
export interface ProviderDefinition {
  /** Registered like a built-in social provider (`signIn.social`, `/callback/<id>`). */
  provider: OAuthProvider;
  /** Domain of the placeholder emails of this provider's users. */
  emailDomain: string;
  /** Hooks the provider needs, e.g. Steam's OpenID check on its callback. */
  hooks?: NonNullable<BetterAuthPlugin["hooks"]> | undefined;
}
