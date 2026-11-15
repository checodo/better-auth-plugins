"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { RequireSession } from "@/components/require-session";
import type { Result } from "@/components/ui";
import { Button, Card, Code, Input, ResultMessage, toResult } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

function value(event: FormEvent<HTMLFormElement>, name: string) {
  event.preventDefault();
  return String(new FormData(event.currentTarget).get(name) ?? "");
}

export default function Account() {
  const { data: session } = authClient.useSession();
  const [usernameResult, setUsernameResult] = useState<Result | null>(null);
  const [emailResult, setEmailResult] = useState<Result | null>(null);

  async function changeUsername(event: FormEvent<HTMLFormElement>) {
    const username = value(event, "username");
    const response = await authClient.updateUser({ username });
    setUsernameResult(toResult(response, `Username changed to ${username}`));
  }

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    const newEmail = value(event, "email");
    const response = await authClient.changeEmail({ newEmail });
    setEmailResult(toResult(response, `Email changed to ${newEmail}`));
  }

  return (
    <RequireSession>
      <h1 className="text-2xl font-semibold">Account</h1>
      <Card
        title="Change username"
        description={
          <>
            Checked on <Code>/update-user</Code>. Current: {session?.user.username ?? "none"}.
          </>
        }
      >
        <form onSubmit={changeUsername} className="space-y-3">
          <Input label="New username" name="username" required />
          <Button>Change username</Button>
          <ResultMessage result={usernameResult} />
        </form>
      </Card>
      <Card
        title="Change email"
        description={
          <>
            Checked on <Code>/change-email</Code> before any email is sent. Try{" "}
            <Code>me@guerrillamail.com</Code>.
          </>
        }
      >
        <form onSubmit={changeEmail} className="space-y-3">
          <Input label="New email" name="email" type="email" required />
          <Button>Change email</Button>
          <ResultMessage result={emailResult} />
        </form>
      </Card>
    </RequireSession>
  );
}
