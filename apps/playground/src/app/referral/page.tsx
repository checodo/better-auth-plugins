"use client";

import { useCallback, useEffect, useState } from "react";
import { RequireSession } from "@/components/require-session";
import type { Result } from "@/components/ui";
import { Button, Card, Code, Hint, ResultMessage, toResult } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { simulatePurchase } from "./actions";

type Listed = {
  referrals: {
    id: string;
    status: string;
    steps: string[];
    referredUser: { name: string | null; email: string | null };
  }[];
  total: number;
  completed: number;
};

export default function Referral() {
  const { data: session } = authClient.useSession();
  const [code, setCode] = useState<string | null>(null);
  const [listed, setListed] = useState<Listed | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(async () => {
    const [current, referrals] = await Promise.all([
      authClient.referral.getCode(),
      authClient.referral.listReferrals({ query: { limit: 50 } }),
    ]);
    setCode(current.data?.code ?? null);
    setListed(referrals.data ?? null);
  }, []);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  async function createCode() {
    const response = await authClient.referral.createCode();
    setResult(toResult(response, "Code created."));
    void load();
  }

  async function regenerate() {
    const response = await authClient.referral.regenerateCode();
    setResult(toResult(response, "New code. The old code and its links no longer work."));
    void load();
  }

  async function purchase() {
    const { referred } = await simulatePurchase();
    setResult(
      referred
        ? { ok: true, message: "Recorded first-purchase for your referral." }
        : { ok: false, message: "You weren't referred, so there is nothing to record." },
    );
  }

  const shareUrl = code ? `${window.location.origin}/?ref=${code}` : null;

  return (
    <RequireSession>
      <h1 className="text-2xl font-semibold">Referral</h1>
      <p className="text-sm text-muted-foreground">
        Share your code; people who sign up with it count as your referrals. A referral completes
        after the referred user&apos;s first purchase (<Code>steps</Code> in{" "}
        <Code>src/lib/auth-options.ts</Code>). Rewards are logged in the server output.
      </p>

      <Card title="Your code">
        {code ? (
          <>
            <p className="text-sm">
              <Code>{code}</Code>
            </p>
            <Hint>
              Share link: <Code>{shareUrl}</Code>. Sign out and sign up with it (an{" "}
              <Code>acme.test</Code> address skips the waitlist): the code is sent in the{" "}
              <Code>x-referral-code</Code> header.
            </Hint>
            <Button type="button" variant="secondary" onClick={regenerate}>
              Get a new code
            </Button>
          </>
        ) : (
          <Button type="button" onClick={createCode}>
            Create my code
          </Button>
        )}
      </Card>

      <Card
        title="Simulate a purchase"
        description={
          <>
            For a referred user: records the <Code>first-purchase</Code> step, as a payment webhook
            would with <Code>auth.api.completeReferralStep</Code>.
          </>
        }
      >
        <Button type="button" variant="secondary" onClick={purchase}>
          I bought something
        </Button>
        <ResultMessage result={result} />
      </Card>

      <Card
        title={`Your referrals${listed ? ` (${listed.completed} of ${listed.total} completed)` : ""}`}
      >
        {listed && listed.referrals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody yet.</p>
        ) : null}
        <ul className="divide-y divide-border">
          {listed?.referrals.map((referral) => (
            <li key={referral.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span>{referral.referredUser.name}</span>
              <Code>{referral.referredUser.email ?? "?"}</Code>
              <span className="ml-auto text-muted-foreground">
                {referral.status}
                {referral.steps.length ? ` · ${referral.steps.join(", ")}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <Button type="button" variant="secondary" onClick={load}>
          Refresh
        </Button>
      </Card>
    </RequireSession>
  );
}
