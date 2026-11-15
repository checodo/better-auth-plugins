import { getTestInstance } from "better-auth/test";
import { describe, expect, expectTypeOf, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import type { BlocklistPlugin } from "../src/index";
import { blocklist } from "../src/index";

describe("plugin shape", () => {
  it("is registered for getPlugin, with its version and options", async () => {
    const options = { username: { values: ["admin"] } };
    const { auth } = await getTestInstance(
      { plugins: [blocklist(options)] },
      { disableTestUser: true },
    );
    const plugin = (await auth.$context).getPlugin("blocklist");

    expectTypeOf(plugin).toEqualTypeOf<BlocklistPlugin | null>();
    expect(plugin?.id).toBe("blocklist");
    expect(plugin?.version).toBe(packageJson.version);
    expect(plugin?.options).toBe(options);
  });

  it("enforces one rule per target, type, and value in the database", async () => {
    const { auth } = await getTestInstance({ plugins: [blocklist()] }, { disableTestUser: true });
    const { adapter } = await auth.$context;
    const rule = { target: "email", type: "domain", value: "spam.example", createdAt: new Date() };

    await adapter.create({ model: "blocklistRule", data: rule });
    await expect(adapter.create({ model: "blocklistRule", data: rule })).rejects.toThrow();
    await expect(
      adapter.create({ model: "blocklistRule", data: { ...rule, type: "exact" } }),
    ).resolves.toBeTruthy();
  });
});

describe("schema option", () => {
  it("renames the table and columns, and rules still work", async () => {
    const { auth } = await getTestInstance(
      {
        plugins: [
          blocklist({
            schema: {
              blocklistRule: { modelName: "blocklist_rules", fields: { createdAt: "created_at" } },
            },
          }),
        ],
      },
      { disableTestUser: true },
    );
    const ctx = await auth.$context;
    await ctx.adapter.create({
      model: "blocklistRule",
      data: { target: "email", type: "domain", value: "spam.example", createdAt: new Date() },
    });

    const db = (ctx.options as { database?: unknown })
      .database as import("node:sqlite").DatabaseSync;
    const columns = db.prepare("select name from pragma_table_info('blocklist_rules')").all();
    expect(columns.map((c) => c.name)).toContain("created_at");

    await expect(
      auth.api.signUpEmail({
        body: { email: "a@spam.example", password: "password1234", name: "A" },
      }),
    ).rejects.toMatchObject({ body: { code: "EMAIL_NOT_ALLOWED" } });
  });

  it("does not leak renames into other plugin instances", () => {
    const renamed = blocklist({ schema: { blocklistRule: { modelName: "renamed" } } });
    const plain = blocklist();
    const modelName = (table: object) => (table as { modelName?: string }).modelName;
    expect(modelName(renamed.schema.blocklistRule)).toBe("renamed");
    expect(modelName(plain.schema.blocklistRule)).toBeUndefined();
  });
});
