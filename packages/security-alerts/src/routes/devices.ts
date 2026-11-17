import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import * as z from "zod";
import { deviceOf, findDevices, MODEL } from "../devices";
import { SECURITY_ALERTS_ERROR_CODES } from "../error-codes";
import type { ResolvedSecurityAlertsOptions } from "../types";

/** A known device, as the user sees it (never the fingerprint). */
export interface SecurityAlertsKnownDevice {
  id: string;
  /** E.g. "Chrome on macOS". */
  label: string;
  /** The last sign-in from it. */
  lastSeenAt: Date;
  /** The first sign-in from it. */
  createdAt: Date;
  /** After this, a sign-in from it alerts again. */
  expiresAt: Date;
  /** The device of this request. */
  current: boolean;
}

export function createDeviceEndpoints(options: ResolvedSecurityAlertsOptions) {
  return {
    listDevices: createAuthEndpoint(
      "/security-alerts/list-devices",
      {
        method: "GET",
        use: [sessionMiddleware],
        metadata: {
          openapi: {
            description:
              "List the devices the signed-in user signed in from; a sign-in from any other device alerts",
          },
        },
      },
      async (ctx) => {
        const userId = ctx.context.session.user.id;
        const { fingerprint } = await deviceOf(
          ctx.context,
          options,
          ctx.request?.headers ?? ctx.headers ?? new Headers(),
          ctx.context.session.session.ipAddress,
        );
        const now = new Date();
        const devices: SecurityAlertsKnownDevice[] = (
          await findDevices(ctx.context.adapter, userId)
        )
          .filter((row) => new Date(row.expiresAt) > now)
          .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
          .map((row) => ({
            id: row.id,
            label: row.label,
            lastSeenAt: new Date(row.lastSeenAt),
            createdAt: new Date(row.createdAt),
            expiresAt: new Date(row.expiresAt),
            current: row.fingerprint === fingerprint,
          }));
        return ctx.json(devices);
      },
    ),

    forgetDevice: createAuthEndpoint(
      "/security-alerts/forget-device",
      {
        method: "POST",
        use: [sessionMiddleware],
        body: z.object({
          id: z.string().min(1).max(255).meta({ description: "The id of the device to forget" }),
        }),
        metadata: {
          openapi: {
            description:
              "Forget one of the signed-in user's devices: the next sign-in from it alerts again",
          },
        },
      },
      async (ctx) => {
        const userId = ctx.context.session.user.id;
        const where = [
          { field: "id", value: ctx.body.id },
          { field: "userId", value: userId },
        ];
        const device = await ctx.context.adapter.findOne<{ expiresAt: Date }>({
          model: MODEL,
          where,
        });
        if (!device || new Date(device.expiresAt) <= new Date()) {
          throw APIError.from("NOT_FOUND", SECURITY_ALERTS_ERROR_CODES.DEVICE_NOT_FOUND);
        }
        // Kept as expired, not deleted: forgetting every device mustn't make
        // the next sign-in look like the first one (which doesn't alert).
        await ctx.context.adapter.update({
          model: MODEL,
          where,
          update: { expiresAt: new Date() },
        });
        return ctx.json({ status: true });
      },
    ),
  };
}
