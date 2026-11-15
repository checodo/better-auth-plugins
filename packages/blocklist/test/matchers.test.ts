import { describe, expect, it } from "vitest";
import type { BlocklistRule } from "../src/types";
import {
  compileRule,
  hasUppercaseLiteral,
  isSafeRegexSource,
  MAX_REGEX_INPUT_LENGTH,
  matchesRule,
} from "../src/utils/matchers";

const settings = { full: true, stripPlusAddressing: true };

function matches(target: Parameters<typeof compileRule>[0], rule: BlocklistRule, value: string) {
  const compiled = compileRule(target, rule, settings);
  if (!compiled) throw new Error("rule did not compile");
  return matchesRule(value, compiled);
}

describe("matchesRule", () => {
  it("matches prefix, suffix, and contains", () => {
    expect(matches("team", { type: "prefix", value: "support" }, "support-team")).toBe(true);
    expect(matches("team", { type: "suffix", value: "support" }, "team-support")).toBe(true);
    expect(matches("team", { type: "contains", value: "admin" }, "the-admin-panel")).toBe(true);
  });

  it("matches regex rules", () => {
    const rule: BlocklistRule = { type: "regex", value: "^admin-.*$" };
    expect(matches("username", rule, "admin-panel")).toBe(true);
    expect(matches("username", rule, "panel-admin")).toBe(false);
  });

  it("treats values too long for a regex as matching", () => {
    const rule: BlocklistRule = { type: "regex", value: "^admin-.*$" };
    expect(matches("team", rule, "x".repeat(MAX_REGEX_INPUT_LENGTH))).toBe(false);
    expect(matches("team", rule, "x".repeat(MAX_REGEX_INPUT_LENGTH + 1))).toBe(true);
  });

  it("keeps the worst case of accepted patterns fast", () => {
    // About 25 ms each on an idle laptop, about 100 ms while every package's
    // tests run in parallel. What this guards against is catastrophic
    // backtracking, which takes seconds or never ends, so the limit leaves
    // room for load. The fastest of several runs is measured: load can only
    // slow a run down.
    const worst = ["^.*.*x", ".*.*x", "[a-z]+[a-z]+x", "a?a?a?a?a?a?a?a?aaaaaaaa", "(ab)+(cd)*x"];
    const inputs = ["a".repeat(MAX_REGEX_INPUT_LENGTH), "ab".repeat(128)];
    for (const value of worst) {
      expect(isSafeRegexSource(value)).toBe(true);
      const compiled = compileRule("team", { type: "regex", value }, settings);
      if (!compiled) throw new Error("rule did not compile");
      let fastest = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 5; run++) {
        const start = performance.now();
        for (const input of inputs) matchesRule(input, compiled);
        fastest = Math.min(fastest, performance.now() - start);
      }
      expect(fastest, value).toBeLessThan(1000);
    }
  });
});

describe("compileRule", () => {
  it("normalizes exact email rules like checked emails (+tag, case)", () => {
    expect(compileRule("email", { type: "exact", value: "A+x@Example.com" }, settings)?.value).toBe(
      "a@example.com",
    );
  });

  it("normalizes domain rules and drops a leading @", () => {
    expect(compileRule("email", { type: "domain", value: "@Spam.IO" }, settings)?.value).toBe(
      "spam.io",
    );
  });

  it("refuses unsafe regex rules", () => {
    expect(compileRule("username", { type: "regex", value: "(a+)+$" }, settings)).toBeNull();
  });

  it("refuses domain rules outside the email target", () => {
    expect(compileRule("username", { type: "domain", value: "x.com" }, settings)).toBeNull();
  });

  it("leaves regex sources untouched", () => {
    expect(compileRule("username", { type: "regex", value: "^Admin$" }, settings)?.value).toBe(
      "^Admin$",
    );
  });
});

describe("hasUppercaseLiteral", () => {
  it("flags uppercase letters in the pattern", () => {
    expect(hasUppercaseLiteral("^Admin$")).toBe(true);
    expect(hasUppercaseLiteral("[A-Z]+")).toBe(true);
  });

  it("ignores escapes and group names", () => {
    expect(hasUppercaseLiteral("^admin\\D\\S\\W\\B$")).toBe(false);
    expect(hasUppercaseLiteral("\\p{Lu}\\P{L}\\u00C0\\u{1F600}\\x4A\\cJ")).toBe(false);
    expect(hasUppercaseLiteral("(?<Name>admin)\\k<Name>")).toBe(false);
    expect(hasUppercaseLiteral("^admin\\d+$")).toBe(false);
  });
});

describe("isSafeRegexSource", () => {
  it("accepts normal patterns", () => {
    expect(isSafeRegexSource("^foo.*bar$")).toBe(true);
    expect(isSafeRegexSource("^[a-z]+_\\d{2,4}$")).toBe(true);
    expect(isSafeRegexSource("^(?:support|help)[-_.]?\\d*$")).toBe(true);
    expect(isSafeRegexSource("^(?<word>admin)\\p{N}+$")).toBe(true);
    expect(isSafeRegexSource("^[(+*)]+(ab)+$")).toBe(true);
  });

  it("rejects nested quantifiers inside nested groups", () => {
    expect(isSafeRegexSource("((a+))+$")).toBe(false);
    expect(isSafeRegexSource("(?:(a+))+$")).toBe(false);
    expect(isSafeRegexSource("(x(a|b))*")).toBe(false);
    expect(isSafeRegexSource("(a{2})+")).toBe(false);
    expect(isSafeRegexSource("(?<n>a+){2,}")).toBe(false);
  });

  it("rejects too many unbounded quantifiers", () => {
    expect(isSafeRegexSource(".*.*x")).toBe(true);
    expect(isSafeRegexSource(".*.*.*x")).toBe(false);
    expect(isSafeRegexSource("a+b*c{2,}")).toBe(false);
    expect(isSafeRegexSource("a.{1,100}b.{1,100}c.{1,100}")).toBe(false);
    expect(isSafeRegexSource("\\d{4}-\\d{2}-\\d{2}")).toBe(true);
  });

  it("rejects too many quantifiers", () => {
    expect(isSafeRegexSource("a?".repeat(8))).toBe(true);
    expect(isSafeRegexSource("a?".repeat(9))).toBe(false);
  });

  it("rejects backreferences", () => {
    expect(isSafeRegexSource("(a)\\1")).toBe(false);
    expect(isSafeRegexSource("(?<n>a)\\k<n>")).toBe(false);
  });

  it("rejects empty or overly long patterns", () => {
    expect(isSafeRegexSource("")).toBe(false);
    expect(isSafeRegexSource("a".repeat(201))).toBe(false);
  });

  it("rejects invalid syntax", () => {
    expect(isSafeRegexSource("(unclosed")).toBe(false);
  });

  it("rejects nested quantifiers", () => {
    expect(isSafeRegexSource("(a+)+")).toBe(false);
    expect(isSafeRegexSource("(a*)*")).toBe(false);
    expect(isSafeRegexSource("(a{1,})+")).toBe(false);
  });

  it("rejects quantified groups with alternatives", () => {
    expect(isSafeRegexSource("^(a|aa)+$")).toBe(false);
    expect(isSafeRegexSource("(a|a)*")).toBe(false);
    expect(isSafeRegexSource("^(foo|bar)$")).toBe(true);
  });
});
