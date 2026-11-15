/**
 * Pure helpers of `update-lists.ts`: parsing the sources and merging them.
 * Kept apart from the script, which runs on import, so they can be tested.
 */
import { domainToASCII } from "node:url";

/** One entry per line; blank lines and `#` comments are skipped. */
export const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

/** `{ "provider.com": { hosts: ["alias.com", ...] } }` to every listed domain. */
export const mailServiceHosts = (text: string) =>
  Object.entries(JSON.parse(text) as Record<string, { hosts?: string[] }>).flatMap(
    ([domain, service]) => [domain, ...(service.hosts ?? [])],
  );

/**
 * The Public Suffix List format: `//` comments, rules such as `*.ck` and
 * `!www.ck` become `ck` and `www.ck`, internationalized names become
 * punycode.
 */
export const parsePublicSuffixList = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//"))
    .map((line) => domainToASCII(line.replace(/^(\*\.|!)/, "")))
    .filter((line) => line !== "");

export const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

/**
 * Merges source entries: drops invalid ones, removes `excluded` entries and
 * public suffixes, de-duplicates, and sorts in plain code-unit order
 * (deterministic; every valid entry is ASCII).
 */
export function mergeEntries(
  sources: readonly (readonly string[])[],
  {
    valid,
    excluded = new Set(),
    publicSuffixes = new Set(),
  }: { valid: RegExp; excluded?: ReadonlySet<string>; publicSuffixes?: ReadonlySet<string> },
) {
  const merged = new Set<string>();
  const suffixesRemoved = new Set<string>();
  let invalid = 0;
  let removed = 0;
  for (const raw of sources.flat()) {
    const entry = raw.trim().toLowerCase();
    if (!valid.test(entry)) invalid++;
    else if (excluded.has(entry)) removed++;
    else if (publicSuffixes.has(entry)) suffixesRemoved.add(entry);
    else merged.add(entry);
  }
  return {
    entries: [...merged].sort(),
    invalid,
    removed,
    suffixesRemoved: [...suffixesRemoved].sort(),
  };
}
