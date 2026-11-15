/**
 * Regenerates the predefined lists in `src/lists/` and the package's
 * `THIRD_PARTY_NOTICES.md` from their upstream sources, each pinned to the
 * latest commit of its branch.
 *
 * Run with `pnpm --filter @checodo/better-auth-blocklist lists:update`,
 * review the diff, and add a changeset (patch) for the refreshed data.
 * Needs `git` and network access, no GitHub token: commits are pinned
 * with `git ls-remote` and files are read from raw.githubusercontent.com.
 *
 * Only sources with a license that allows redistribution (CC0, MIT,
 * BSD) are used. Lists without a license, or with attribution terms we
 * can't meet in a data file, are left out on purpose.
 *
 * Email domains are checked in DNS (see `mail-dns.ts`): only domains that
 * verifiably can receive mail are kept, which removes more than half of
 * the merged list. Lookups that fail get a second, slower pass; domains
 * that still can't be confirmed are dropped too.
 * That takes a few minutes. `--skip-dns` keeps every domain, for trying out
 * changes to the script only; don't commit its output.
 *
 * Entries that are public suffixes (`net.ua`, `msk.ru`, `it.com`, ...) are
 * dropped, checked against the Public Suffix List: domain rules also match
 * subdomains, so a suffix would block every domain registered under it.
 * The PSL (MPL-2.0) is only used as a filter; none of it is shipped.
 *
 * A list whose merged sources or final entry count drop by more than
 * `MAX_SHRINK` aborts the run, unless `--allow-shrink` is passed after
 * reviewing why.
 */
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { checkMailDomains } from "./mail-dns.ts";
import { NEVER_BLOCK } from "./never-block.ts";
import { DOMAIN, lines, mailServiceHosts, mergeEntries, parsePublicSuffixList } from "./sources.ts";

const SKIP_DNS = process.argv.includes("--skip-dns");
const ALLOW_SHRINK = process.argv.includes("--allow-shrink");

interface Repo {
  repo: string;
  branch: string;
  /** SPDX id. The license file at the pinned commit must contain `LICENSE_MARKERS[license]`. */
  license: keyof typeof LICENSE_MARKERS;
}

/** Text that identifies each accepted license in a license file. */
const LICENSE_MARKERS = {
  "CC0-1.0": "CC0 1.0 Universal",
  MIT: "Permission is hereby granted, free of charge",
  "BSD-3-Clause": "Neither the name of",
  "MPL-2.0": "Mozilla Public License Version 2.0",
} as const;

const LICENSE_FILES = ["LICENSE", "LICENSE.txt", "LICENSE.md", "license", "license.txt", "LICENCE"];

interface Source extends Repo {
  path: string;
  parse: (text: string) => string[];
}

interface List {
  file: string;
  exportName: string;
  description: string;
  sources: Source[];
  /** Sources of entries to remove after merging (known legitimate domains). */
  excludeSources?: Source[];
  /** Entries never included, whatever the sources say. */
  exclude?: readonly string[];
  valid: RegExp;
  /** Drop entries (domains) that can't receive email, checked in DNS. */
  requireMailServer?: boolean;
  /** Drop entries that are public suffixes (see `PUBLIC_SUFFIX_LIST`). */
  excludePublicSuffixes?: boolean;
}

