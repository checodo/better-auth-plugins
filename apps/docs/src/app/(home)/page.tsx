import Link from "next/link";
import type { ReactNode } from "react";
import { GitHubIcon, githubUrl } from "@/lib/layout.shared";

type Plugin = {
  name: string;
  description: string;
  highlights: string[];
  href: string;
};

const plugins: Plugin[] = [
  {
    name: "Audit log",
    description:
      "A log of sign-ins, failed sign-ins, account changes, and admin actions, for users and admins.",
    highlights: [
      "Records every sign-in method, two-factor included",
      "Admin actions with the admin as actor",
      "Never stores passwords or tokens; beforeLog to pseudonymize",
      "Optional hash chain to detect changed or deleted events",
    ],
    href: "/docs/audit-log",
  },
  {
    name: "Authentication",
    description:
      "Sign in with Steam, Epic Games, and Xbox, configured and used like better-auth's built-in social providers.",
    highlights: [
      "signIn.social, linkSocial, and better-auth's own callback",
      "Steam's OpenID answer is confirmed with Steam before it counts",
      "Epic ID tokens verified against Epic's keys",
      "Placeholder emails nobody else can claim",
    ],
    href: "/docs/authentication",
  },
  {
    name: "Blocklist",
    description:
      "Block disposable email domains, reserved usernames, unwanted names, weak passwords, and IP addresses.",
    highlights: [
      "Checks every sign-up and update: email, OAuth, magic link, admin actions",
      "Catches ADMIN, ádmin, and look-alike letters",
      "Ready-made lists of disposable domains and reserved usernames",
      "Rules in your config, or managed by admins at runtime",
    ],
    href: "/docs/blocklist",
  },
  {
    name: "Referral",
    description:
      "Referral codes, sign-up attribution, and steps a referral must complete before it earns a reward.",
    highlights: [
      "Attributes every sign-up method, social sign-in included",
      "Steps like a verified email or a first purchase before rewards",
      "Reward callback runs exactly once per referral",
      "Masked emails; codes don't reveal whose they are",
    ],
    href: "/docs/referral",
  },
  {
    name: "Waitlist",
    description:
      "Gate sign-up behind a waitlist. Admins approve entries, and only approved emails can create an account.",
    highlights: [
      "Gates every way in: email, OAuth, magic link, server code",
      "Double opt-in, with status and leave links",
      "Single-use invite codes, bound to one email, that expire",
      "Never reveals who is on the waitlist",
    ],
    href: "/docs/waitlist",
  },
];

const features = [
  {
    title: "Feels built in",
    description:
      "Same shape as better-auth's own plugins: options, error codes, schema, hooks, and a client plugin.",
  },
  {
    title: "Typed end to end",
    description:
      "Options, endpoints, and responses are typed on the server and inferred on the client.",
  },
  {
    title: "Small and opt-in",
    description:
      "One package per plugin. Install only what you use; better-auth stays a peer dependency.",
  },
];

const example = `import { betterAuth } from "better-auth";
import { blocklist } from "@checodo/better-auth-blocklist";
import { disposableEmailDomains } from "@checodo/better-auth-blocklist/lists";
import { waitlist } from "@checodo/better-auth-waitlist";

export const auth = betterAuth({
  plugins: [
    blocklist({
      email: { domains: disposableEmailDomains },
      username: { values: ["admin", "support"] },
    }),
    waitlist({
      sendConfirmationEmail: ({ email, token }) => sendConfirmation(email, token),
      sendInvite: ({ email, inviteCode }) => sendInvite(email, inviteCode),
    }),
  ],
});`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="w-full max-w-5xl mx-auto px-4 py-12 border-t border-fd-border">
      <h2 className="text-sm font-medium uppercase tracking-wider text-fd-muted-foreground mb-6">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PluginCard({ plugin }: { plugin: Plugin }) {
  return (
    <Link
      href={plugin.href}
      className="group block rounded-xl border border-fd-border bg-fd-card p-6 transition-colors hover:border-brand hover:bg-fd-accent"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-lg font-semibold">{plugin.name}</h3>
        <span className="text-sm text-fd-muted-foreground group-hover:text-fd-foreground">
          Read the docs →
        </span>
      </div>
      <p className="mt-2 text-fd-muted-foreground">{plugin.description}</p>
      <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        {plugin.highlights.map((highlight) => (
          <li key={highlight} className="flex gap-2.5">
            {/* The logo's lime square, as a bullet (decoration only). */}
            <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 bg-brand" />
            {highlight}
          </li>
        ))}
      </ul>
    </Link>
  );
}

export default function HomePage() {
  return (
    <main className="flex flex-col flex-1">
      <section className="w-full max-w-5xl mx-auto px-4 pt-20 pb-12 grid gap-10 lg:grid-cols-[1fr_1.25fr] lg:items-center">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-fd-muted-foreground">
            <span aria-hidden="true" className="size-2.5 bg-brand" />
            Community plugins, not made by the better-auth team
          </p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Community plugins for better-auth
          </h1>
          <p className="mt-4 text-lg text-fd-muted-foreground">
            Small, typed plugins that install and behave like the ones that ship with{" "}
            <a href="https://better-auth.com" className="font-medium text-fd-foreground underline">
              better-auth
            </a>
            .
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/docs"
              className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
            >
              Get started
            </Link>
            <a
              href={githubUrl}
              className="inline-flex items-center gap-2 rounded-lg border border-fd-border px-4 py-2 text-sm font-medium hover:bg-fd-accent"
            >
              <span className="size-4">
                <GitHubIcon />
              </span>
              GitHub
            </a>
          </div>
        </div>
        <div className="min-w-0 rounded-xl border border-fd-border bg-fd-card">
          <div className="border-b border-fd-border px-4 py-2 text-xs text-fd-muted-foreground font-mono">
            auth.ts
          </div>
          <pre className="overflow-x-auto p-4 text-xs leading-relaxed font-mono">
            <code>{example}</code>
          </pre>
        </div>
      </section>

      <Section title="Plugins">
        <div className="grid gap-4">
          {plugins.map((plugin) => (
            <PluginCard key={plugin.name} plugin={plugin} />
          ))}
        </div>
      </Section>

      <Section title="Why these plugins">
        <div className="grid gap-8 sm:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title}>
              <h3 className="font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-fd-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}
