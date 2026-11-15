import type { BlocklistRule, BlocklistTarget, CompiledRule } from "../types";
import { normalizeDomain, normalizeEmail, normalizeValue } from "./normalize";

/** Hard cap on regex rule length, to keep the risk of slow patterns bounded. */
export const MAX_REGEX_LENGTH = 200;

/**
 * Longest value a `regex` rule is run against. Longer values are treated
 * as matching (blocked): even a safe pattern takes quadratic time or worse
 * on an unanchored search, and organization and team names have no length
 * limit of their own. Emails (at most 254 characters) and usernames fit.
 */
export const MAX_REGEX_INPUT_LENGTH = 256;

/** At most this many unbounded quantifiers per pattern; each one multiplies the worst case by n. */
export const MAX_UNBOUNDED_QUANTIFIERS = 2;

/** At most this many quantifiers of any kind; `a?a?a?...` backtracks 2^n times. */
export const MAX_QUANTIFIERS = 8;

/** A `{n,m}` quantifier with a larger `m` counts as unbounded. */
const MAX_BOUNDED_REPEAT = 10;

interface GroupState {
  /** The group contains a quantifier or alternation, at any depth. */
  ambiguous: boolean;
}

/**
 * Parses a quantifier at `source[i]` and returns its length and whether it
 * is unbounded, or `null` if there is none there.
 */
function readQuantifier(source: string, i: number): { length: number; unbounded: boolean } | null {
  const char = source[i];
  let length: number;
  let unbounded: boolean;
  if (char === "*" || char === "+") {
    length = 1;
    unbounded = true;
  } else if (char === "?") {
    length = 1;
    unbounded = false;
  } else if (char === "{") {
    const match = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i));
    if (!match) return null;
    length = match[0].length;
    const max = match[2] === undefined ? Number(match[1]) : match[3] ? Number(match[3]) : Infinity;
    unbounded = max > MAX_BOUNDED_REPEAT;
  } else {
    return null;
  }
  // A trailing "?" makes the quantifier lazy; it doesn't change the worst case.
  if (source[i + length] === "?") length += 1;
  return { length, unbounded };
}

/**
 * Accepts only patterns whose matching time stays bounded. A pattern is
 * rejected when it is empty, longer than `MAX_REGEX_LENGTH`, or invalid,
 * or when it has:
 *
 * - a quantified group that contains a quantifier or an alternation, at
 *   any depth (`(a+)+`, `((a+))+`, `(a|aa)+`), which can backtrack
 *   exponentially;
 * - more than `MAX_UNBOUNDED_QUANTIFIERS` unbounded quantifiers (`*`, `+`,
 *   `{n,}`, `{n,m}` with `m` above 10), as in `.*.*.*x`, which is
 *   polynomial with a high degree;
 * - more than `MAX_QUANTIFIERS` quantifiers in total;
 * - a backreference (`\1`, `\k<name>`).
 *
 * Together with `MAX_REGEX_INPUT_LENGTH` this bounds the cost of a check.
 * It also rejects some harmless patterns like `(foo|bar)+`; write those
 * without the outer quantifier.
 */
