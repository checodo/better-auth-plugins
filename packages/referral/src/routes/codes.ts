import type { BetterAuthPlugin } from "@better-auth/core";
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import * as z from "zod";
import { findUsableCode, getOrCreateCode, regenerateCode } from "../referrals";
import { findCodeByUserId } from "../store";
import type { ResolvedReferralOptions } from "../types";

export function createCodeEndpoints(options: ResolvedReferralOptions) {
  return {
    getReferralCode: createAuthEndpoint(
      "/referral/get-code",
      {
        method: "GET",
        use: [sessionMiddleware],
        metadata: {
          openapi: {
            description: "Get the signed-in user's referral code, or null if they have none",
          },
        },
      },
      async (ctx) => {
        const code = await findCodeByUserId(ctx.context.adapter, ctx.context.session.user.id);
        return ctx.json({ code: code?.code ?? null });
      },
    ),
    createReferralCode: createAuthEndpoint(
      "/referral/create-code",
      {
        method: "POST",
        use: [sessionMiddleware],
        metadata: {
          openapi: {
            description:
              "Create the signed-in user's referral code. Returns the existing code if they already have one",
          },
        },
      },
      async (ctx) => {
        const code = await getOrCreateCode(
          ctx.context.adapter,
          options,
          ctx.context.session.user.id,
        );
        return ctx.json({ code: code.code });
      },
    ),
    regenerateReferralCode: createAuthEndpoint(
      "/referral/regenerate-code",
      {
        method: "POST",
        use: [sessionMiddleware],
        metadata: {
          openapi: {
            description:
              "Replace the signed-in user's referral code with a new one. The old code and its share links stop working; referrals made with it keep counting",
          },
        },
      },
      async (ctx) => {
        const code = await regenerateCode(
          ctx.context.adapter,
          options,
          ctx.context.session.user.id,
        );
        return ctx.json({ code: code.code });
      },
    ),
    checkReferralCode: createAuthEndpoint(
      "/referral/check-code",
      {
        method: "GET",
        query: z.object({
          code: z.string().min(1).max(128).meta({ description: "The referral code" }),
        }),
        metadata: {
          openapi: {
            description:
              "Check whether a referral code can be used at sign-up. Doesn't reveal whose code it is",
          },
        },
      },
      async (ctx) => {
        const code = await findUsableCode(ctx.context.adapter, options, ctx.query.code);
        return ctx.json({ valid: code !== null });
      },
    ),
  } satisfies BetterAuthPlugin["endpoints"];
}
