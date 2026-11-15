"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/**
 * Playground only: records an event of the app's own, as server code
 * would. `recordAuditEvent` is server only: it has no HTTP route.
 */
export async function recordDemoEvent(): Promise<void> {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) throw new Error("Not signed in");
  await auth.api.recordAuditEvent({
    body: {
      type: "billing.plan-changed",
      userId: session.user.id,
      actorUserId: session.user.id,
      metadata: { from: "free", to: "pro" },
    },
    headers: requestHeaders,
  });
}
