import { normalizeEmailAddress } from "@checodo/better-auth-normalize/email";
import { Card, Code, Hint } from "@/components/ui";

const EMAILS = [
  "a.da+news@gmail.com",
  "A.D.A@googlemail.com",
  "ada+work@outlook.com",
  "ada+test@acme.test",
  "ada-lovelace@yahoo.com",
];

export default function Normalize() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Normalize</h1>
      <p className="text-sm text-muted-foreground">
        One account per inbox. The playground uses <Code>{'subaddressing: "all"'}</Code>, so tags
        count at <Code>acme.test</Code> too.
      </p>

      <Card title="Try it">
        <Hint>
          Sign up as <Code>ada@acme.test</Code> on the first page, sign out, then sign up as{" "}
          <Code>ada+second@acme.test</Code>: refused with{" "}
          <Code>USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL</Code>. Signing in as{" "}
          <Code>ada+second@acme.test</Code> works (<Code>allowNormalizedSignIn</Code>).
        </Hint>
      </Card>

      <Card
        title="Email addresses"
        description="As stored in user.normalizedEmail (built-in rules)."
      >
        <ul className="divide-y divide-border text-sm">
          {EMAILS.map((email) => (
            <li key={email} className="flex flex-wrap justify-between gap-2 py-2">
              <Code>{email}</Code>
              <Code>{normalizeEmailAddress(email) ?? "-"}</Code>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
