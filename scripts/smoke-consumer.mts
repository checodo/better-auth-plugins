/**
 * Pack smoke test: proves the packages work the way users get them.
 *
 * 1. `pnpm pack` every public package under `packages/` (expects `dist/`
 *    to be built; `pnpm smoke` builds first).
 * 2. Inspects each tarball: only allowed files, no `catalog:` or
 *    `workspace:` ranges, and every bare import in `dist/` is declared in
 *    `dependencies` or `peerDependencies` (so nothing like `@repo/` leaks
 *    and nothing is missing at install time).
 * 3. Installs the tarballs with npm into a fresh app outside the
 *    workspace, with better-auth at the catalog version from the registry
 *    (only versions at least a day old, like the repo's pnpm policy).
 * 4. Type-checks the app (`nodenext` and `bundler` resolution) and runs it
 *    (`scripts/smoke/fixture/src/app.ts`).
 *
 * Usage: `pnpm smoke` (add `-- --keep` to keep the temporary app).
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogRange } from "./lib/catalog.mts";

const root = join(import.meta.dirname, "..");
const keep = process.argv.includes("--keep");
const work = mkdtempSync(join(tmpdir(), "better-auth-plugins-smoke-"));
const tarballs = join(work, "tarballs");
const app = join(work, "app");
mkdirSync(tarballs);

/** Files a published tarball may contain, relative to the package root. */
const allowedFiles = [
  /^package\.json$/,
  /^README\.md$/,
  /^CHANGELOG\.md$/,
  /^LICENSE\.md$/,
  /^THIRD_PARTY_NOTICES\.md$/,
  /^dist\//,
];

const errors: string[] = [];

function run(command: string, args: string[], cwd: string): string {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    throw new Error(
      `${command} ${args.join(" ")} failed in ${cwd}:\n${stdout ?? ""}${stderr ?? ""}`,
    );
  }
}

function filesIn(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesIn(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

/** Bare module specifiers imported by a built file (static, dynamic, re-exports). */
function importsOf(source: string): string[] {
  const specifiers = new Set<string>();
  // Drop comments first: JSDoc `@example` blocks contain import lines.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const clause = String.raw`(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?)`;
  const patterns = [
    new RegExp(String.raw`^\s*(?:import|export)\s+${clause}\s*from\s*["']([^"']+)["']`, "gm"),
    /^\s*import\s*["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1] ?? "";
      if (!specifier.startsWith(".") && !specifier.startsWith("node:")) specifiers.add(specifier);
    }
  }
  return [...specifiers];
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

interface Manifest {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

// 1. Pack every public package.
const packages: Manifest[] = [];
for (const dir of readdirSync(join(root, "packages"))) {
  const cwd = join(root, "packages", dir);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  } catch {
    continue;
  }
  if (manifest.private) continue;
  run("pnpm", ["pack", "--pack-destination", tarballs], cwd);
  packages.push(manifest);
}
if (packages.length === 0) throw new Error("No public packages found.");

// 2. Inspect each tarball.
const tarballFiles = readdirSync(tarballs).filter((file) => file.endsWith(".tgz"));
for (const tarball of tarballFiles) {
  const extracted = join(work, "extracted", tarball.replace(/\.tgz$/, ""));
  mkdirSync(extracted, { recursive: true });
  run("tar", ["-xzf", join(tarballs, tarball), "-C", extracted], root);
  const pkgDir = join(extracted, "package");
  const raw = readFileSync(join(pkgDir, "package.json"), "utf8");
  const manifest = JSON.parse(raw) as Manifest;

  if (/"(catalog|workspace):/.test(raw)) {
    errors.push(`${manifest.name}: package.json still contains catalog: or workspace: ranges.`);
  }
  const files = filesIn(pkgDir);
  for (const file of files) {
    if (!allowedFiles.some((pattern) => pattern.test(file))) {
      errors.push(`${manifest.name}: unexpected file in tarball: ${file}`);
    }
  }
  for (const required of ["LICENSE.md", "README.md"]) {
    if (!files.includes(required)) errors.push(`${manifest.name}: no ${required} in tarball.`);
  }
  if (!files.some((file) => file.startsWith("dist/"))) {
    errors.push(`${manifest.name}: no dist/ in tarball (was it built?).`);
  }
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  for (const file of files.filter((file) => /\.(js|d\.ts)$/.test(file))) {
    const source = readFileSync(join(pkgDir, file), "utf8");
    for (const specifier of importsOf(source)) {
      if (!declared.has(packageName(specifier))) {
        errors.push(`${manifest.name}: ${file} imports "${specifier}", which is not a dependency.`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`Smoke test failed (tarball contents):\n${errors.map((e) => `- ${e}`).join("\n")}`);
  console.error(`Work directory: ${work}`);
  process.exit(1);
}
console.log(`Packed and inspected ${tarballFiles.length} packages.`);

// 3. Install into a fresh app outside the workspace.
cpSync(join(import.meta.dirname, "smoke", "fixture"), app, { recursive: true });
const betterAuthVersion = catalogRange(root, "better-auth").replace(/^[\^~]/, "");
const dependencies: Record<string, string> = {
  "better-auth": betterAuthVersion,
  "@better-auth/core": catalogRange(root, "@better-auth/core").replace(/^[\^~]/, ""),
};
for (const tarball of tarballFiles) {
  const manifest = packages.find((pkg) =>
    tarball.startsWith(`${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}`),
  );
  if (!manifest) throw new Error(`Can't match ${tarball} to a package.`);
  dependencies[manifest.name] = `file:${join(tarballs, tarball)}`;
}
writeFileSync(
  join(app, "package.json"),
  `${JSON.stringify(
    {
      name: "smoke-consumer",
      private: true,
      type: "module",
      dependencies,
      devDependencies: {
        typescript: catalogRange(root, "typescript"),
        "@types/node": catalogRange(root, "@types/node"),
      },
    },
    null,
    2,
  )}\n`,
);
const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
run(
  "npm",
  [
    "install",
    "--no-audit",
    "--no-fund",
    "--loglevel=error",
    "--registry=https://registry.npmjs.org/",
    `--before=${oneDayAgo}`,
  ],
  app,
);
console.log(`Installed into ${app} with better-auth ${betterAuthVersion}.`);

// 4. Type-check and run.
try {
  run("npx", ["tsc", "-p", "tsconfig.json"], app);
  run("npx", ["tsc", "-p", "tsconfig.bundler.json"], app);
  console.log("Type-checked with nodenext and bundler resolution.");
  console.log(run("node", ["src/app.ts"], app).trim());
} catch (error) {
  console.error((error as Error).message);
  console.error(`Work directory kept: ${work}`);
  process.exit(1);
}

if (keep) console.log(`Kept ${work}`);
else rmSync(work, { recursive: true, force: true });
