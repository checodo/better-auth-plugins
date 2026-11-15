/**
 * Fails when the better-auth version range drifts between the places that
 * state it:
 *
 * - every package under `packages/` must take `better-auth` and
 *   `@better-auth/core` from the pnpm catalog (`catalog:`), as peer and dev
 *   dependency, so they all share one range;
 * - the Requirements line of the docs, and of each package README, must
 *   name the catalog's minimum.
 *
 * Run by `pnpm check`. Node runs this file directly (type stripping).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogRange } from "./lib/catalog.mts";

const root = join(import.meta.dirname, "..");
const peers = ["better-auth", "@better-auth/core"] as const;
const docsPage = "apps/docs/content/docs/index.mdx";

const errors: string[] = [];

const ranges = peers.map((name) => catalogRange(root, name));
if (new Set(ranges).size !== 1) {
  errors.push(`The catalog ranges of ${peers.join(" and ")} differ: ${ranges.join(" vs ")}.`);
}
const minimum = (ranges[0] ?? "").replace(/^[\^~>=]+/, "");

for (const dir of readdirSync(join(root, "packages"))) {
  let pkg: {
    name: string;
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8"));
  } catch {
    continue;
  }
  if (!pkg.peerDependencies) continue;
  for (const name of peers) {
    for (const field of ["peerDependencies", "devDependencies"] as const) {
      const range = pkg[field]?.[name];
      if (range !== "catalog:") {
        errors.push(
          `${pkg.name}: ${field}["${name}"] is ${JSON.stringify(range)}, expected "catalog:".`,
        );
      }
    }
  }
}

// The docs Requirements line, and the same line in each package README.
const requirementFiles = [
  docsPage,
  ...readdirSync(join(root, "packages")).flatMap((dir) => {
    try {
      readFileSync(join(root, "packages", dir, "README.md"));
      return [`packages/${dir}/README.md`];
    } catch {
      return [];
    }
  }),
];
for (const file of requirementFiles) {
  const text = readFileSync(join(root, file), "utf8");
  const requirement = text.match(/`better-auth` and `@better-auth\/core`\s+(\S+)\s+or a later/);
  if (requirement?.[1] !== minimum) {
    errors.push(
      `${file}: the requirement names ${JSON.stringify(requirement?.[1] ?? null)}, ` +
        `but the catalog minimum is ${minimum}.`,
    );
  }
}

if (errors.length > 0) {
  console.error(`Version check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exit(1);
}
console.log(`Version check passed: better-auth ${ranges[0]} everywhere.`);