export function isSafeRegexSource(source: string): boolean {
  if (source.length === 0 || source.length > MAX_REGEX_LENGTH) return false;
  try {
    new RegExp(source, "u");
  } catch {
    return false;
  }

  const stack: GroupState[] = [{ ambiguous: false }];
  const current = () => stack[stack.length - 1] as GroupState;
  let quantifiers = 0;
  let unbounded = 0;
  // The group that just closed, while a quantifier may still follow it.
  let closedGroup: GroupState | null = null;

  let i = 0;
  while (i < source.length) {
    const char = source[i] as string;
    const quantifier = readQuantifier(source, i);
    if (quantifier) {
      if (closedGroup?.ambiguous) return false;
      quantifiers += 1;
      if (quantifier.unbounded) unbounded += 1;
      if (quantifiers > MAX_QUANTIFIERS || unbounded > MAX_UNBOUNDED_QUANTIFIERS) return false;
      current().ambiguous = true;
      closedGroup = null;
      i += quantifier.length;
      continue;
    }
    closedGroup = null;

    if (char === "\\") {
      const next = source[i + 1] ?? "";
      if (/[1-9]/.test(next) || next === "k") return false;
      // Skip \p{...}, \P{...}, \u{...} as one atom.
      if (/[pPu]/.test(next) && source[i + 2] === "{") {
        i = source.indexOf("}", i) + 1;
      } else {
        i += 2;
      }
    } else if (char === "[") {
      // Skip the character class; it is a single atom.
      i += 1;
      while (i < source.length && source[i] !== "]") i += source[i] === "\\" ? 2 : 1;
      i += 1;
    } else if (char === "(") {
      stack.push({ ambiguous: false });
      // Skip "?:", "?=", "?!", "?<=", "?<!", and "?<name>".
      const prefix = /^\(\?(?::|=|!|<=|<!|<[^>]*>)?/.exec(source.slice(i));
      i += prefix ? prefix[0].length : 1;
    } else if (char === ")") {
      const group = stack.pop() as GroupState;
      if (group.ambiguous) current().ambiguous = true;
      closedGroup = group;
      i += 1;
    } else {
      if (char === "|") current().ambiguous = true;
      i += 1;
    }
  }
  return true;
}

/**
 * Returns `true` if the pattern has an uppercase letter outside an escape
 * (`\D`, `\p{Lu}`, `\u00C0`, ...) or a group name. Checked values are
 * lowercased before matching, so such a pattern can never match there.
 */
export function hasUppercaseLiteral(source: string): boolean {
  const withoutEscapes = source
    .replace(
      /\\[pPk]\{[^}]*\}|\\k<[^>]*>|\\u\{[^}]*\}|\\u[\dA-Fa-f]{4}|\\x[\dA-Fa-f]{2}|\\c[A-Za-z]|\\./g,
      "",
    )
    .replace(/\(\?<[A-Za-z_$][\w$]*>/g, "(");
  return /\p{Lu}/u.test(withoutEscapes);
}

export interface NormalizeSettings {
  /** Full normalization (Unicode forms, accents, confusables) instead of trim + lowercase only. */
  full: boolean;
  stripPlusAddressing: boolean;
}

/** Prepares a checked value of `target` for matching. */
export function normalizeTargetValue(
  target: BlocklistTarget,
  value: string,
  settings: NormalizeSettings,
): string {
  return target === "email"
    ? normalizeEmail(value, settings)
    : normalizeValue(value, settings.full);
}

/**
 * Prepares a rule for matching: normalizes its value the same way checked
 * values are normalized, or compiles its regular expression. Returns `null`
 * for rules that can never match (an unsafe regex, or a `domain` rule
 * outside the `email` target).
 */
export function compileRule(
  target: BlocklistTarget,
  rule: BlocklistRule,
  settings: NormalizeSettings,
): CompiledRule | null {
  switch (rule.type) {
    case "regex":
      if (!isSafeRegexSource(rule.value)) return null;
      return { rule, value: rule.value, regex: new RegExp(rule.value, "u") };
    case "domain":
      if (target !== "email") return null;
      return { rule, value: normalizeDomain(rule.value, settings.full) };
    case "exact":
      return { rule, value: normalizeTargetValue(target, rule.value, settings) };
    default:
      return { rule, value: normalizeValue(rule.value, settings.full) };
  }
}

/**
 * Returns `true` if the already-normalized `value` matches a `prefix`,
 * `suffix`, `contains`, or `regex` rule. `exact` and `domain` rules are
 * matched by `RuleSet` through its lookup maps, never here.
 */
export function matchesRule(value: string, compiled: CompiledRule): boolean {
  switch (compiled.rule.type) {
    case "prefix":
      return value.startsWith(compiled.value);
    case "suffix":
      return value.endsWith(compiled.value);
    case "contains":
      return value.includes(compiled.value);
    case "regex":
      // Fail closed: too long to run the pattern on safely.
      if (value.length > MAX_REGEX_INPUT_LENGTH) return true;
      return compiled.regex?.test(value) ?? false;
    default:
      return false;
  }
}