const LISTS: List[] = [
  {
    file: "disposable-email-domains",
    exportName: "disposableEmailDomains",
    description: "Domains of disposable (temporary) email providers, merged from several sources.",
    sources: [
      {
        repo: "disposable-email-domains/disposable-email-domains",
        branch: "main",
        path: "disposable_email_blocklist.conf",
        license: "CC0-1.0",
        parse: lines,
      },
      {
        repo: "wesbos/burner-email-providers",
        branch: "master",
        path: "emails.txt",
        license: "MIT",
        parse: lines,
      },
      {
        repo: "FGRibreau/mailchecker",
        branch: "master",
        path: "list.txt",
        license: "MIT",
        parse: lines,
      },
      {
        repo: "7c/fakefilter",
        branch: "main",
        path: "txt/data.txt",
        license: "BSD-3-Clause",
        parse: lines,
      },
      {
        repo: "unkn0w/disposable-email-domain-list",
        branch: "main",
        path: "domains.txt",
        license: "MIT",
        parse: lines,
      },
      {
        repo: "castle/disposable-email-domains",
        branch: "master",
        path: "disposable-email-domains.txt",
        license: "MIT",
        parse: lines,
      },
      {
        repo: "daisy1754/jp-disposable-emails",
        branch: "master",
        path: "list.txt",
        license: "MIT",
        parse: lines,
      },
    ],
    excludeSources: [
      {
        repo: "disposable/disposable",
        branch: "master",
        path: "whitelist.txt",
        license: "MIT",
        parse: lines,
      },
      {
        repo: "disposable/disposable",
        branch: "master",
        path: "mailservices.json",
        license: "MIT",
        parse: mailServiceHosts,
      },
    ],
    exclude: NEVER_BLOCK,
    valid: DOMAIN,
    requireMailServer: true,
    excludePublicSuffixes: true,
  },
  {
    file: "reserved-usernames",
    exportName: "reservedUsernames",
    description:
      "Usernames that are commonly reserved: system, route, and role names such as `admin`, `api`, or `support`.",
    sources: [
      {
        repo: "jmitchel3/The-Big-Username-Blacklist",
        branch: "master",
        path: "list.txt",
        license: "MIT",
        parse: lines,
      },
    ],
    valid: /^[a-z0-9._-]{1,64}$/,
  },
];

/**
 * The Public Suffix List, ICANN and private sections: rules such as `*.ck`
 * and `!www.ck` become `ck` and `www.ck`, internationalized names become
 * punycode. Only used to filter, never shipped.
 */
const PUBLIC_SUFFIX_LIST: Source = {
  repo: "publicsuffix/list",
  branch: "main",
  path: "public_suffix_list.dat",
  license: "MPL-2.0",
  parse: parsePublicSuffixList,
};

/**
 * Refuse updates whose merged sources shrink by more than this share
 * (before the DNS check), which usually means a broken source.
 */
const MAX_SHRINK = 0.2;

/** Abort if more DNS lookups than this share fail: the resolver, not the data, is broken. */
const MAX_UNKNOWN = 0.05;

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": "better-auth-plugins-lists" } });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.text();
}

const raw = (repo: string, sha: string, path: string) =>
  `https://raw.githubusercontent.com/${repo}/${sha}/${path}`;

interface Pinned {
  sha: string;
  /** Text of the repository's license file at that commit. */
  licenseText: string;
}

const commits = new Map<string, Promise<Pinned>>();

/**
 * The latest commit of a repository's branch, and its license file at that
 * commit, which must still be the expected license. Fetched once per run.
 */
function pin(repo: Repo): Promise<Pinned> {
  const key = `${repo.repo}#${repo.branch}`;
  let commit = commits.get(key);
  if (!commit) {
    commit = (async () => {
      const { stdout } = await promisify(execFile)("git", [
        "ls-remote",
        `https://github.com/${repo.repo}.git`,
        `refs/heads/${repo.branch}`,
      ]);
      const sha = stdout.split(/\s/)[0];
      if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
        throw new Error(`${repo.repo}: branch ${repo.branch} not found`);
      }

      for (const path of LICENSE_FILES) {
        const response = await fetch(raw(repo.repo, sha, path));
        if (!response.ok) continue;
        const licenseText = await response.text();
        if (!licenseText.includes(LICENSE_MARKERS[repo.license])) {
          throw new Error(`${repo.repo}: ${path} is no longer ${repo.license}`);
        }
        return { sha, licenseText };
      }
      throw new Error(`${repo.repo}: no license file found`);
    })();
    commits.set(key, commit);
  }
  return commit;
}

