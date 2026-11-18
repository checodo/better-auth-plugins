import type { AuditEvent } from "../types";

/**
 * Where the next export page starts: events created before `before`
 * (exclusive), after skipping `skip` of them. Events with the same
 * `createdAt` as the last exported one may be split across pages, so the
 * next page starts at that time again and skips the ones already sent.
 * New events are newer than `before`, so they never shift a page.
 */
export interface ExportCursor {
  before: number;
  skip: number;
}

export function encodeCursor(cursor: ExportCursor): string {
  return btoa(JSON.stringify([cursor.before, cursor.skip]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** `null` for anything that isn't a cursor this plugin made. */
export function decodeCursor(value: string): ExportCursor | null {
  try {
    const json = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed: unknown = JSON.parse(json);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      Number.isSafeInteger(parsed[0]) &&
      Number.isSafeInteger(parsed[1]) &&
      parsed[0] >= 0 &&
      parsed[1] >= 0
    ) {
      return { before: parsed[0], skip: parsed[1] };
    }
  } catch {
    // Not base64 or not JSON.
  }
  return null;
}

/** The cursor after a full page, newest first. */
export function nextCursor(page: AuditEvent[], previous: ExportCursor | null): ExportCursor {
  const last = page.at(-1) as AuditEvent;
  const before = new Date(last.createdAt).getTime();
  let skip = 0;
  for (let index = page.length - 1; index >= 0; index--) {
    if (new Date((page[index] as AuditEvent).createdAt).getTime() !== before) break;
    skip++;
  }
  // The whole page had one timestamp, the same as the previous page's
  // last event: those were skipped too.
  if (skip === page.length && previous && previous.before === before + 1) skip += previous.skip;
  return { before: before + 1, skip };
}

export const CSV_COLUMNS = [
  "id",
  "createdAt",
  "type",
  "status",
  "severity",
  "userId",
  "actorUserId",
  "sessionId",
  "organizationId",
  "ipAddress",
  "userAgent",
  "errorCode",
  "metadata",
] as const satisfies readonly (keyof AuditEvent)[];

/**
 * One CSV cell. Text a spreadsheet would run as a formula (starting with
 * `=`, `+`, `-`, `@`, a tab, or a carriage return) gets a leading `'`
 * (OWASP "CSV injection").
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(events: AuditEvent[], header: boolean): string {
  const rows = events.map((event) =>
    CSV_COLUMNS.map((column) =>
      csvCell(column === "createdAt" ? new Date(event.createdAt) : event[column]),
    ).join(","),
  );
  if (header) rows.unshift(CSV_COLUMNS.join(","));
  return rows.length > 0 ? `${rows.join("\r\n")}\r\n` : "";
}

export function toNdjson(events: AuditEvent[]): string {
  return events.map((event) => `${JSON.stringify(event)}\n`).join("");
}
