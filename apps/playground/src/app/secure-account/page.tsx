"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { Result } from "@/components/ui";
import { Button, Card, ResultMessage, toResult } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

/** Where the "This wasn't me" link of a security alert leads. */
function SecureAccount() {
  const params = useSearchParams();
  const token = params.get("token");
  const [result, setResult] = useState<Result | null>(null);

  if (!token || params.get("error")) {
    return (
      <Card title="Secure your account" description="This link is invalid or has expired.">
        <p className="text-sm text-muted-foreground">Sign in and change your password.</p>
      </Card>
    );
  }

  async function secure() {
    const response = await authClient.securityAlerts.secureAccount({ token: token ?? "" });
    setResult(
      toResult(
        response,
        "Done: every session is signed out and the password is blocked. The reset link is in the terminal ([reset-password]).",
      ),
    );
  }

  return (
    <Card
      title="Secure your account"
      description="Wasn't you? This signs you out everywhere and blocks your current password; you'll get a link to set a new one."
    >
      <Button onClick={secure} disabled={result?.ok}>
        Secure my account
      </Button>
      <ResultMessage result={result} />
    </Card>
  );
}

export default function SecureAccountPage() {
  return (
    <Suspense>
      {/* The token is in the URL: keep it out of Referer headers. */}
      <meta name="referrer" content="no-referrer" />
      <SecureAccount />
    </Suspense>
  );
}
