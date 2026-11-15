"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/**
 * Playground only: records the "first-purchase" step for the signed-in
 * user, as a payment webhook would. `completeReferralStep` is server only:
 * it has no HTTP route.
 */
export async function simulatePurchase(): Promise<{ referred: boolean }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not signed in");
  const { referral } = await auth.api.completeReferralStep({
    body: { userId: session.user.id, step: "first-purchase", metadata: { orderId: "demo" } },
  });
  return { referred: referral !== null };
}
