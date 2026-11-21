/**
 * Checks that each plugin's docs pages match its code:
 *
 * - Options: every option of the plugin's options type, and of the nested
 *   `*Options` types declared in the package (target, provider options,
 *   ...), is in an option table under a `## Options` heading; and every
 *   documented option exists in the code.
 * - Schema: each `Table: \`model\`` table under `## Schema` lists exactly
 *   the fields of that model in `schema.ts` (plus `id`).
 * - Error codes: the `## Error codes` table lists exactly the codes of
 *   `error-codes.ts`, each with a status the code actually throws it with.
 *
 * Run by `pnpm check` (`pnpm check:docs`). The types are read with the
 * TypeScript compiler, so `Pick`, `Omit`, and `extends` are resolved.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

const root = join(import.meta.dirname, "..");
const docsDir = join(root, "apps/docs/content/docs");

interface PluginDocs {
  /** Package directory under `packages/`. */
  dir: string;
  /** Docs pages, relative to `apps/docs/content/docs`. */
  pages: string[];
  /** The type of the plugin function's options. */
  options: string;
  /**
   * More option types from `src/types.ts` documented in the Options
   * section, e.g. of list entries or helpers the package exports.
   */
  extraOptions?: string[];
  /** Options deliberately documented in prose instead of a table. */
  documentedInProse?: string[];
}

const PLUGINS: PluginDocs[] = [
  {
    dir: "audit-log",
    pages: ["audit-log.mdx"],
    options: "AuditLogOptions",
    extraOptions: ["AuditLogDestination", "HttpDestinationOptions"],
  },
  {
    dir: "authentication",
    pages: [
      "authentication/index.mdx",
      "authentication/steam.mdx",
      "authentication/epic-games.mdx",
      "authentication/xbox.mdx",
    ],
    options: "AuthenticationOptions",
  },
  { dir: "blocklist", pages: ["blocklist.mdx"], options: "BlocklistOptions" },
  {
    dir: "normalize",
    pages: ["normalize.mdx"],
    options: "EmailNormalizationOptions",
    extraOptions: ["PhoneNormalizationOptions"],
  },
  { dir: "referral", pages: ["referral.mdx"], options: "ReferralOptions" },
  {
    dir: "security-alerts",
    pages: ["security-alerts.mdx"],
    options: "SecurityAlertsOptions",
  },
  { dir: "waitlist", pages: ["waitlist.mdx"], options: "WaitlistOptions" },
];

const STATUS_CODES: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
};

const errors: string[] = [];
const fail = (plugin: string, message: string) => errors.push(`${plugin}: ${message}`);

// --- Docs parsing ---------------------------------------------------------

interface Section {
  /** The `## ` heading the content is under. */
  heading: string;
  lines: string[];
}

function sectionsOf(page: string): Section[] {
  const sections: Section[] = [{ heading: "", lines: [] }];
  let fence = false;
  for (const line of readFileSync(join(docsDir, page), "utf8").split("\n")) {
    if (line.startsWith("```")) fence = !fence;
    if (!fence && line.startsWith("## "))
      sections.push({ heading: line.slice(3).trim(), lines: [] });
    else sections.at(-1)?.lines.push(line);
  }
  return sections;
}

/** Top-level keys of an object literal written in TypeScript/JSX syntax. */
function objectKeys(source: string): string[] {
  const file = ts.createSourceFile("table.ts", `(${source})`, ts.ScriptTarget.Latest);
  const statement = file.statements[0];
  if (!statement || !ts.isExpressionStatement(statement)) return [];
  let expression = statement.expression;
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  if (!ts.isObjectLiteralExpression(expression)) return [];
  return expression.properties.flatMap((property) =>
    property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ? [property.name.text]
      : [],
  );
}

/** The `<TypeTable type={{ ... }} />` tables of some lines, with the line before each. */
function typeTables(lines: string[]): { keys: string[]; label: string | null }[] {
  const text = lines.join("\n");
  const tables: { keys: string[]; label: string | null }[] = [];
  const pattern = /<TypeTable\s+type=\{(\{[\s\S]*?\})\}\s*\/>/g;
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(0, match.index).trimEnd().split("\n");
    const label = [...before].reverse().find((line) => line.trim() !== "") ?? null;
    tables.push({ keys: objectKeys(match[1] ?? ""), label });
  }
  return tables;
}

