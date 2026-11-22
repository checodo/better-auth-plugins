import type { AuthContext } from "@better-auth/core";
import { BASE_ERROR_CODES } from "@better-auth/core/error";
import { findUpTo } from "@repo/plugin-utils/pagination";
import type { ExportUserData } from "@repo/plugin-utils/user-data";
import { APIError, isAPIError } from "better-auth/api";
import { DATA_EXPORT_ERROR_CODES } from "./error-codes";
import type { DataExport, DataExportContributor, DataExportUser } from "./types";

type Row = Record<string, unknown>;

/** The options the collection uses, resolved. */
export interface CollectOptions {
  omit: Readonly<Record<string, readonly string[] | true>>;
  contributors: Readonly<Record<string, DataExportContributor>>;
  maxRows: number;
}

/**
 * Fields never exported, whatever the model: a password hash, a token, a
 * secret, a key, two-factor backup codes, device-flow codes. Exporting
 * them would make the export itself a credential.
 */
const SECRET_FIELDS = new Set([
  "password",
  "token",
  "secret",
  "key",
  "privateKey",
  "backupCodes",
  "deviceCode",
  "userCode",
]);
/** `accessToken`, `refreshToken`, `idToken`, `tokenHash`, `clientSecret`, ... */
const SECRET_SUFFIX = /(Token|Hash|Secret|Password)$/;

/** Whether a field is never exported. */
export function isSecretField(field: string): boolean {
  return SECRET_FIELDS.has(field) || SECRET_SUFFIX.test(field);
}

/** One-time tokens keyed by email: nothing a user needs, and secrets. */
const SKIPPED_MODELS = new Set(["verification"]);
/**
 * How many steps away from the user rows are followed: `user` ← `referral`
 * (a field that references the user) ← `referralStep` (one that
 * references a referral).
 */
const MAX_DEPTH = 3;
/** Ids per `in` query. */
const IN_CHUNK = 100;

const tooLarge = () =>
  APIError.from("UNPROCESSABLE_ENTITY", DATA_EXPORT_ERROR_CODES.EXPORT_TOO_LARGE);

/**
 * Runs one source of data (a plugin's `exportUserData`, a contributor).
 * An error fails the export with `EXPORT_FAILED`, never a silently
 * incomplete file; the log says which source failed.
 */
async function fromSource<T>(
  logger: AuthContext["logger"],
  source: string,
  read: () => Promise<T> | T,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isAPIError(error)) throw error;
    logger.error(`[data-export] ${source} failed`, error);
    throw APIError.from("INTERNAL_SERVER_ERROR", DATA_EXPORT_ERROR_CODES.EXPORT_FAILED);
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Everything stored about one user:
 *
 * 1. the user row;
 * 2. every row of every model with a field that references `user.id`
 *    (core, official plugins, and the app's own models in better-auth's
 *    schema), and rows that reference those, up to `MAX_DEPTH` steps;
 * 3. what plugins add through `exportUserData` (rows the schema can't
 *    lead to, such as audit events or a waitlist entry keyed by email);
 * 4. the app's `contributors`.
 *
 * Secret fields and `omit` are removed and listed in `omitted`.
 */
