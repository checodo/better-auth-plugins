import type { OAuthMappedUser, ProviderOptions } from "@better-auth/core/oauth2";

/** Like better-auth's `mapProfileToUser`: changes the user created from a profile. */
export type ProfileMapper<Profile extends object> = (
  profile: Profile,
) => OAuthMappedUser | Promise<OAuthMappedUser>;

/**
 * What every provider accepts, like better-auth's built-in providers:
 * sign-up control and profile mapping.
 */
export interface CommonProviderOptions<Profile extends object> {
  /** Only existing users can sign in; new users get an error. */
  disableSignUp?: boolean | undefined;
  /** New users must sign in with `requestSignUp: true`. */
  disableImplicitSignUp?: boolean | undefined;
  /** Update the user's name and image from the provider on every sign-in. */
  overrideUserInfoOnSignIn?: boolean | undefined;
  /** Change the user created from the provider's profile. */
  mapProfileToUser?: ProfileMapper<Profile> | undefined;
  /**
   * Domain of the placeholder email for users the provider gives no email
   * (`<account id>@<domain>`). Defaults to `<provider id>.invalid`, a domain
   * that can never receive email. Sign-ups with this domain are refused
   * everywhere else, so nobody can claim a player's placeholder.
   */
  emailDomain?: string | undefined;
}

/** OAuth options shared by Epic and Xbox, like `github({ ... })`. */
export type OAuthClientOptions = Pick<
  ProviderOptions,
  "clientSecret" | "scope" | "disableDefaultScope" | "redirectURI" | "prompt"
> & {
  clientId: string;
  clientSecret: string;
};

/** The Steam player, from the Steam Web API's `GetPlayerSummaries`. */
export interface SteamProfile {
  /** 64-bit SteamID, as a string. */
  steamid: string;
  personaname?: string | undefined;
  profileurl?: string | undefined;
  avatar?: string | undefined;
  avatarmedium?: string | undefined;
  avatarfull?: string | undefined;
  /** Only for public profiles. */
  realname?: string | undefined;
  /** Only for public profiles. */
  loccountrycode?: string | undefined;
  [key: string]: unknown;
}

export interface SteamOptions extends CommonProviderOptions<SteamProfile> {
  /**
   * A Steam Web API key (https://steamcommunity.com/dev/apikey), to load
   * the player's name and avatar. Without it, users are named after their
   * SteamID. Never logged.
   */
  apiKey?: string | undefined;
  /**
   * Web API host. Defaults to `https://api.steampowered.com`; publisher keys
   * use `https://partner.steam-api.com`.
   */
  apiBaseURL?: string | undefined;
}

/** The Epic Games account, from the ID token. */
export interface EpicProfile {
  /** The Epic account id. */
  sub: string;
  /** The display name. */
  dn?: string | undefined;
  [key: string]: unknown;
}

export type EpicOptions = OAuthClientOptions &
  CommonProviderOptions<EpicProfile> & {
    /**
     * Send a PKCE challenge. Epic doesn't document PKCE for web sign-in, so
     * it is off by default.
     */
    pkce?: boolean | undefined;
  };

/** The Xbox player, from the XSTS token's display claims. */
export interface XboxProfile {
  /** The Xbox user id (XUID). */
  xid: string;
  /** The gamertag. */
  gtg?: string | undefined;
  /** User hash. */
  uhs?: string | undefined;
  [key: string]: unknown;
}

export type XboxOptions = Omit<OAuthClientOptions, "scope" | "disableDefaultScope"> &
  CommonProviderOptions<XboxProfile> & {
    /**
     * The XSTS relying party. Defaults to `http://xboxlive.com`, which
     * returns the XUID and gamertag; Xbox partners can use their own.
     */
    relyingParty?: string | undefined;
    /** XSTS sandbox. Defaults to `RETAIL`. */
    sandboxId?: string | undefined;
    /** Request `xboxlive.offline_access` for a refresh token. Defaults to `false`. */
    offlineAccess?: boolean | undefined;
  };

export interface AuthenticationOptions {
  /** Sign in with Steam (OpenID 2.0). */
  steam?: SteamOptions | undefined;
  /** Sign in with Epic Games (Epic Account Services, OpenID Connect). */
  epic?: EpicOptions | undefined;
  /** Sign in with Xbox (Microsoft account, then Xbox Live). Needs Xbox developer access. */
  xbox?: XboxOptions | undefined;
}

/** The provider ids this plugin adds. */
export type AuthenticationProviderId = "steam" | "epic" | "xbox";
