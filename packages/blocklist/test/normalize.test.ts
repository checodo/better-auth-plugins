import { describe, expect, it } from "vitest";
import {
  getEmailDomain,
  normalizeDomain,
  normalizeEmail,
  normalizeValue,
} from "../src/utils/normalize";

describe("normalizeValue", () => {
  it("trims and lowercases", () => {
    expect(normalizeValue("  Admin  ")).toBe("admin");
  });

  it("applies NFKC", () => {
    // Fullwidth "ＡＤＭＩＮ"
    expect(normalizeValue("ＡＤＭＩＮ")).toBe("admin");
  });

  it("removes accents", () => {
    expect(normalizeValue("\u00E1dmin")).toBe("admin"); // precomposed á
    expect(normalizeValue("a\u0301dmin")).toBe("admin"); // a + combining acute
    expect(normalizeValue("Jos\u00E9")).toBe("jose");
  });

  it("matches Turkish dotted capital I, whose lowercase adds a combining dot", () => {
    expect(normalizeValue("ADM\u0130N")).toBe("admin");
  });

  it("keeps scripts whose letters decompose intact", () => {
    expect(normalizeValue("\uD55C\uAD6D\uC5B4")).toBe("\uD55C\uAD6D\uC5B4"); // Korean
    expect(normalizeValue("\u0915\u093F\u0924\u093E\u092C")).toBe("\u0915\u093F\u0924\u093E\u092C"); // Hindi
  });

  it("keeps marks that tell words apart in other scripts", () => {
    const pairs = [
      ["\u304C\u304D", "\u304B\u304D"], // Japanese がき / かき (dakuten)
      ["\u0928\u092E\u0938\u094D\u0924\u0947", "\u0928\u092E\u0938\u0924\u0947"], // Hindi नमस्ते / नमसते (virama)
      ["\u0E01\u0E34\u0E19", "\u0E01\u0E19"], // Thai กิน / กน (vowel sign)
    ];
    for (const [a = "", b = ""] of pairs) {
      expect(normalizeValue(a)).not.toBe(normalizeValue(b));
    }
  });

  it("folds common Cyrillic and Greek confusables", () => {
    expect(normalizeValue("аdmin")).toBe("admin");
    expect(normalizeValue("rοot")).toBe("root");
  });

  it("folds the Turkish dotless i", () => {
    expect(normalizeValue("admın")).toBe("admin");
  });

  it("removes invisible characters", () => {
    const invisible = [
      "​", // zero-width space
      "‌", // zero-width non-joiner
      "‍", // zero-width joiner
      "⁠", // word joiner
      "﻿", // zero-width no-break space
      "­", // soft hyphen
      "‮", // right-to-left override
      "️", // variation selector
      "ㅤ", // Hangul filler
    ];
    for (const char of invisible) {
      expect(normalizeValue(`ad${char}min`)).toBe("admin");
    }
    expect(normalizeValue("​ admin ​")).toBe("admin");
  });

  it("only trims and lowercases when full normalization is off", () => {
    expect(normalizeValue(" аDMIN ", false)).toBe("аdmin");
  });
});

describe("normalizeEmail", () => {
  it("drops trailing dots of the domain", () => {
    expect(normalizeEmail("user@Mailinator.com.")).toBe("user@mailinator.com");
    expect(normalizeEmail("user+tag@mailinator.com..")).toBe("user@mailinator.com");
    expect(normalizeEmail("user@mailinator.com.", { stripPlusAddressing: false })).toBe(
      "user@mailinator.com",
    );
  });

  it("trims and lowercases", () => {
    expect(normalizeEmail(" User@Example.COM ")).toBe("user@example.com");
  });

  it("strips the +tag by default", () => {
    expect(normalizeEmail("user+a+b@example.com")).toBe("user@example.com");
  });

  it("keeps the +tag when stripping is off", () => {
    expect(normalizeEmail("user+spam@example.com", { stripPlusAddressing: false })).toBe(
      "user+spam@example.com",
    );
  });

  it("skips confusable folding when full normalization is off", () => {
    expect(normalizeEmail("а@example.com", { full: false })).toBe("а@example.com");
  });
});

describe("normalizeDomain", () => {
  it("drops trailing dots", () => {
    expect(normalizeDomain("mailinator.com.")).toBe("mailinator.com");
  });

  it("accepts a leading @ or dot", () => {
    expect(normalizeDomain("@Example.com")).toBe("example.com");
    expect(normalizeDomain(".example.com")).toBe("example.com");
  });
});

describe("getEmailDomain", () => {
  it("extracts the domain", () => {
    expect(getEmailDomain("user@example.com")).toBe("example.com");
  });

  it("returns undefined without an @", () => {
    expect(getEmailDomain("not-an-email")).toBeUndefined();
  });
});
