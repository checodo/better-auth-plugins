"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import type { Result } from "@/components/ui";
import { Button, Card, Code, Hint, ResultMessage, toResult } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { configuredProviders } from "./actions";

type Provider = { id: string; name: string };

function ProviderSignIn() {
  const { data: session } = authClient.useSession();
  const error = useSearchParams().get("error");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [accounts, setAccounts] = useState<{ providerId: string; accountId: string }[]>([]);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    void configuredProviders().then(setProviders);
  }, []);

  const loadAccounts = useCallback(async () => {
    const { data } = await authClient.listAccounts();
    setAccounts(data ?? []);
  }, []);

  useEffect(() => {
    if (session) void loadAccounts();
  }, [session, loadAccounts]);

  async function signIn(provider: string) {
    const response = await authClient.signIn.social({
      provider,
      callbackURL: "/authentication",
      errorCallbackURL: "/authentication",
    });
    if (response.error) setResult(toResult(response, ""));
  }

  async function link(provider: string) {
    const response = await authClient.linkSocial({
      provider,
      callbackURL: "/authentication",
      errorCallbackURL: "/authentication",
    });
    if (response.error) setResult(toResult(response, ""));
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Sign-in providers</h1>
      <p className="text-sm text-muted-foreground">
        The authentication plugin adds sign-in providers that better-auth doesn&apos;t ship, so far
        Steam, Epic Games, and Xbox. They work like built-in social providers: the buttons call
        better-auth&apos;s own <Code>signIn.social</Code> and <Code>linkSocial</Code>. Steam works
        right away; Epic Games and Xbox appear once their credentials are in <Code>.env.local</Code>{" "}
        (see <Code>.env.example</Code>).
      </p>

      {error ? (
        <ResultMessage result={{ ok: false, message: "Sign-in failed", code: error }} />
      ) : null}

      <Card
        title="Sign in"
        description={
          <>
            New users from a provider that shares no email get a placeholder such as{" "}
            <Code>…@steam.invalid</Code>, which nobody can sign up with.
          </>
        }
      >
        <div className="flex flex-wrap gap-3">
          {providers.map((provider) => (
            <Button key={provider.id} type="button" onClick={() => signIn(provider.id)}>
              Sign in with {provider.name}
            </Button>
          ))}
        </div>
        <ResultMessage result={result} />
      </Card>

      {session ? (
        <Card
          title="Linked accounts"
          description={
            <>
              Link a provider account to <Code>{session.user.email}</Code>. Linking needs{" "}
              <Code>accountLinking</Code> settings, set in <Code>src/lib/auth-options.ts</Code>.
            </>
          }
        >
          <ul className="divide-y divide-border">
            {accounts.map((account) => (
              <li key={`${account.providerId}:${account.accountId}`} className="py-2 text-sm">
                <Code>{account.providerId}</Code> {account.accountId}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            {providers.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                variant="secondary"
                onClick={() => link(provider.id)}
              >
                Link {provider.name}
              </Button>
            ))}
          </div>
          <Hint>Linked sign-ins show up on the Audit log page.</Hint>
        </Card>
      ) : null}
    </>
  );
}

export default function Authentication() {
  // useSearchParams needs a Suspense boundary in Next.js.
  return (
    <Suspense>
      <ProviderSignIn />
    </Suspense>
  );
}
