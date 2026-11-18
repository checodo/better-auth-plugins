import { describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { createFail } from "../src/options";
import { findAll, paginationQuery } from "../src/pagination";

describe("createFail", () => {
  it("throws with the plugin id as prefix", () => {
    const fail = createFail("referral");
    expect(() => fail('"codeLength" is wrong.')).toThrow('[referral] "codeLength" is wrong.');
  });
});

describe("paginationQuery", () => {
  const schema = z.object(paginationQuery({ defaultLimit: 20, maxLimit: 100 }));

  it("defaults limit and offset", () => {
    expect(schema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it("coerces query strings", () => {
    expect(schema.parse({ limit: "50", offset: "10" })).toEqual({ limit: 50, offset: 10 });
  });

  it("rejects out-of-range and fractional values", () => {
    for (const query of [{ limit: "0" }, { limit: "101" }, { offset: "-1" }, { limit: "1.5" }]) {
      expect(schema.safeParse(query).success).toBe(false);
    }
  });
});

describe("findAll", () => {
  /** A fake adapter over `rows` that applies `id > x`, `limit`, and `offset`. */
  const fake = (rows: { id: string }[], afterEachCall?: () => void) =>
    vi.fn(
      async (query: {
        where: { field: string; value: string; operator?: string }[];
        limit: number;
        offset?: number;
      }) => {
        // Runs once this call has read its rows, like a write between two queries.
        queueMicrotask(() => afterEachCall?.());
        const after = query.where.find((w) => w.field === "id" && w.operator === "gt")?.value;
        const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
        const from = after === undefined ? sorted : sorted.filter((row) => row.id > after);
        return from.slice(query.offset ?? 0, (query.offset ?? 0) + query.limit);
      },
    );

  it("reads page by page after the last id, until a page isn't full", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` }));
    const findMany = fake(rows);
    expect(await findAll({ findMany } as never, { model: "x" }, 2)).toEqual(rows);
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      model: "x",
      limit: 2,
      where: [{ field: "id", value: "r1", operator: "gt" }],
    });
  });

  it("keeps the caller's filters and adds the id after them", async () => {
    const findMany = fake([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const target = { field: "target", value: "email" };
    await findAll({ findMany } as never, { model: "x", where: [target] }, 2);
    expect(findMany.mock.calls[1]?.[0].where).toEqual([
      target,
      { field: "id", value: "b", operator: "gt" },
    ]);
  });

  it("skips no row when one is deleted while it reads", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}` }));
    let deleted = false;
    // After the first page, a row of that page is deleted. Paging by
    // offset would then skip r2.
    const findMany = fake(rows, () => {
      if (!deleted) rows.splice(0, 1);
      deleted = true;
    });
    const ids = (await findAll({ findMany } as never, { model: "x" }, 2)).map((row) => row.id);
    expect(ids).toEqual(["r0", "r1", "r2", "r3", "r4", "r5"]);
  });

  it("pages by offset with another sortBy", async () => {
    const findMany = fake([{ id: "a" }, { id: "b" }, { id: "c" }]);
    await findAll(
      { findMany } as never,
      { model: "x", sortBy: { field: "createdAt", direction: "asc" } },
      2,
    );
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({ offset: 2, where: [] });
  });
});
