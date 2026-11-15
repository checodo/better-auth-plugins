import { describe, expect, it } from "vitest";
import type { BlocklistRule, BlocklistTarget } from "../src/types";
import { compileRule } from "../src/utils/matchers";
import { RuleSet } from "../src/utils/rule-set";

const settings = { full: true, stripPlusAddressing: true };

function ruleSet(target: BlocklistTarget, rules: BlocklistRule[]) {
  return new RuleSet(
    rules.map((rule) => {
      const compiled = compileRule(target, rule, settings);
      if (!compiled) throw new Error("rule did not compile");
      return compiled;
    }),
  );
}

describe("RuleSet", () => {
  it("matches exact rules", () => {
    const set = ruleSet("username", [{ type: "exact", value: "Admin" }]);
    expect(set.match("admin")?.rule.value).toBe("Admin");
    expect(set.match("admins")).toBeNull();
  });

  it("matches domains and their subdomains, but not lookalikes", () => {
    const set = ruleSet("email", [{ type: "domain", value: "example.com" }]);
    expect(set.match("a@example.com")).not.toBeNull();
    expect(set.match("a@x.y.example.com")).not.toBeNull();
    expect(set.match("a@notexample.com")).toBeNull();
    expect(set.match("a@example.com.evil.io")).toBeNull();
    expect(set.match("no-at-sign")).toBeNull();
  });

  it("checks the other rule types one by one", () => {
    const set = ruleSet("team", [
      { type: "prefix", value: "sup" },
      { type: "regex", value: "^x\\d+$" },
    ]);
    expect(set.match("support")?.rule.type).toBe("prefix");
    expect(set.match("x42")?.rule.type).toBe("regex");
    expect(set.match("team")).toBeNull();
  });

  it("keeps the first of duplicate rules", () => {
    const set = ruleSet("username", [
      { type: "exact", value: "root", reason: "first" },
      { type: "exact", value: "ROOT", reason: "second" },
    ]);
    expect(set.size).toBe(1);
    expect(set.match("root")?.rule.reason).toBe("first");
  });
});
