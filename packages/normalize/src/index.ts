/**
 * `@checodo/better-auth-normalize`: one account per inbox and per phone
 * number. Each part has its own entry point, so an app only loads
 * what it uses (the phone part brings phone-number metadata):
 *
 * - `@checodo/better-auth-normalize/email`: `emailNormalization()`
 * - `@checodo/better-auth-normalize/phone`: `phoneNormalization()`
 *
 * This entry point has what they share.
 */
export { NORMALIZE_ERROR_CODES, type NormalizeErrorCode } from "./error-codes";
export type {
  EmailNormalizationOptions,
  PhoneNormalizationOptions,
  Subaddressing,
} from "./types";
