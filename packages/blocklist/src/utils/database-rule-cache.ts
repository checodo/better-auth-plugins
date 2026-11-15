import type { BlocklistTarget } from "../types";
import type { RuleSet } from "./rule-set";

/**
 * Caches the compiled database rules per target for `ttl` milliseconds, so
 * checks don't read and compile the `blocklistRule` table every time. The
 * rule endpoints call `clear()` after a change. A failed load isn't cached.
 */
export class DatabaseRuleCache {
  readonly #ttl: number;
  readonly #entries = new Map<BlocklistTarget, { expires: number; rules: Promise<RuleSet> }>();

  constructor(ttl: number) {
    this.#ttl = ttl;
  }

  get(target: BlocklistTarget, load: () => Promise<RuleSet>): Promise<RuleSet> {
    if (this.#ttl <= 0) return load();
    const cached = this.#entries.get(target);
    if (cached && cached.expires > Date.now()) return cached.rules;

    const rules = load();
    this.#entries.set(target, { expires: Date.now() + this.#ttl, rules });
    rules.catch(() => {
      if (this.#entries.get(target)?.rules === rules) this.#entries.delete(target);
    });
    return rules;
  }

  clear(): void {
    this.#entries.clear();
  }
}
