import { describe, expect, it } from "vitest";
import { normalizeEmailAddress } from "../src/utils/email";

describe("normalizeEmailAddress", () => {
  it.each([
    ["Ada@Example.com", "ada@example.com"],
    [" ada@example.com ", "ada@example.com"],
    ["ada@example.com.", "ada@example.com"],
    ["a.da+news@gmail.com", "ada@gmail.com"],
    ["A.D.A@googlemail.com", "ada@gmail.com"],
    ["ada+x@outlook.com", "ada@outlook.com"],
    ["a.da@outlook.com", "a.da@outlook.com"],
    ["ada+x@icloud.com", "ada@icloud.com"],
    ["ada+x@proton.me", "ada@proton.me"],
    ["ada+x@fastmail.com", "ada@fastmail.com"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeEmailAddress(input)).toBe(expected);
  });

  it("keeps tags at other domains unless asked", () => {
    expect(normalizeEmailAddress("ada+x@example.com")).toBe("ada+x@example.com");
    expect(normalizeEmailAddress("ada+x@example.com", "all")).toBe("ada@example.com");
  });

  it("doesn't merge Yahoo hyphens, which can be part of a name", () => {
    expect(normalizeEmailAddress("ada-lovelace@yahoo.com")).toBe("ada-lovelace@yahoo.com");
  });

  it("keeps a local part that is only a tag or only dots", () => {
    expect(normalizeEmailAddress("+news@gmail.com")).toBe("+news@gmail.com");
    expect(normalizeEmailAddress("...@gmail.com")).toBe("...@gmail.com");
  });

  it("returns null for something that isn't an address", () => {
    for (const input of ["", "ada", "@example.com", "ada@", "ada@."]) {
      expect(normalizeEmailAddress(input)).toBeNull();
    }
  });
});