async function load(source: Source): Promise<string[]> {
  const { sha } = await pin(source);
  const text = await fetchText(raw(source.repo, sha, source.path));
  return source.parse(text).map((entry) => entry.trim().toLowerCase());
}

const sourceUrl = async (source: Source) =>
  `https://github.com/${source.repo}/blob/${(await pin(source)).sha}/${source.path}`;

/** The number of entries in the current file, or 0 if there is none. */
async function previousEntryCount(file: URL): Promise<number> {
  try {
    return (await readFile(file, "utf8")).split("\n").filter((l) => l.startsWith('  "')).length;
  } catch {
    return 0;
  }
}

/** The merged count recorded in the file's header, or its entry count for older files. */
async function previousMergedCount(file: URL): Promise<number> {
  try {
    const text = await readFile(file, "utf8");
    const merged = text.match(/^\/\/ Merged entries: (\d+)/m)?.[1];
    return merged ? Number(merged) : text.split("\n").filter((l) => l.startsWith('  "')).length;
  } catch {
    return 0;
  }
}

/** Keeps only domains that verifiably receive email. Returns them and a summary. */
async function dropDomainsWithoutMail(
  domains: string[],
): Promise<{ kept: string[]; summary: string }> {
  const started = Date.now();
  console.log(`  checking ${domains.length} domains in DNS...`);
  const status = await checkMailDomains(domains, {
    onProgress: (done) => console.log(`  ${done} / ${domains.length}`),
  });
  const failed = domains.filter((domain) => status.get(domain) === "unknown");
  if (failed.length > domains.length * MAX_UNKNOWN) {
    throw new Error(
      `${failed.length} of ${domains.length} DNS lookups failed. Check your network or resolver and run again.`,
    );
  }

  // Second pass for failed lookups: fewer at a time, longer timeouts.
  if (failed.length > 0) {
    console.log(`  retrying ${failed.length} failed lookups more slowly...`);
    const retried = await checkMailDomains(failed, { concurrency: 10, timeout: 15_000 });
    for (const [domain, value] of retried) status.set(domain, value);
  }

  const counts = { mail: 0, dead: 0, unknown: 0 };
  for (const value of status.values()) counts[value]++;
  const kept = domains.filter((domain) => status.get(domain) === "mail");
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  return {
    kept,
    summary: `${counts.dead} without a mail server and ${counts.unknown} unverifiable removed (${minutes} min)`,
  };
}

