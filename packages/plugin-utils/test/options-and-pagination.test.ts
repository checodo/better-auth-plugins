import { describe, expect, it } from "vitest";
import * as z from "zod";
import { createFail } from "../src/options";
import { paginationQuery } from "../src/pagination";

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
