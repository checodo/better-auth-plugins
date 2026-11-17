import type { BetterAuthPlugin } from "@better-auth/core";
import { isAdmin } from "@repo/plugin-utils/admin";
import { paginationQuery } from "@repo/plugin-utils/pagination";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import * as z from "zod";
import { REFERRAL_ERROR_CODES } from "../error-codes";
import { MAX_STEP_LENGTH } from "../options";
import { attemptReward, recordStep } from "../referrals";
import {
  claimRewardAttempt,
  countReferrals,
  findReferralByReferredUserId,
  findUsers,
  listDueRewards,
  listReferrals,
  stepsByReferral,
} from "../store";
import type { Referral, ReferralWithSteps, ResolvedReferralOptions } from "../types";
import { maskEmail } from "../utils/mask";

/** Most referrals one list request returns. */
export const MAX_PAGE_SIZE = 100;
/** Longest JSON-encoded step `metadata`. */
export const MAX_METADATA_LENGTH = 2000;
/** Referrals one `retryReferralRewards` call retries by default, and at most. */
export const DEFAULT_RETRY_BATCH = 50;
export const MAX_RETRY_BATCH = 500;

const pageSchema = paginationQuery({ defaultLimit: 20, maxLimit: MAX_PAGE_SIZE });
const statusSchema = z
  .enum(["pending", "completed"])
  .meta({ description: "Only referrals with this status" });

async function withSteps(
  adapter: Parameters<typeof stepsByReferral>[0],
  referrals: Referral[],
): Promise<ReferralWithSteps[]> {
  const steps = await stepsByReferral(
    adapter,
    referrals.map((referral) => referral.id),
  );
  return referrals.map((referral) => ({ ...referral, steps: steps.get(referral.id) ?? [] }));
}

