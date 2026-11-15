/**
 * Confusable Unicode characters often used to evade blocklists (homoglyph
 * attacks), mapped to the Latin letter they look like. A small, high-value
 * subset (Cyrillic and Greek letters), not a full confusables table.
 * Applied after lowercasing, so only lowercase forms are needed.
 */
const CONFUSABLES: Record<string, string> = {
  а: "a",
  е: "e",
  к: "k",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  ѕ: "s",
  і: "i",
  // Turkish dotless i; NFKD leaves it alone.
  ı: "i",
  ј: "j",
  ԁ: "d",
  α: "a",
  ε: "e",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  υ: "u",
  χ: "x",
};

/** The Combining Diacritical Marks block: accents on Latin, Greek, and Cyrillic letters. */
const COMBINING_ACCENTS = /[\u0300-\u036f]/g;

/**
 * Characters that are invisible when rendered: zero-width spaces and
 * joiners, the soft hyphen, bidi controls, variation selectors, the
 * Hangul filler, ... Inserted into `admin`, they would slip past an
 * `exact` rule while looking the same.
 */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;

function foldConfusables(input: string): string {
  let out = "";
  for (const char of input) {
    out += CONFUSABLES[char] ?? char;
  }
  return out;
}

/**
 * Prepares a value for comparison. Always trims and lowercases. With
 * `full` (the default), it also:
 *
 * - applies Unicode compatibility decomposition (NFKD), so fullwidth
 *   `ＡＤＭＩＮ` and ligatures such as `ﬁ` become plain letters;
 * - removes accents (the combining diacritical marks U+0300 to U+036F),
 *   so `ádmin` and Turkish `ADMİN` match `admin`. They are removed after
 *   lowercasing, because `"İ".toLowerCase()` adds a combining dot. Marks
 *   of other scripts (Japanese dakuten, Devanagari virama, Thai vowels)
 *   are kept, because they tell words apart there;
 * - removes invisible characters (zero-width spaces, soft hyphens, bidi
 *   controls, variation selectors, ...);
 * - recomposes the rest (NFC), so scripts such as Hangul stay intact;
 * - folds confusable characters (Cyrillic `а` to Latin `a`, ...).
 *
 * Used for comparison only, never for what is stored.
 */
export function normalizeValue(value: string, full = true): string {
  if (!full) return value.trim().toLowerCase();
  const decomposed = value.normalize("NFKD").replace(INVISIBLE, "").trim().toLowerCase();
  return foldConfusables(decomposed.replace(COMBINING_ACCENTS, "").normalize("NFC"));
}

/**
 * Drops trailing dots from the domain: `example.com.` is the same host as
 * `example.com` (a fully qualified name), so it must not slip past a
 * `domain` rule. Email sign-up rejects such addresses, but emails from
 * OAuth providers or server code aren't validated the same way.
 */
function withoutTrailingDots(email: string): string {
  return email.includes("@") ? email.replace(/\.+$/, "") : email;
}

/**
 * Prepares an email address for comparison: `normalizeValue`, then drops
 * trailing dots of the domain and optionally drops a `+tag` from the local part so `user+tag@example.com`
 * compares equal to `user@example.com`.
 */
export function normalizeEmail(
  email: string,
  options: { full?: boolean; stripPlusAddressing?: boolean } = {},
): string {
  const normalized = withoutTrailingDots(normalizeValue(email, options.full ?? true));
  if (options.stripPlusAddressing === false) return normalized;

  const atIndex = normalized.lastIndexOf("@");
  if (atIndex === -1) return normalized;

  const local = normalized.slice(0, atIndex);
  const plusIndex = local.indexOf("+");
  if (plusIndex === -1) return normalized;

  return `${local.slice(0, plusIndex)}${normalized.slice(atIndex)}`;
}

/** Returns the part after the last `@`, or `undefined` if there is none. */
export function getEmailDomain(email: string): string | undefined {
  const atIndex = email.lastIndexOf("@");
  return atIndex === -1 ? undefined : email.slice(atIndex + 1);
}

/** Normalizes a `domain` rule value, accepting `@example.com`, `.example.com`, and `example.com.` too. */
export function normalizeDomain(domain: string, full = true): string {
  return normalizeValue(domain, full)
    .replace(/^[@.]+/, "")
    .replace(/\.+$/, "");
}
