"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { authClient } from "@/lib/auth-client";

/** Renders `children` only for signed-in users. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!session) {
    return (
      <p className="text-sm text-muted-foreground">
        <Link href="/" className="underline">
          Sign in
        </Link>{" "}
        first.
      </p>
    );
  }
  return children;
}
