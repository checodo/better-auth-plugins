import type { AuthContext } from "@better-auth/core";
import { findAll } from "@repo/plugin-utils/pagination";
import type { BlocklistMatchType, BlocklistTarget, StoredBlocklistRule } from "./types";

/** The adapter methods used here; satisfied by the base adapter and a transaction adapter. */
type Adapter = Pick<AuthContext["adapter"], "findMany" | "findOne" | "create" | "delete">;

const MODEL = "blocklistRule";

export async function listStoredRules(
  adapter: Adapter,
  target?: BlocklistTarget,
): Promise<StoredBlocklistRule[]> {
  // Every rule: a plain findMany returns at most 100 rows.
  const rules = await findAll<StoredBlocklistRule>(adapter, {
    model: MODEL,
    ...(target ? { where: [{ field: "target", value: target }] } : {}),
  });
  return rules.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function findStoredRule(
  adapter: Adapter,
  input: { target: BlocklistTarget; type: BlocklistMatchType; value: string },
): Promise<StoredBlocklistRule | null> {
  return adapter.findOne<StoredBlocklistRule>({
    model: MODEL,
    where: [
      { field: "target", value: input.target },
      { field: "type", value: input.type },
      { field: "value", value: input.value },
    ],
  });
}

export async function findStoredRuleById(
  adapter: Adapter,
  id: string,
): Promise<StoredBlocklistRule | null> {
  return adapter.findOne<StoredBlocklistRule>({
    model: MODEL,
    where: [{ field: "id", value: id }],
  });
}

export async function createStoredRule(
  adapter: Adapter,
  input: {
    target: BlocklistTarget;
    type: BlocklistMatchType;
    value: string;
    reason?: string | undefined;
  },
): Promise<StoredBlocklistRule> {
  return adapter.create<Omit<StoredBlocklistRule, "id">, StoredBlocklistRule>({
    model: MODEL,
    data: {
      target: input.target,
      type: input.type,
      value: input.value,
      reason: input.reason ?? null,
      createdAt: new Date(),
    },
  });
}

export async function deleteStoredRule(adapter: Adapter, id: string): Promise<void> {
  await adapter.delete({
    model: MODEL,
    where: [{ field: "id", value: id }],
  });
}
