"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const LINKS = [
  { href: "/", label: "Sign up / in" },
  { href: "/account", label: "Account" },
  { href: "/authentication", label: "Sign-in providers" },
  { href: "/organizations", label: "Organizations" },
  { href: "/admin", label: "Blocklist rules" },
  { href: "/normalize", label: "Normalize" },
  { href: "/waitlist", label: "Waitlist" },
  { href: "/referral", label: "Referral" },
  { href: "/security-alerts", label: "Security alerts" },
  { href: "/audit-log", label: "Audit log" },
];

export function Nav() {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <span className="font-semibold">Playground</span>
        <nav className="flex flex-wrap gap-4 text-sm">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname === link.href ? "font-medium" : "text-muted-foreground"}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto text-xs text-muted-foreground">
          {session
            ? `${session.user.email}${session.user.role ? ` · ${session.user.role}` : ""}`
            : "Signed out"}
        </span>
      </div>
    </header>
  );
}
