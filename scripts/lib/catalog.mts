/**
 * Reads the default pnpm catalog (`catalog:` in `pnpm-workspace.yaml`),
 * shared by the repository's check scripts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The catalog's entries, by package name: only the indented lines under `catalog:`. */
export function readCatalog(root: string): Map<string, string> {
  const lines = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split("\n");
  const start = lines.findIndex((line) => /^catalog:\s*$/.test(line));
  const entries = new Map<string, string>();
  if (start === -1) return entries;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    // The next top-level key ends the section.
    if (!/^\s/.test(line)) break;
    const match = line.match(/^\s+"?([^":\s]+)"?:\s*(\S+)\s*$/);
    if (match?.[1] && match[2]) entries.set(match[1], match[2]);
  }
  return entries;
}

/** The catalog range of `name` (`^1.7.20`); throws if it isn't in the catalog. */
export function catalogRange(root: string, name: string): string {
  const range = readCatalog(root).get(name);
  if (!range) throw new Error(`No catalog entry for ${name} in pnpm-workspace.yaml`);
  return range;
}
