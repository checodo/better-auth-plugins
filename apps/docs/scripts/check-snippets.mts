/**
 * Type-checks the TypeScript code samples of the docs (and of the package
 * READMEs) against the real packages, so a renamed option, endpoint, or field breaks the build
 * instead of the reader's code.
 *
 * - Every sample gets the names of `snippet-prelude.ts` it doesn't import
 *   or declare itself: `auth`, `authClient`, the plugin functions, and
 *   placeholders like `token` or `sendEmail` that the prose explains.
 * - A sample whose code fence has `no-check` in its meta is skipped
 *   (partial code, pseudo-code). Use it sparingly.
 *
 * Run by `pnpm --filter docs typecheck`.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const docsRoot = join(import.meta.dirname, "..");
const contentDir = join(docsRoot, "content/docs");
const outDir = join(docsRoot, ".snippets");
const preludePath = join(import.meta.dirname, "snippet-prelude.ts");

interface Snippet {
  page: string;
  /** 1-based line of the first code line in the page. */
  line: number;
  file: string;
  /** Lines added before the sample's code in the generated file. */
  offset: number;
}

function pagesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return pagesIn(path);
    return entry.endsWith(".mdx") ? [path] : [];
  });
}

/** Names a sample imports or declares at its top level. */
function declaredNames(code: string): Set<string> {
  const file = ts.createSourceFile("sample.ts", code, ts.ScriptTarget.Latest, false);
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else
      for (const element of name.elements)
        if (!ts.isOmittedExpression(element)) addBinding(element.name);
  };
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name) names.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) names.add(element.name.text);
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations)
        addBinding(declaration.name);
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
    }
  }
  return names;
}

/** The names `snippet-prelude.ts` exports. */
function preludeExports(): string[] {
  const program = ts.createProgram([preludePath], { module: ts.ModuleKind.ESNext });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(preludePath);
  const symbol = file && checker.getSymbolAtLocation(file);
  if (!symbol) throw new Error("Can't read snippet-prelude.ts");
  return checker.getExportsOfModule(symbol).map((exported) => exported.name);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const prelude = preludeExports();
const snippets: Snippet[] = [];
let skipped = 0;

const repoRoot = join(docsRoot, "../..");
const readmes = readdirSync(join(repoRoot, "packages")).flatMap((dir) => {
  const readme = join(repoRoot, "packages", dir, "README.md");
  try {
    statSync(readme);
    return [readme];
  } catch {
    return [];
  }
});

for (const page of [...pagesIn(contentDir), ...readmes]) {
  const lines = readFileSync(page, "utf8").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const fence = lines[index]?.match(/^```(ts|tsx|typescript)\b(.*)$/);
    if (!fence) continue;
    const start = index + 1;
    let end = start;
    while (end < lines.length && !lines[end]?.startsWith("```")) end++;
    index = end;
    if (/\bno-check\b/.test(fence[2] ?? "")) {
      skipped++;
      continue;
    }
    const code = lines.slice(start, end).join("\n");
    const pageName = page.startsWith(contentDir)
      ? relative(contentDir, page)
      : relative(repoRoot, page);
    const file = join(
      outDir,
      `${pageName.replace(/\.mdx?$/, "").replace(/[/\\]/g, "__")}-${start + 1}.${fence[1] === "tsx" ? "tsx" : "ts"}`,
    );
    const own = declaredNames(code);
    const names = prelude.filter((name) => !own.has(name));
    const from = relative(outDir, preludePath).replace(/\\/g, "/").replace(/\.ts$/, "");
    const header =
      names.length > 0
        ? `import { ${names.join(", ")} } from "${from.startsWith(".") ? from : `./${from}`}";\n`
        : "";
    writeFileSync(file, `${header}${code}\nexport {};\n`);
    snippets.push({ page: pageName, line: start + 1, file, offset: header ? 1 : 0 });
  }
}

const program = ts.createProgram(
  snippets.map((snippet) => snippet.file),
  {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.ReactJSX,
    types: ["node"],
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
  },
);
const diagnostics = ts.getPreEmitDiagnostics(program);
const problems: string[] = [];
for (const diagnostic of diagnostics) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const snippet = snippets.find((s) => s.file === diagnostic.file?.fileName);
  if (!snippet || !diagnostic.file || diagnostic.start === undefined) {
    problems.push(message);
    continue;
  }
  const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  problems.push(`${snippet.page}:${snippet.line + line - snippet.offset}: ${message}`);
}

if (problems.length > 0) {
  console.error(`Docs code samples don't type-check:\n${problems.map((p) => `- ${p}`).join("\n")}`);
  console.error(`Generated files: ${relative(process.cwd(), outDir)}`);
  process.exit(1);
}
rmSync(outDir, { recursive: true, force: true });
console.log(`Type-checked ${snippets.length} docs code samples (${skipped} marked no-check).`);
