/**
 * Leetspeak and lookalike characters, mapped to the letter they stand for.
 * `l`, `1`, `!`, and `|` all fold to `i`, so `p4ssw0rd`, `P@$$word`, and
 * `pa55w0rd` compare equal to `password`, and `h3ll0` to `hello`. Applied
 * to both sides of a comparison, after `normalizeValue`, so folding a real
 * letter (`l` to `i`) never stops a match; it only makes matching broader.
 */
const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "!": "i",
  "|": "i",
  l: "i",
  "3": "e",
  "4": "a",
  "@": "a",
  "5": "s",
  $: "s",
  "6": "g",
  "9": "g",
  "7": "t",
  "+": "t",
  "8": "b",
};

/** Folds leetspeak characters to letters (see `LEET`). Expects a normalized value. */
export function foldLeetspeak(value: string): string {
  let out = "";
  for (const char of value) out += LEET[char] ?? char;
  return out;
}

/**
 * Shorter context words are ignored: a two- or three-letter email local
 * part or username would block far too many passwords.
 */
export const MIN_CONTEXT_WORD_LENGTH = 4;

/** Where a context word comes from, as passed to `onBlocked` in the rule's value. */
export type ContextSource = "email" | "username" | "appName";

/**
 * The words a password must not contain, already normalized and folded:
 * each value whole, without separators, and each of its parts split at
 * characters other than letters and digits (`jane.doe` gives `jane.doe`,
 * `janedoe`, `jane`, and `doe`).
 * Words shorter than `MIN_CONTEXT_WORD_LENGTH` are dropped.
 */
export function contextWords(
  values: Partial<Record<ContextSource, string | null | undefined>>,
  normalize: (value: string) => string,
): { source: ContextSource; word: string }[] {
  const words: { source: ContextSource; word: string }[] = [];
  const seen = new Set<string>();
  for (const [source, raw] of Object.entries(values) as [ContextSource, unknown][]) {
    if (typeof raw !== "string") continue;
    // Fold first, so "j@ne" stays one word instead of splitting at the "@".
    const folded = foldLeetspeak(normalize(raw));
    const parts = folded.split(/[^\p{L}\p{N}]+/u);
    for (const word of [folded, parts.join(""), ...parts]) {
      if (word.length < MIN_CONTEXT_WORD_LENGTH || seen.has(word)) continue;
      seen.add(word);
      words.push({ source, word });
    }
  }
  return words;
}

/** The local part of an email address, without a `+tag`. */
export function emailLocalPart(email: unknown): string | undefined {
  if (typeof email !== "string") return undefined;
  const at = email.lastIndexOf("@");
  const local = at === -1 ? email : email.slice(0, at);
  const plus = local.indexOf("+");
  return plus === -1 ? local : local.slice(0, plus);
}
