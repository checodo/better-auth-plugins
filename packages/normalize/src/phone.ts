import type { BetterAuthOptions, BetterAuthPlugin } from "@better-auth/core";
import { createFail } from "@repo/plugin-utils/options";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { CountryCode } from "libphonenumber-js";
import { getCountries, parsePhoneNumberFromString } from "libphonenumber-js";
import { version } from "../package.json";
import { NORMALIZE_ERROR_CODES } from "./error-codes";
import type { PhoneNormalizationOptions } from "./types";

export type { PhoneNormalizationOptions } from "./types";

const PLUGIN_ID = "normalize-phone";
const fail: (message: string) => never = createFail("normalize");
/** Longest input parsed; real numbers are far shorter. */
const MAX_INPUT_LENGTH = 64;

/**
 * A phone number in E.164 (`+4915112345678`), or `null` if it isn't a
 * valid number. Numbers without a `+` and country code need
 * `defaultCountry`.
 */
export function normalizePhoneNumber(
  phoneNumber: string,
  defaultCountry?: CountryCode,
): string | null {
  if (phoneNumber.length > MAX_INPUT_LENGTH) return null;
  const parsed = parsePhoneNumberFromString(phoneNumber, defaultCountry);
  return parsed?.isValid() ? parsed.number : null;
}

const invalid = () => APIError.from("BAD_REQUEST", NORMALIZE_ERROR_CODES.INVALID_PHONE_NUMBER);

/**
 * Stores every phone number of better-auth's `phoneNumber` plugin in E.164
 * (`+4915112345678`), whatever the user typed (`0151 1234 5678`,
 * `+49 (151) 12345678`), so one number can't make two accounts, and sign-in
 * and OTPs work with any way of writing it. Invalid numbers are refused.
 *
 * @example
 * ```ts
 * import { betterAuth } from "better-auth";
 * import { phoneNumber } from "better-auth/plugins";
 * import { phoneNormalization } from "@checodo/better-auth-normalize/phone";
 *
 * export const auth = betterAuth({
 *   plugins: [phoneNumber({ sendOTP }), phoneNormalization({ defaultCountry: "DE" })],
 * });
 * ```
 */
export const phoneNormalization = (options: PhoneNormalizationOptions = {}) => {
  const country = options.defaultCountry?.toUpperCase();
  if (country !== undefined && !(getCountries() as string[]).includes(country)) {
    fail(
      `"defaultCountry" must be an ISO 3166-1 alpha-2 code such as "DE", got ${JSON.stringify(options.defaultCountry)}.`,
    );
  }
  if (options.normalize !== undefined && typeof options.normalize !== "function") {
    fail('"normalize" must be a function.');
  }
  const normalize =
    options.normalize ?? ((value: string) => normalizePhoneNumber(value, country as CountryCode));

  /** The stored form of `value`; throws for an invalid number. */
  const toE164 = (value: string) => {
    const normalized = normalize(value);
    if (!normalized) throw invalid();
    return normalized;
  };

  const databaseHooks: BetterAuthOptions["databaseHooks"] = {
    user: {
      create: {
        before: async (user) => {
          const value = (user as { phoneNumber?: unknown }).phoneNumber;
          if (typeof value !== "string") return;
          return { data: { ...user, phoneNumber: toE164(value) } };
        },
      },
      update: {
        before: async (data) => {
          const value = (data as { phoneNumber?: unknown }).phoneNumber;
          if (typeof value !== "string") return;
          return { data: { ...data, phoneNumber: toE164(value) } };
        },
      },
    },
  };

  return {
    id: PLUGIN_ID,
    version,
    init(ctx) {
      if (!ctx.options.plugins?.some((plugin) => plugin.id === "phone-number")) {
        ctx.logger.warn(
          `[${PLUGIN_ID}] better-auth's phoneNumber plugin isn't configured, so there are no phone numbers to normalize.`,
        );
      }
      return { options: { databaseHooks } };
    },
    hooks: {
      before: [
        {
          // Every request with a phone number (send OTP, verify, sign in,
          // password reset, ...): the same number in any form finds the
          // same user and the same OTP.
          matcher: (ctx) =>
            typeof (ctx.body as { phoneNumber?: unknown } | undefined)?.phoneNumber === "string",
          handler: createAuthMiddleware(async (ctx) => {
            const body = ctx.body as { phoneNumber: string };
            return { context: { body: { ...body, phoneNumber: toE164(body.phoneNumber) } } };
          }),
        },
      ],
    },
    $ERROR_CODES: NORMALIZE_ERROR_CODES,
    options,
  } satisfies BetterAuthPlugin;
};

export type PhoneNormalizationPlugin = ReturnType<typeof phoneNormalization>;

declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    "normalize-phone": {
      creator: typeof phoneNormalization;
    };
  }
}
