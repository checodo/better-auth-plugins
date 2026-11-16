import { describe, expect, it } from "vitest";
import type { BlocklistRule } from "../src/types";
import { compileRule } from "../src/utils/matchers";
import { normalizeValue } from "../src/utils/normalize";
import { contextWords, emailLocalPart, foldLeetspeak } from "../src/utils/password";
import { RuleSet } from "../src/utils/rule-set";

const settings = { full: true, stripPlusAddressing: true };

describe("foldLeetspeak", () => {
  it("folds common substitutions", () => {
    expect(foldLeetspeak("p@$$w0rd")).toBe("password");
    expect(foldLeetspeak("pa55w0rd")).toBe("password");
    expect(foldLeetspeak("h3ll0")).toBe(foldLeetspeak("hello"));
    expect(foldLeetspeak("1!|l")).toBe("iiii");
  });
});

describe("password rules", () => {
  const set = (rules: BlocklistRule[]) =>
    new RuleSet(
      rules.map(
        (rule) =>
          compileRule("password", rule, settings) as NonNullable<ReturnType<typeof compileRule>>,
      ),
    );
  const match = (rules: RuleSet, password: string) => {
    const value = normalizeValue(password);
    return rules.match(value, foldLeetspeak(value));
  };

  it("compares exact and contains rules case-insensitively and leetspeak-folded", () => {
    const rules = set([
      { type: "exact", value: "password" },
      { type: "contains", value: "qwerty" },
    ]);
    expect(match(rules, "P@ssw0rd")).not.toBeNull();
    expect(match(rules, "my-QW3RTY-pass")).not.toBeNull();
    expect(match(rules, "correct horse battery staple")).toBeNull();
  });

  it("runs regex rules against the unfolded value", () => {
    const rules = set([{ type: "regex", value: "^\\d+$" }]);
    expect(match(rules, "12345678")).not.toBeNull();
    expect(match(rules, "1234567a")).toBeNull();
  });

  it("rejects ip-only and email-only rule types", () => {
    expect(compileRule("password", { type: "cidr", value: "10.0.0.0/8" }, settings)).toBeNull();
    expect(compileRule("password", { type: "domain", value: "x.com" }, settings)).toBeNull();
  });
});

describe("contextWords", () => {
  const words = (values: Parameters<typeof contextWords>[0]) =>
    contextWords(values, (value) => normalizeValue(value)).map(({ word }) => word);

  it("splits values into words and drops short ones", () => {
    expect(words({ email: "jane.doe" })).toEqual(["jane.doe", "janedoe", "jane"]);
    expect(words({ username: "al" })).toEqual([]);
  });

  it("folds leetspeak before splitting", () => {
    expect(words({ username: "J@ne_D0e" })).toEqual(["jane_doe", "janedoe", "jane"]);
  });

  it("keeps the source of each word", () => {
    expect(contextWords({ appName: "Acme" }, (value) => normalizeValue(value))).toEqual([
      { source: "appName", word: "acme" },
    ]);
  });
});

describe("emailLocalPart", () => {
  it("drops the domain and a +tag", () => {
    expect(emailLocalPart("jane+news@example.com")).toBe("jane");
    expect(emailLocalPart("jane@example.com")).toBe("jane");
    expect(emailLocalPart(undefined)).toBeUndefined();
  });
});