export function createReferralEndpoints(options: ResolvedReferralOptions) {
  return {
    listReferrals: createAuthEndpoint(
      "/referral/list-referrals",
      {
        method: "GET",
        use: [sessionMiddleware],
        query: z.optional(z.object({ status: statusSchema.optional(), ...pageSchema })),
        metadata: {
          openapi: {
            description:
              "List the users the signed-in user referred, newest first, with their steps",
          },
        },
      },
      async (ctx) => {
        const { adapter } = ctx.context;
        const referrerUserId = ctx.context.session.user.id;
        const status = ctx.query?.status;
        const [referrals, total, completed] = await Promise.all([
          listReferrals(adapter, {
            referrerUserId,
            status,
            limit: ctx.query?.limit ?? 20,
            offset: ctx.query?.offset ?? 0,
          }),
          countReferrals(adapter, { referrerUserId, status }),
          countReferrals(adapter, { referrerUserId, status: "completed" }),
        ]);
        const [detailed, users] = await Promise.all([
          withSteps(adapter, referrals),
          findUsers(
            adapter,
            referrals.map((referral) => referral.referredUserId),
          ),
        ]);

        return ctx.json({
          // Only what a referrer needs: who (name, masked email) and how far.
          referrals: detailed.map((referral) => {
            const user = users.get(referral.referredUserId);
            return {
              id: referral.id,
              status: referral.status,
              steps: referral.steps,
              createdAt: referral.createdAt,
              completedAt: referral.completedAt ?? null,
              referredUser: {
                name: options.hideNames ? null : (user?.name ?? null),
                email: user ? (options.maskEmails ? maskEmail(user.email) : user.email) : null,
              },
            };
          }),
          total,
          completed,
        });
      },
    ),
    listAllReferrals: createAuthEndpoint(
      "/referral/list-all-referrals",
      {
        method: "GET",
        use: [sessionMiddleware],
        query: z.optional(
          z.object({
            referrerUserId: z
              .string()
              .min(1)
              .optional()
              .meta({ description: "Only referrals by this user" }),
            status: statusSchema.optional(),
            ...pageSchema,
          }),
        ),
        metadata: {
          openapi: { description: "List all referrals, newest first. Admins only" },
        },
      },
      async (ctx) => {
        if (!isAdmin(ctx.context.session.user, options)) {
          throw APIError.from(
            "FORBIDDEN",
            REFERRAL_ERROR_CODES.YOU_ARE_NOT_ALLOWED_TO_LIST_REFERRALS,
          );
        }
        const { adapter } = ctx.context;
        const filters = { referrerUserId: ctx.query?.referrerUserId, status: ctx.query?.status };
        const [referrals, total] = await Promise.all([
          listReferrals(adapter, {
            ...filters,
            limit: ctx.query?.limit ?? 20,
            offset: ctx.query?.offset ?? 0,
          }),
          countReferrals(adapter, filters),
        ]);
        return ctx.json({ referrals: await withSteps(adapter, referrals), total });
      },
    ),
    /**
     * Server only (no path, so not reachable over HTTP): your backend calls
     * `auth.api.completeReferralStep` when a referred user does something
     * that counts, e.g. their first purchase.
     */
    completeReferralStep: createAuthEndpoint(
      {
        method: "POST",
        body: z.object({
          userId: z.string().min(1).meta({ description: "The referred user" }),
          step: z
            .string()
            .min(1)
            .max(MAX_STEP_LENGTH)
            .meta({ description: "A step from the plugin's `steps` option" }),
          metadata: z
            .record(z.string(), z.unknown())
            .optional()
            .meta({ description: "Extra data to keep with the step, e.g. an order id" }),
        }),
        metadata: {
          openapi: {
            description:
              "Record a step of the user's referral. Does nothing if the user wasn't referred or the step is already done",
          },
        },
      },
      async (ctx) => {
        const { userId, step } = ctx.body;
        const metadata = ctx.body.metadata ? JSON.stringify(ctx.body.metadata) : undefined;
        if (metadata && metadata.length > MAX_METADATA_LENGTH) {
          throw APIError.from("BAD_REQUEST", REFERRAL_ERROR_CODES.METADATA_TOO_LARGE);
        }
        if (!options.steps.includes(step)) {
          throw APIError.from("BAD_REQUEST", REFERRAL_ERROR_CODES.UNKNOWN_REFERRAL_STEP);
        }
        const { adapter } = ctx.context;
        const referral = await findReferralByReferredUserId(adapter, userId);
        // Most users weren't referred: that's not an error.
        if (!referral) return ctx.json({ referral: null });

        const updated = await recordStep(adapter, ctx.context, options, referral, step, metadata);
        const [detailed] = await withSteps(adapter, [updated]);
        return ctx.json({ referral: detailed ?? null });
      },
    ),
    /**
     * Server only: no HTTP route. Call it regularly, e.g. every few
     * minutes from a cron job, to call `onReferralCompleted` again for
     * completed referrals whose call failed or never finished.
     */
    retryReferralRewards: createAuthEndpoint(
      {
        method: "POST",
        body: z.optional(
          z.object({
            limit: z
              .number()
              .int()
              .min(1)
              .max(MAX_RETRY_BATCH)
              .optional()
              .meta({
                description: `Most referrals to retry in this call (default ${DEFAULT_RETRY_BATCH})`,
              }),
          }),
        ),
        metadata: {
          openapi: {
            description:
              "Call onReferralCompleted again for completed referrals whose call failed or never finished",
          },
        },
      },
      async (ctx) => {
        const { onReferralCompleted, rewardRetry } = options;
        if (!onReferralCompleted) return ctx.json({ attempted: 0, rewarded: 0 });
        const { adapter, logger } = ctx.context;
        const before = new Date(Date.now() - rewardRetry.delay);
        const due = await listDueRewards(adapter, {
          before,
          maxAttempts: rewardRetry.maxAttempts,
          limit: ctx.body?.limit ?? DEFAULT_RETRY_BATCH,
        });

        let attempted = 0;
        let rewarded = 0;
        // One at a time, awaited: a cron job wants the result, not speed.
        for (const referral of due) {
          const claimed = await claimRewardAttempt(adapter, referral, before);
          // null: another call of this endpoint is retrying it.
          if (!claimed) continue;
          attempted += 1;
          if (await attemptReward(adapter, logger, options, claimed)) rewarded += 1;
        }
        return ctx.json({ attempted, rewarded });
      },
    ),
  } satisfies BetterAuthPlugin["endpoints"];
}