async function update(list: List): Promise<void> {
  const loaded = await Promise.all(list.sources.map(load));
  const excluded = new Set([
    ...(await Promise.all((list.excludeSources ?? []).map(load))).flat(),
    ...(list.exclude ?? []),
  ]);
  const publicSuffixes = new Set(list.excludePublicSuffixes ? await load(PUBLIC_SUFFIX_LIST) : []);

  const {
    entries: sorted,
    invalid,
    removed,
    suffixesRemoved,
  } = mergeEntries(loaded, { valid: list.valid, excluded, publicSuffixes });
  if (suffixesRemoved.length > 0) {
    console.log(`  public suffixes removed: ${suffixesRemoved.join(", ")}`);
  }

  const file = new URL(`../src/lists/${list.file}.ts`, import.meta.url);
  const before = await previousMergedCount(file);
  if (!ALLOW_SHRINK && before > 0 && sorted.length < before * (1 - MAX_SHRINK)) {
    throw new Error(
      `${list.file}: ${sorted.length} merged entries, down from ${before}. Check the sources, then run again with --allow-shrink if the drop is expected.`,
    );
  }

  let entries = sorted;
  let dnsSummary: string | undefined;
  if (list.requireMailServer && !SKIP_DNS) {
    const result = await dropDomainsWithoutMail(sorted);
    entries = result.kept;
    dnsSummary = result.summary;
  } else if (list.requireMailServer) {
    dnsSummary = "DNS check skipped (--skip-dns): do not commit this file";
  }

  const previous = await previousEntryCount(file);
  if (!ALLOW_SHRINK && previous > 0 && entries.length < previous * (1 - MAX_SHRINK)) {
    throw new Error(
      `${list.file}: ${entries.length} entries, down from ${previous}. A DNS server that filters disposable domains can cause this; check, then run again with --allow-shrink if the drop is expected.`,
    );
  }

  const header = [
    "// Generated by scripts/update-lists.ts. Do not edit by hand.",
    "// Merged, de-duplicated, and sorted from (see THIRD_PARTY_NOTICES.md):",
    ...(await Promise.all(
      list.sources.map(async (s, i) => `//   ${await sourceUrl(s)} (${loaded[i]?.length ?? 0})`),
    )),
  ];
  if (list.excludeSources?.length || list.exclude?.length) {
    header.push("// Minus known legitimate domains from:");
    for (const s of list.excludeSources ?? []) header.push(`//   ${await sourceUrl(s)}`);
    if (list.exclude?.length) header.push("//   NEVER_BLOCK in scripts/never-block.ts");
  }
  if (list.excludePublicSuffixes) {
    header.push(
      `// Minus ${suffixesRemoved.length} public suffixes from ${await sourceUrl(PUBLIC_SUFFIX_LIST)}`,
    );
  }
  header.push(`// Merged entries: ${sorted.length}`);
  if (dnsSummary)
    header.push(`// DNS check (${new Date().toISOString().slice(0, 10)}): ${dnsSummary}`);

  const content = [
    ...header,
    "",
    `/** ${list.description} ${entries.length} entries. */`,
    `export const ${list.exportName}: readonly string[] = Object.freeze([`,
    ...entries.map((entry) => `  ${JSON.stringify(entry)},`),
    "]);",
    "",
  ].join("\n");

  await writeFile(file, content);
  console.log(
    `${list.file}: ${entries.length} entries (${sorted.length} merged, was ${before}; ${invalid} invalid, ${removed} legitimate removed${dnsSummary ? `; ${dnsSummary}` : ""})`,
  );
}

async function writeNotices(): Promise<void> {
  // Sources whose data ships (`usedFor`), and sources only used to remove
  // entries (`filters`), whose data doesn't ship.
  const repos = new Map<string, { repo: Source; usedFor: Set<string>; filters: Set<string> }>();
  const add = (source: Source, list: List, role: "usedFor" | "filters") => {
    const entry = repos.get(source.repo) ?? {
      repo: source,
      usedFor: new Set<string>(),
      filters: new Set<string>(),
    };
    entry[role].add(list.exportName);
    repos.set(source.repo, entry);
  };
  for (const list of LISTS) {
    for (const source of list.sources) add(source, list, "usedFor");
    for (const source of list.excludeSources ?? []) add(source, list, "filters");
  }
  const names = (set: Set<string>) => [...set].map((name) => `\`${name}\``).join(", ");

  const sections = [
    "# Third-party notices",
    "",
    "`@checodo/better-auth-blocklist/lists` includes data from the projects",
    "below, or uses them to filter that data. Generated by",
    "`scripts/update-lists.ts`; do not edit by hand.",
  ];
  for (const { repo, usedFor, filters } of repos.values()) {
    const { sha, licenseText } = await pin(repo);
    const usage = [
      ...(usedFor.size > 0 ? [`Used for ${names(usedFor)}.`] : []),
      ...(filters.size > 0
        ? [`Used to remove legitimate entries from ${names(filters)}; none of its data ships.`]
        : []),
    ];
    sections.push(
      "",
      `## ${repo.repo}`,
      "",
      ...usage,
      `https://github.com/${repo.repo}/tree/${sha} (${repo.license})`,
      "",
      "```text",
      licenseText.trim(),
      "```",
    );
  }
  await writeFile(
    new URL("../THIRD_PARTY_NOTICES.md", import.meta.url),
    `${sections.join("\n")}\n`,
  );
}

for (const list of LISTS) {
  await update(list);
}
await writeNotices();