export async function collectUserData(
  context: Pick<AuthContext, "adapter" | "tables" | "options" | "logger">,
  userId: string,
  options: CollectOptions,
): Promise<{ document: DataExport; user: DataExportUser; rows: number }> {
  const { adapter, tables } = context;
  const userRow = await adapter.findOne<Row & { id: string }>({
    model: "user",
    where: [{ field: "id", value: userId }],
  });
  if (!userRow) throw APIError.from("NOT_FOUND", BASE_ERROR_CODES.USER_NOT_FOUND);

  const found = new Map<string, Map<string, Row>>();
  let total = 1;
  /** Adds rows (deduplicated by id); returns the ids of the new ones. */
  const add = (model: string, rows: Row[]): string[] => {
    const byId = found.get(model) ?? new Map<string, Row>();
    found.set(model, byId);
    const fresh: string[] = [];
    rows.forEach((row, index) => {
      const id = typeof row.id === "string" ? row.id : `#${byId.size}-${index}`;
      if (byId.has(id)) return;
      byId.set(id, row);
      fresh.push(id);
      total++;
    });
    if (total > options.maxRows) throw tooLarge();
    return fresh;
  };
  const excluded = (model: string) => SKIPPED_MODELS.has(model) || options.omit[model] === true;

  // A reference may name a model by key or by its (renamed) model name.
  const keyOf = new Map<string, string>();
  for (const [key, table] of Object.entries(tables)) {
    keyOf.set(key, key);
    keyOf.set(table.modelName, key);
  }

  // 2. Rows that reference the user, then rows that reference those.
  let frontier = new Map<string, string[]>([["user", [userRow.id]]]);
  for (let depth = 0; depth < MAX_DEPTH && frontier.size > 0; depth++) {
    const next = new Map<string, string[]>();
    for (const [model, table] of Object.entries(tables)) {
      if (model === "user" || excluded(model)) continue;
      for (const [field, attribute] of Object.entries(table.fields)) {
        const reference = attribute.references;
        if (reference?.field !== "id") continue;
        const ids = frontier.get(keyOf.get(reference.model) ?? reference.model);
        if (!ids?.length) continue;
        for (const chunk of chunks(ids, IN_CHUNK)) {
          const rows = await findUpTo<Row & { id: string }>(
            adapter,
            {
              model,
              where:
                chunk.length === 1
                  ? [{ field, value: chunk[0] as string }]
                  : [{ field, value: chunk, operator: "in" }],
            },
            options.maxRows - total,
          );
          if (!rows) throw tooLarge();
          const fresh = add(model, rows);
          if (fresh.length) next.set(model, [...(next.get(model) ?? []), ...fresh]);
        }
      }
    }
    frontier = next;
  }

  // 3. What plugins add.
  const email = typeof userRow.email === "string" ? userRow.email : null;
  for (const plugin of context.options.plugins ?? []) {
    const exportUserData = (plugin as { exportUserData?: unknown }).exportUserData;
    if (typeof exportUserData !== "function") continue;
    const result = await fromSource(context.logger, `the ${plugin.id} plugin's export`, () =>
      (exportUserData as ExportUserData)(
        { id: userRow.id, email },
        { adapter, maxRows: options.maxRows - total },
      ),
    );
    if (result === null) throw tooLarge();
    for (const [model, rows] of Object.entries(result)) {
      if (!excluded(model)) add(model, rows);
    }
  }

  // Secrets and `omit` out, listed in `omitted`.
  const omitted = new Map<string, Set<string>>();
  const note = (model: string, field: string) => {
    const fields = omitted.get(model) ?? new Set<string>();
    omitted.set(model, fields);
    fields.add(field);
  };
  const clean = (model: string, row: Row): Row => {
    const extra = options.omit[model];
    const out: Row = {};
    for (const [field, value] of Object.entries(row)) {
      if (isSecretField(field) || (Array.isArray(extra) && extra.includes(field))) {
        note(model, field);
        continue;
      }
      out[field] = value;
    }
    return out;
  };
  for (const model of Object.keys(tables)) if (excluded(model)) note(model, "*");

  const data: Record<string, Row[]> = {};
  for (const [model, byId] of found) {
    if (byId.size) data[model] = [...byId.values()].map((row) => clean(model, row));
  }

  // 4. The app's data.
  const user: DataExportUser = {
    id: userRow.id,
    email,
    name: typeof userRow.name === "string" ? userRow.name : null,
  };
  const app: Record<string, unknown> = {};
  for (const [name, contributor] of Object.entries(options.contributors)) {
    app[name] = await fromSource(context.logger, `contributor "${name}"`, () => contributor(user));
  }

  return {
    document: {
      exportedAt: new Date().toISOString(),
      user: clean("user", userRow),
      data,
      app,
      omitted: Object.fromEntries([...omitted].map(([model, fields]) => [model, [...fields]])),
    },
    user,
    rows: total,
  };
}
