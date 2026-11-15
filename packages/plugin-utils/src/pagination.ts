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
