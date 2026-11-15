"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import type { Result } from "@/components/ui";
import { Button, Card, Code, Hint, Input, ResultMessage, toResult } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

function formValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
}

export default function Home() {
  const { data: session } = authClient.useSession();
  const [signUpResult, setSignUpResult] = useState<Result | null>(null);
  const [signInResult, setSignInResult] = useState<Result | null>(null);
  const [referralCode, setReferralCode] = useState("");

  // Share links from the Referral page look like /?ref=<code>.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) setReferralCode(ref);
  }, []);

  async function signUp(event: FormEvent<HTMLFormElement>) {
    const { email = "", name = "", username, password = "" } = formValues(event);
    const response = await authClient.signUp.email(
      { email, name, password, ...(username ? { username } : {}) },
      // The referral plugin reads the code from this header.
      referralCode ? { headers: { "x-referral-code": referralCode } } : undefined,
    );
    setSignUpResult(toResult(response, `Signed up as ${email}`));
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    const { login = "", password = "" } = formValues(event);
    const response = login.includes("@")
      ? await authClient.signIn.email({ email: login, password })
      : await authClient.signIn.username({ username: login, password });
    setSignInResult(toResult(response, `Signed in as ${login}`));
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">better-auth-plugins playground</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A real better-auth app with the blocklist plugin and its predefined lists, the waitlist,
          referral, and audit log plugins, and the official <Code>username</Code>,{" "}
          <Code>organization</Code>, and <Code>admin</Code> plugins. Data lives in a local SQLite
          file.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Use made-up addresses like <Code>jane@acme.test</Code> for normal sign-ups. Other
          addresses go through the waitlist: join and get approved on the{" "}
          <Link href="/waitlist" className="underline">
            Waitlist
          </Link>{" "}
          page first.
        </p>
      </div>

      {session ? (
        <Card title="Signed in" description={`${session.user.name} · ${session.user.email}`}>
          <Button variant="secondary" type="button" onClick={() => authClient.signOut()}>
            Sign out
          </Button>
        </Card>
      ) : null}

      <Card
        title="Sign up"
        description={
          <>
            Try a disposable address (<Code>me@mailinator.com</Code>, even{" "}
            <Code>me@eu.mailinator.com</Code>), <Code>blocked+tag@acme.test</Code>, or a reserved
            username like <Code>admin</Code> or <Code>support</Code>.
          </>
        }
      >
        <form onSubmit={signUp} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Email" name="email" type="email" required />
            <Input label="Name" name="name" required defaultValue="Test User" />
            <Input label="Username (optional)" name="username" />
            <Input
              label="Referral code (optional)"
              name="referralCode"
              value={referralCode}
              onChange={(event) => setReferralCode(event.target.value)}
            />
            <Input
              label="Password"
              name="password"
              type="password"
              required
              minLength={8}
              defaultValue="password1234"
            />
          </div>
          <Button>Sign up</Button>
          <ResultMessage result={signUpResult} />
        </form>
      </Card>

      <Card title="Sign in" description="With your email or username.">
        <form onSubmit={signIn} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Email or username" name="login" required />
            <Input
              label="Password"
              name="password"
              type="password"
              required
              defaultValue="password1234"
            />
          </div>
          <Button>Sign in</Button>
          <ResultMessage result={signInResult} />
        </form>
        <Hint>The password field is prefilled with the sign-up default.</Hint>
      </Card>
    </>
  );
}
