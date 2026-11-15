"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { RequireSession } from "@/components/require-session";
import type { Result } from "@/components/ui";
import { Button, Card, Code, Hint, Input, ResultMessage, Select, toResult } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { makeMeAdmin } from "./actions";

const TARGETS = ["email", "username", "organization", "team"] as const;
const TYPES = ["exact", "domain", "prefix", "suffix", "contains", "regex"] as const;

type Rule = {
  id: string;
  target: string;
  type: string;
  value: string;
  reason?: string | null;
};

export default function Admin() {
  const { data: session, refetch: refetchSession } = authClient.useSession();
  const [rules, setRules] = useState<Rule[]>([]);
  const [listResult, setListResult] = useState<Result | null>(null);
  const [createResult, setCreateResult] = useState<Result | null>(null);

  const isAdmin = session?.user.role?.split(",").includes("admin") ?? false;

  const load = useCallback(async () => {
    const response = await authClient.blocklist.listRules();
    if (response.error) {
      setListResult(toResult(response, ""));
      setRules([]);
    } else {
      setListResult(null);
      setRules(response.data.rules);
    }
  }, []);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const response = await authClient.blocklist.createRule({
      target: values.target as (typeof TARGETS)[number],
      type: values.type as (typeof TYPES)[number],
      value: values.value ?? "",
      ...(values.reason ? { reason: values.reason } : {}),
    });
    setCreateResult(toResult(response, `Rule added. It applies right away.`));
    if (!response.error) {
      form.reset();
      void load();
    }
  }

  async function remove(id: string) {
    const response = await authClient.blocklist.deleteRule({ id });
    setListResult(response.error ? toResult(response, "") : null);
    void load();
  }

  return (
    <RequireSession>
      <h1 className="text-2xl font-semibold">Blocklist rules</h1>
      <p className="text-sm text-muted-foreground">
        Rules stored in the database, on top of the static rules in <Code>src/lib/auth.ts</Code>.
        Managing them requires the <Code>admin</Code> role.
      </p>

      {!isAdmin ? (
        <Card
          title="You are not an admin"
          description="The endpoints answer 403 for everyone else. This button exists only in the playground."
        >
          <Button
            type="button"
            onClick={async () => {
              await makeMeAdmin();
              await refetchSession();
            }}
          >
            Make me admin
          </Button>
        </Card>
      ) : null}

      <Card title="Add a rule">
        <form onSubmit={create} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Target" name="target" options={TARGETS} />
            <Select label="Type" name="type" options={TYPES} />
            <Input label="Value" name="value" required placeholder="e.g. example.org" />
            <Input label="Reason (optional)" name="reason" />
          </div>
          <Button>Add rule</Button>
          <ResultMessage result={createResult} />
          <Hint>
            <Code>domain</Code> rules only work for emails, and unsafe regular expressions such as{" "}
            <Code>(a+)+</Code> are rejected.
          </Hint>
        </form>
      </Card>

      <Card title={`Stored rules (${rules.length})`}>
        <ResultMessage result={listResult} />
        {rules.length === 0 && !listResult ? (
          <p className="text-sm text-muted-foreground">No rules yet.</p>
        ) : null}
        <ul className="divide-y divide-border">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-24 text-muted-foreground">{rule.target}</span>
              <span className="w-20 text-muted-foreground">{rule.type}</span>
              <Code>{rule.value}</Code>
              <span className="truncate text-muted-foreground">{rule.reason}</span>
              <Button
                variant="secondary"
                type="button"
                className="ml-auto"
                onClick={() => remove(rule.id)}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </RequireSession>
  );
}
