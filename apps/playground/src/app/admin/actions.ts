"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/**
 * Playground only: gives the signed-in user the `admin` role, which the
 * blocklist's rule endpoints require. Never ship something like this.
 */
export async function makeMeAdmin(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  const ctx = await auth.$context;
  await ctx.internalAdapter.updateUser(session.user.id, { role: "admin" });
}
