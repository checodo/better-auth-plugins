import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  escapeMdx,
  latestVersion,
  readPackages,
  releaseUrl,
  renderIndexPage,
  renderMeta,
  renderPackagePage,
  writeChangelog,
} from "../scripts/changelog.mts";

const changelog = `# @checodo/better-auth-waitlist

## 0.3.0

### Minor Changes

- daa1c02: Adds \`ENTRY_CHANGED\` (<409>) for {concurrent} requests.

  \`\`\`ts
  const x = { a: 1 };
  \`\`\`

## 0.2.0

### Patch Changes

- Without a commit.
`;

const waitlist = {
  dir: "waitlist",
  name: "@checodo/better-auth-waitlist",
  title: "Waitlist",
  changelog,
};

describe("changelog pages", () => {
  it("escapes JSX and expressions outside inline code", () => {
    expect(escapeMdx("a <b> {c} `<d> {e}`")).toBe("a \\<b> \\{c\\} `<d> {e}`");
  });

  it("turns autolinks, which MDX doesn't support, into links", () => {
    expect(escapeMdx("See <https://example.com/a?b=1> or <mailto:ada@example.com>.")).toBe(
      "See [https://example.com/a?b=1](https://example.com/a?b=1) or [mailto:ada@example.com](mailto:ada@example.com).",
    );
    expect(escapeMdx("`<https://example.com>`")).toBe("`<https://example.com>`");
  });

  it("links a version to its GitHub release tag", () => {
    expect(releaseUrl("@checodo/better-auth-waitlist", "0.3.0")).toBe(
      "https://github.com/checodo/better-auth-plugins/releases/tag/%40checodo%2Fbetter-auth-waitlist%400.3.0",
    );
  });

  it("finds the newest version", () => {
    expect(latestVersion(changelog)).toBe("0.3.0");
    expect(latestVersion("# @checodo/x\n")).toBeUndefined();
  });

  it("turns a CHANGELOG.md into a plugin's page, newest version first", () => {
    const page = renderPackagePage(waitlist);
    expect(page).toMatch(/^---\ntitle: Waitlist\n/);
    expect(page).not.toContain("# @checodo/better-auth-waitlist\n");
    expect(page).toContain("[Waitlist docs](/docs/waitlist)");
    expect(page).toContain(
      `## 0.3.0 [#v0-3-0]\n\n[Release on GitHub](${releaseUrl(waitlist.name, "0.3.0")})`,
    );
    expect(page.indexOf("## 0.3.0")).toBeLessThan(page.indexOf("## 0.2.0"));
    expect(page).toContain("### Minor Changes");
    expect(page).toContain(
      "- [daa1c02](https://github.com/checodo/better-auth-plugins/commit/daa1c02): Adds `ENTRY_CHANGED` (\\<409>) for \\{concurrent\\} requests.",
    );
    expect(page).toContain("- Without a commit.");
    // Code samples are kept as they are, and not type-checked.
    expect(page).toContain("  ```ts no-check\n  const x = { a: 1 };\n  ```");
    expect(page).not.toMatch(/\n{3,}/);
  });

  it("lists every plugin with its current version on the overview, with the 0.x note", () => {
    const page = renderIndexPage([waitlist]);
    expect(page).toMatch(/^---\ntitle: Changelog\n/);
    expect(page).toContain("0.x");
    expect(page).toContain('href="/docs/changelog/waitlist"');
    expect(page).toContain('description="@checodo/better-auth-waitlist 0.3.0"');
  });

  it("orders the sidebar: overview first, then the plugins", () => {
    expect(JSON.parse(renderMeta([waitlist]))).toEqual({
      title: "Changelog",
      pages: ["index", "waitlist"],
    });
  });

  it("replaces the folder, so a removed package's page goes too", () => {
    const dir = mkdtempSync(join(tmpdir(), "changelog-"));
    try {
      writeFileSync(join(dir, "old.mdx"), "stale");
      writeChangelog(dir, [waitlist]);
      expect(readdirSync(dir).sort()).toEqual(["index.mdx", "meta.json", "waitlist.mdx"]);
      expect(readFileSync(join(dir, "waitlist.mdx"), "utf8")).toBe(renderPackagePage(waitlist));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads every published package of the repository", () => {
    const docs = join(import.meta.dirname, "..");
    const packages = readPackages(join(docs, "../.."), join(docs, "content/docs"));
    // A new package needs a docs page first (readPackages throws otherwise).
    expect(packages.map((p) => p.dir)).toEqual(
      expect.arrayContaining(["audit-log", "authentication", "blocklist", "referral", "waitlist"]),
    );
  });
});
