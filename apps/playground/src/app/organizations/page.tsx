"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { RequireSession } from "@/components/require-session";
import type { Result } from "@/components/ui";
import { Button, Card, Code, Input, ResultMessage, toResult } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

function formValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
  return { values, reset: () => form.reset() };
}

export default function Organizations() {
  const { data: organizations, refetch } = authClient.useListOrganizations();
  const [result, setResult] = useState<Result | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    const { values, reset } = formValues(event);
    const name = values.name ?? "";
    const slug = values.slug ?? "";
    const response = await authClient.organization.create({ name, slug });
    setResult(toResult(response, `Created ${name}`));
    if (!response.error) {
      reset();
      refetch();
    }
  }

  return (
    <RequireSession>
      <h1 className="text-2xl font-semibold">Organizations</h1>
      <Card
        title="Create an organization"
        description={
          <>
            Name and slug are both checked. Try <Code>Billing</Code>, the slug <Code>settings</Code>
            , or <Code>Bіlling</Code> with a Cyrillic &quot;і&quot;.
          </>
        }
      >
        <form onSubmit={create} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Name" name="name" required />
            <Input label="Slug" name="slug" required pattern="[a-z0-9-]+" />
          </div>
          <Button>Create</Button>
          <ResultMessage result={result} />
        </form>
      </Card>
      {organizations?.map((org) => (
        <OrganizationCard
          key={org.id}
          id={org.id}
          name={org.name}
          slug={org.slug}
          onChange={refetch}
        />
      ))}
    </RequireSession>
  );
}

function OrganizationCard({
  id,
  name,
  slug,
  onChange,
}: {
  id: string;
  name: string;
  slug: string;
  onChange: () => void;
}) {
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [renameResult, setRenameResult] = useState<Result | null>(null);
  const [teamResult, setTeamResult] = useState<Result | null>(null);

  const loadTeams = useCallback(async () => {
    const response = await authClient.organization.listTeams({ query: { organizationId: id } });
    setTeams(response.data ?? []);
  }, [id]);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  async function rename(event: FormEvent<HTMLFormElement>) {
    const { values } = formValues(event);
    const response = await authClient.organization.update({
      organizationId: id,
      data: { name: values.name ?? "" },
    });
    setRenameResult(toResult(response, `Renamed to ${values.name}`));
    if (!response.error) onChange();
  }

  async function addTeam(event: FormEvent<HTMLFormElement>) {
    const { values, reset } = formValues(event);
    const response = await authClient.organization.createTeam({
      name: values.name ?? "",
      organizationId: id,
    });
    setTeamResult(toResult(response, `Added team ${values.name}`));
    if (!response.error) {
      reset();
      void loadTeams();
    }
  }

  return (
    <Card title={name} description={<Code>{slug}</Code>}>
      <form onSubmit={rename} className="flex items-end gap-2">
        <div className="flex-1">
          <Input label="Rename (checked on /organization/update)" name="name" required />
        </div>
        <Button variant="secondary">Rename</Button>
      </form>
      <ResultMessage result={renameResult} />
      <form onSubmit={addTeam} className="flex items-end gap-2">
        <div className="flex-1">
          <Input label='Add a team (try anything containing "staff")' name="name" required />
        </div>
        <Button variant="secondary">Add team</Button>
      </form>
      <ResultMessage result={teamResult} />
      {teams.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Teams: {teams.map((t) => t.name).join(", ")}
        </p>
      ) : null}
    </Card>
  );
}