// --- Code parsing ----------------------------------------------------------

function programFor(dir: string): ts.Program {
  const configPath = join(root, "packages", dir, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      },
    },
  );
  if (!parsed) throw new Error(`Can't read ${configPath}`);
  return ts.createProgram([join(root, "packages", dir, "src/types.ts")], parsed.options);
}

/** Names of the options, and of the nested `*Options` types declared in the package. */
function optionNames(dir: string, typeName: string) {
  const program = programFor(dir);
  const checker = program.getTypeChecker();
  const typesFile = program.getSourceFile(join(root, "packages", dir, "src/types.ts"));
  const symbol = typesFile && checker.getSymbolAtLocation(typesFile);
  const exported = symbol && checker.getExportsOfModule(symbol).find((s) => s.name === typeName);
  if (!exported) throw new Error(`${dir}: no exported ${typeName} in src/types.ts`);
  const packageSrc = join(root, "packages", dir, "src");

  const required = new Set<string>();
  const allowed = new Set<string>();
  const nameOf = (type: ts.Type) => type.aliasSymbol?.name ?? type.getSymbol()?.name ?? "";
  const isOwnOptionsType = (type: ts.Type) => {
    const declaration = (type.aliasSymbol ?? type.getSymbol())?.declarations?.[0];
    return (
      nameOf(type).endsWith("Options") &&
      !!declaration &&
      dirname(declaration.getSourceFile().fileName).startsWith(packageSrc)
    );
  };

  const visit = (type: ts.Type, mustDocument: boolean, depth: number) => {
    for (const property of checker.getPropertiesOfType(type)) {
      allowed.add(property.name);
      if (mustDocument) required.add(property.name);
      if (depth >= 3) continue;
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      if (!declaration) continue;
      const propertyType = checker.getNonNullableType(
        checker.getTypeOfSymbolAtLocation(property, declaration),
      );
      const parts = propertyType.isUnion() ? propertyType.types : [propertyType];
      for (const part of parts) {
        const isObject = part.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection);
        if (!isObject || part.getCallSignatures().length > 0) continue;
        if (checker.isArrayType(part)) continue;
        visit(part, isOwnOptionsType(part), depth + 1);
      }
    }
  };
  visit(checker.getDeclaredTypeOfSymbol(exported), true, 0);
  return { required, allowed };
}

/** Models and their field names from `schema.ts`. */
function schemaModels(dir: string): Map<string, Set<string>> {
  const models = new Map<string, Set<string>>();
  let source: string;
  try {
    source = readFileSync(join(root, "packages", dir, "src/schema.ts"), "utf8");
  } catch {
    return models;
  }
  const file = ts.createSourceFile("schema.ts", source, ts.ScriptTarget.Latest);
  const unwrap = (node: ts.Expression): ts.Expression =>
    ts.isSatisfiesExpression(node) || ts.isAsExpression(node) || ts.isParenthesizedExpression(node)
      ? unwrap(node.expression)
      : node;
  const nameOf = (property: ts.ObjectLiteralElementLike) =>
    property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ? property.name.text
      : null;
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer && unwrap(declaration.initializer);
      if (!init || !ts.isObjectLiteralExpression(init)) continue;
      for (const model of init.properties) {
        const modelName = nameOf(model);
        if (!modelName || !ts.isPropertyAssignment(model)) continue;
        const body = unwrap(model.initializer);
        if (!ts.isObjectLiteralExpression(body)) continue;
        const fields = body.properties.find((p) => nameOf(p) === "fields");
        if (!fields || !ts.isPropertyAssignment(fields)) continue;
        const fieldsObject = unwrap(fields.initializer);
        if (!ts.isObjectLiteralExpression(fieldsObject)) continue;
        models.set(modelName, new Set(fieldsObject.properties.flatMap((p) => nameOf(p) ?? [])));
      }
    }
  }
  return models;
}

