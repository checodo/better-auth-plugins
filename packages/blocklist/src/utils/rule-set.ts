import type { CompiledRule } from "../types";
import { matchesRule } from "./matchers";
import { getEmailDomain } from "./normalize";

/**
 * Compiled rules indexed for matching. `exact` and `domain` rules are
 * looked up in maps, so large lists (such as the 10,000+ disposable email
 * domains) cost a few lookups per check instead of a scan. Other rule
 * types are checked one by one.
 */
export class RuleSet {
  readonly #exact = new Map<string, CompiledRule>();
  readonly #domains = new Map<string, CompiledRule>();
  readonly #others: CompiledRule[] = [];

  constructor(rules: Iterable<CompiledRule> = []) {
    for (const rule of rules) this.add(rule);
  }

  add(compiled: CompiledRule): void {
    const map =
      compiled.rule.type === "exact"
        ? this.#exact
        : compiled.rule.type === "domain"
          ? this.#domains
          : undefined;
    if (!map) {
      this.#others.push(compiled);
    } else if (!map.has(compiled.value)) {
      map.set(compiled.value, compiled);
    }
  }

  get size(): number {
    return this.#exact.size + this.#domains.size + this.#others.length;
  }

  /** Returns the first rule matching the already-normalized `value`, or `null`. */
  match(value: string): CompiledRule | null {
    const exact = this.#exact.get(value);
    if (exact) return exact;

    if (this.#domains.size > 0) {
      // "a.b.example.com" checks "a.b.example.com", "b.example.com", "example.com", "com".
      let domain = getEmailDomain(value);
      while (domain) {
        const rule = this.#domains.get(domain);
        if (rule) return rule;
        const dot = domain.indexOf(".");
        domain = dot === -1 ? undefined : domain.slice(dot + 1);
      }
    }

    return this.#others.find((rule) => matchesRule(value, rule)) ?? null;
  }
}
