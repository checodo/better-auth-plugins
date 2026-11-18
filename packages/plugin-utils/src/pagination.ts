import type { AuthContext } from "@better-auth/core";
import type { Where } from "@better-auth/core/db/adapter";
import * as z from "zod";

/**
 * The `limit` and `offset` fields of a list endpoint's query, coerced from
 * query strings. Spread into the endpoint's `z.object({ ... })`.
 */
export function paginationQuery({
  defaultLimit,
  maxLimit,
}: {
  defaultLimit: number;
  maxLimit: number;
}) {
  return {
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(maxLimit)
      .default(defaultLimit)
      .meta({
        description: `How many to return, at most ${maxLimit}. Defaults to ${defaultLimit}`,
      }),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .meta({ description: "How many to skip. Defaults to 0" }),
  };
}

/** Rows read per query in `findAll`. */
export const FIND_ALL_PAGE_SIZE = 1000;

/**
 * Every row matching `where`. better-auth's adapters return at most 100
 * rows from `findMany` without a `limit` (`defaultFindManyLimit`), which
 * silently cuts off longer results; this reads page by page until a page
 * isn't full.
 *
 * By default each page continues after the last id read (keyset paging),
 * so a row deleted or added meanwhile can't make another row be skipped or
 * read twice. Another `sortBy` pages by offset instead, where such a
 * change can skip or repeat a row at a page boundary: use it only where
 * that is harmless (display).
 */
export async function findAll<T extends { id: string }>(
  adapter: Pick<AuthContext["adapter"], "findMany">,
  query: {
    model: string;
    where?: Where[] | undefined;
    sortBy?: { field: string; direction: "asc" | "desc" } | undefined;
  },
  pageSize = FIND_ALL_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  const where = query.where ?? [];
  if (query.sortBy) {
    for (let offset = 0; ; offset += pageSize) {
      const page = await adapter.findMany<T>({
        model: query.model,
        where,
        limit: pageSize,
        offset,
        sortBy: query.sortBy,
      });
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }
  let after: string | null = null;
  for (;;) {
    const page: T[] = await adapter.findMany<T>({
      model: query.model,
      where: after === null ? where : [...where, { field: "id", value: after, operator: "gt" }],
      limit: pageSize,
      sortBy: { field: "id", direction: "asc" },
    });
    rows.push(...page);
    const last = page.at(-1);
    if (page.length < pageSize || !last) return rows;
    after = last.id;
  }
}
