import { asMarkdown, md } from "fumadocs-core/server";
import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";

/**
 * The Markdown form of the MDX components used in the docs, for the LLM
 * routes (`/llms.txt`, `/llms-full.txt`, `/docs/<page>.md`). Each calls
 * `asMarkdown()` to opt in; anything not listed here is written as JSX.
 */

const CALLOUT_LABELS: Record<string, string> = {
  info: "Note",
  warn: "Warning",
  warning: "Warning",
  error: "Danger",
  success: "Tip",
  idea: "Tip",
};

async function Callout({
  type,
  title,
  children,
}: {
  type?: string;
  title?: ReactNode;
  children?: ReactNode;
}) {
  asMarkdown();
  const label = CALLOUT_LABELS[type ?? "info"] ?? "Note";
  const body = (await md`${children}`).trim();
  return title
    ? md.linePrefix("> ")`**${label}: ${title}**

${body}`
    : md.linePrefix("> ")`**${label}:** ${body}`;
}

interface TypeTableEntry {
  type?: ReactNode;
  description?: ReactNode;
  default?: ReactNode;
  required?: boolean;
  deprecated?: boolean;
}

/** One table cell: a single line, with pipes escaped. */
async function cell(value: ReactNode): Promise<string> {
  const text = typeof value === "string" ? value : await md`${value}`;
  return text
    .trim()
    .replace(/\s*\n\s*/g, " ")
    .replace(/\|/g, "\\|");
}

/** Wraps a type in backticks, with a longer fence when it contains backticks itself. */
function code(text: string): string {
  if (text === "") return "";
  const fence = text.includes("`") ? "``" : "`";
  return `${fence}${fence.length > 1 ? " " : ""}${text}${fence.length > 1 ? " " : ""}${fence}`;
}

async function TypeTable({ type }: { type: Record<string, TypeTableEntry> }) {
  asMarkdown();
  const rows = await Promise.all(
    Object.entries(type).map(async ([name, entry]) => {
      const flags = [entry.required ? "required" : "", entry.deprecated ? "deprecated" : ""]
        .filter(Boolean)
        .join(", ");
      return [
        `${code(name)}${flags ? ` (${flags})` : ""}`,
        code(await cell(entry.type)),
        entry.default === undefined ? "" : code(await cell(entry.default)),
        await cell(entry.description),
      ];
    }),
  );
  const lines = [
    "| Name | Type | Default | Description |",
    "| --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
  return `\n${lines.join("\n")}\n\n`;
}

function Tabs({ children }: { children?: ReactNode }) {
  asMarkdown();
  return md`${children}`;
}

function Tab({ value, title, children }: { value?: string; title?: string; children?: ReactNode }) {
  asMarkdown();
  const label = title ?? value;
  return label ? md`**${label}:**\n\n${children}\n\n` : md`${children}\n\n`;
}

function Steps({ children }: { children?: ReactNode }) {
  asMarkdown();
  return md`${children}`;
}

function Step({ children }: { children?: ReactNode }) {
  asMarkdown();
  return md`${children}\n\n`;
}

function Cards({ children }: { children?: ReactNode }) {
  asMarkdown();
  return md`${children}\n\n`;
}

function Card({
  title,
  href,
  description,
  children,
}: {
  title?: ReactNode;
  href?: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  asMarkdown();
  const name = href ? md`[${title}](${href})` : md`**${title}**`;
  const text = description ?? children;
  return text ? md`- ${name}: ${text}\n` : md`- ${name}\n`;
}

/** Visual-only components of the brand page: no Markdown form. */
function Visual() {
  asMarkdown();
  return null;
}

export function getMarkdownComponents(): MDXComponents {
  return {
    Callout,
    TypeTable,
    Tabs,
    Tab,
    Steps,
    Step,
    Cards,
    Card,
    ColorSwatches: Visual,
    FullLogoPreview: Visual,
    LockupPreview: Visual,
    LogoPreview: Visual,
  } as unknown as MDXComponents;
}
