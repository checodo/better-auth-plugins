import type { InferOptionSchema } from "better-auth";
import type { EmailNormalizationSchema } from "./schema";
import type { Subaddressing } from "./utils/email";

export type { Subaddressing } from "./utils/email";

export interface EmailNormalizationOptions {
  /**
   * Which domains a `+tag` is removed at. `"known"`: only at providers
   * that document it (Gmail, Outlook, iCloud, Proton, Fastmail), where
   * Gmail also ignores dots. `"all"`: at every domain, where `+` may also
   * be part of a real address. Defaults to `"known"`.
   */
  subaddressing?: Subaddressing | undefined;
  /**
   * Replaces the built-in rules: return the address an email reaches, or
   * `null` to store none (no duplicate check for it).
   */
  normalize?: ((email: string) => string | null) | undefined;
  /**
   * Let people sign in with another form of their address
   * (`a.da+news@gmail.com` for `ada@gmail.com`): the sign-in uses the
   * stored address instead. Defaults to `false`.
   */
  allowNormalizedSignIn?: boolean | undefined;
  /** Rename the field, like better-auth's own plugins: `{ user: { fields: { normalizedEmail: "normalized_email" } } }`. */
  schema?: InferOptionSchema<EmailNormalizationSchema> | undefined;
}

export interface ResolvedEmailNormalizationOptions {
  normalize: (email: string) => string | null;
  allowNormalizedSignIn: boolean;
}

export interface PhoneNormalizationOptions {
  /**
   * The country of numbers written without a `+` and country code, as an
   * ISO 3166-1 alpha-2 code such as `"DE"` or `"US"`. Without it, such
   * numbers are refused.
   */
  defaultCountry?: string | undefined;
  /**
   * Replaces the built-in parsing: return the number in E.164
   * (`+4915112345678`), or `null` if it isn't valid.
   */
  normalize?: ((phoneNumber: string) => string | null) | undefined;
}
