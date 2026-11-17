"use client";

import { useSearchParams } from "next/navigation";
import type { FormEvent } from "react";
import { Suspense, useState } from "react";
import type { Result } from "@/components/ui";
import { Button, Card, Input, ResultMessage, toResult } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

/** Where better-auth's reset link leads (here: from a secured account). */
function ResetPassword() {
  const params = useSearchParams();
  const token = params.get("token");
  const [result, setResult] = useState<Result | null>(null);

  if (!token || params.get("error")) {
    return (
      <Card title="Reset password" description="This link is invalid or has expired.">
        {null}
      </Card>
    );
  }

  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newPassword = String(new FormData(event.currentTarget).get("password") ?? "");
    const response = await authClient.resetPassword({ newPassword, token: token ?? "" });
    setResult(toResult(response, "Password set. Sign in with it."));
  }

  return (
    <Card title="Reset password" description="Choose a new password.">
      <form onSubmit={reset} className="space-y-3">
        <Input label="New password" name="password" type="password" minLength={8} required />
        <Button>Set password</Button>
        <ResultMessage result={result} />
      </form>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      {/* The token is in the URL: keep it out of Referer headers. */}
      <meta name="referrer" content="no-referrer" />
      <ResetPassword />
    </Suspense>
  );
}
