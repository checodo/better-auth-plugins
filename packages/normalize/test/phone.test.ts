import { phoneNumber } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it } from "vitest";
import type { PhoneNormalizationOptions } from "../src/phone";
import { normalizePhoneNumber, phoneNormalization } from "../src/phone";

async function setup(options: PhoneNormalizationOptions = {}) {
  const otps = new Map<string, string>();
  const { auth } = await getTestInstance(
    {
      plugins: [
        phoneNumber({
          sendOTP: ({ phoneNumber, code }) => {
            otps.set(phoneNumber, code);
          },
          signUpOnVerification: { getTempEmail: (phone) => `${phone.replace("+", "")}@phone.test` },
        }),
        phoneNormalization(options),
      ],
    },
    { disableTestUser: true },
  );
  return { auth, otps, context: await auth.$context };
}

describe("normalizePhoneNumber", () => {
  it("returns E.164 for valid numbers", () => {
    expect(normalizePhoneNumber("+49 151 12345678")).toBe("+4915112345678");
    expect(normalizePhoneNumber("0151 12345678", "DE")).toBe("+4915112345678");
    expect(normalizePhoneNumber("+1 (213) 373-4253")).toBe("+12133734253");
  });

  it("returns null for invalid or national numbers without a country", () => {
    expect(normalizePhoneNumber("0151 12345678")).toBeNull();
    expect(normalizePhoneNumber("+12")).toBeNull();
    expect(normalizePhoneNumber("not a number")).toBeNull();
    expect(normalizePhoneNumber(`+49${"1".repeat(100)}`)).toBeNull();
  });
});

describe("phoneNormalization", () => {
  it("stores and finds a number in any form", async () => {
    const { auth, otps, context } = await setup({ defaultCountry: "DE" });
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: "0151 1234 5678" } });
    expect([...otps.keys()]).toEqual(["+4915112345678"]);
    const code = otps.get("+4915112345678") ?? "";
    await auth.api.verifyPhoneNumber({ body: { phoneNumber: "+49 (151) 12345678", code } });
    const users = await context.adapter.findMany<{ phoneNumber: string }>({ model: "user" });
    expect(users.map((user) => user.phoneNumber)).toEqual(["+4915112345678"]);
  });

  it("refuses invalid numbers with INVALID_PHONE_NUMBER", async () => {
    const { auth } = await setup();
    await expect(
      auth.api.sendPhoneNumberOTP({ body: { phoneNumber: "0151 1234 5678" } }),
    ).rejects.toMatchObject({ statusCode: 400, body: { code: "INVALID_PHONE_NUMBER" } });
  });

  it("validates its options", () => {
    expect(() => phoneNormalization({ defaultCountry: "Germany" })).toThrow(/defaultCountry/);
    expect(() => phoneNormalization({ defaultCountry: "de" })).not.toThrow();
  });
});