/** Error codes from `error-codes.ts`, and the statuses the source throws each with. */
function errorCodes(dir: string) {
  const srcDir = join(root, "packages", dir, "src");
  const source = readFileSync(join(srcDir, "error-codes.ts"), "utf8");
  const codes = new Set<string>();
  for (const block of source.matchAll(/defineErrorCodes\(\{([\s\S]*?)\}\)/g)) {
    for (const match of (block[1] ?? "").matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)) {
      codes.add(match[1] ?? "");
    }
  }
  const statuses = new Map<string, Set<number>>();
  const files = ts.sys.readDirectory(srcDir, [".ts"], undefined, ["**/*"]);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(
      /APIError\.from\(\s*"([A-Z_]+)"\s*,\s*[A-Z_]+_ERROR_CODES\.([A-Z0-9_]+)/g,
    )) {
      const status = STATUS_CODES[match[1] ?? ""];
      if (!status) continue;
      const set = statuses.get(match[2] ?? "") ?? new Set<number>();
      set.add(status);
      statuses.set(match[2] ?? "", set);
    }
  }
  return { codes, statuses };
}

// --- Checks ----------------------------------------------------------------

for (const plugin of PLUGINS) {
  const name = plugin.dir;
  const sections = plugin.pages.flatMap((page) =>
    sectionsOf(page).map((section) => ({ ...section, page })),
  );

  // Options
  const documented = new Set(
    sections
      .filter((section) => section.heading === "Options")
      .flatMap((section) => typeTables(section.lines).flatMap((table) => table.keys)),
  );
  const required = new Set<string>();
  const allowed = new Set<string>();
  for (const type of [plugin.options, ...(plugin.extraOptions ?? [])]) {
    const names = optionNames(name, type);
    for (const option of names.required) required.add(option);
    for (const option of names.allowed) allowed.add(option);
  }
  const prose = new Set(plugin.documentedInProse ?? []);
  for (const option of required) {
    if (!documented.has(option) && !prose.has(option)) {
      fail(name, `option "${option}" is not in an Options table.`);
    }
  }
  for (const option of documented) {
    if (!allowed.has(option))
      fail(name, `documented option "${option}" doesn't exist in the code.`);
  }

  // Schema
  const models = schemaModels(name);
  const schemaSections = sections.filter((section) => section.heading === "Schema");
  const documentedModels = new Set<string>();
  for (const section of schemaSections) {
    for (const table of typeTables(section.lines)) {
      const model = table.label?.match(/^Table: `([^`]+)`/)?.[1];
      if (!model) {
        fail(name, `a Schema table in ${section.page} has no "Table: \`model\`" line before it.`);
        continue;
      }
      documentedModels.add(model);
      const fields = models.get(model);
      if (!fields) {
        fail(name, `documented table "${model}" is not in schema.ts.`);
        continue;
      }
      const keys = new Set(table.keys.filter((key) => key !== "id"));
      for (const field of fields) {
        if (!keys.has(field)) fail(name, `field "${model}.${field}" is not in the Schema table.`);
      }
      for (const key of keys) {
        if (!fields.has(key)) fail(name, `documented field "${model}.${key}" is not in schema.ts.`);
      }
    }
  }
  for (const model of models.keys()) {
    if (!documentedModels.has(model))
      fail(name, `table "${model}" is not documented under Schema.`);
  }

  // Error codes
  const { codes, statuses } = errorCodes(name);
  const rows = new Map<string, number>();
  for (const section of sections.filter((section) => section.heading === "Error codes")) {
    for (const line of section.lines) {
      const match = line.match(/^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|\s*(\d{3})\s*\|/);
      if (match) rows.set(match[1] ?? "", Number(match[2]));
    }
  }
  for (const code of codes) {
    if (!rows.has(code)) fail(name, `error code ${code} is not in the Error codes table.`);
  }
  for (const [code, status] of rows) {
    if (!codes.has(code)) fail(name, `documented error code ${code} is not in error-codes.ts.`);
    const thrown = statuses.get(code);
    if (thrown && !thrown.has(status)) {
      fail(name, `${code} is documented as ${status}, but thrown as ${[...thrown].join("/")}.`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Docs check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exit(1);
}
console.log(`Docs check passed: options, schemas, and error codes of ${PLUGINS.length} plugins.`);
