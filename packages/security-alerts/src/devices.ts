import type { AuthContext, GenericEndpointContext } from "@better-auth/core";
import type { User } from "@better-auth/core/db";
import { findAll } from "@repo/plugin-utils/pagination";
import { makeSignature } from "better-auth/crypto";
import type { Alerter } from "./alerts";
import { headersOf, PLUGIN_ID } from "./alerts";
import type { ResolvedSecurityAlertsOptions, SecurityAlertDevice } from "./types";
import { coarseNetwork, describeDevice } from "./utils/device";

export const MODEL = "knownDevice";

/** A row of the `knownDevice` table. */
export interface KnownDevice {
  id: string;
  userId: string;
  fingerprint: string;
  label: string;
  lastSeenAt: Date;
  expiresAt: Date;
  createdAt: Date;
}

type Adapter = AuthContext["adapter"];

export function findDevices(adapter: Adapter, userId: string): Promise<KnownDevice[]> {
  // Every device, also with `maxDevices` above 100: a plain findMany stops at 100.
  return findAll<KnownDevice>(adapter, {
    model: MODEL,
    where: [{ field: "userId", value: userId }],
  });
}

export async function deleteDevices(adapter: Adapter, userId: string): Promise<void> {
  await adapter.deleteMany({ model: MODEL, where: [{ field: "userId", value: userId }] });
}

/** Makes every device of the user new again; the next sign-in from any of them alerts. */
export async function expireDevices(adapter: Adapter, userId: string): Promise<void> {
  await adapter.updateMany({
    model: MODEL,
    where: [{ field: "userId", value: userId }],
    update: { expiresAt: new Date() },
  });
}

/** The device of a request: its browser and OS, and its fingerprint. */
export async function deviceOf(
  authContext: Pick<AuthContext, "secret">,
  options: ResolvedSecurityAlertsOptions,
  headers: Headers,
  ipAddress: string | null | undefined,
): Promise<{ device: SecurityAlertDevice; fingerprint: string }> {
  const device = describeDevice(options.newDevice.getDevice(headers));
  const network = options.newDevice.includeIp ? coarseNetwork(ipAddress) : null;
  // Keyed with the auth secret: the stored value doesn't tell the device.
  const fingerprint = await makeSignature(
    JSON.stringify([device.browser, device.os, network]),
    authContext.secret,
  );
  return { device, fingerprint };
}

/**
 * Remembers the device the user just signed in from, and alerts when it is
 * new: not among the user's known devices (or expired), unless the user
 * has none on record yet (the first sign-in). `newDevice.isNewDevice` can
 * decide instead. The least recently seen devices beyond
 * `newDevice.maxDevices` are forgotten.
 */
export async function handleSignIn(
  authContext: AuthContext,
  context: GenericEndpointContext,
  options: ResolvedSecurityAlertsOptions,
  alert: Alerter,
  signIn: {
    user: User & Record<string, unknown>;
    session: { ipAddress?: string | null; userAgent?: string | null };
  },
): Promise<void> {
  const { adapter } = authContext;
  const userId = signIn.user.id;
  const { device, fingerprint } = await deviceOf(
    authContext,
    options,
    headersOf(context),
    signIn.session.ipAddress,
  );
  const now = new Date();
  const expiresAt = new Date(now.getTime() + options.newDevice.expiresIn);

  const devices = await findDevices(adapter, userId);
  const match = devices.find((row) => row.fingerprint === fingerprint);
  const known = !!match && new Date(match.expiresAt) > now;
  const firstSignIn = devices.length === 0;

  if (match) {
    await adapter.update({
      model: MODEL,
      where: [{ field: "id", value: match.id }],
      update: { lastSeenAt: now, expiresAt, label: device.label },
    });
  } else {
    try {
      await adapter.create({
        model: MODEL,
        data: {
          userId,
          fingerprint,
          label: device.label,
          lastSeenAt: now,
          expiresAt,
          createdAt: now,
        },
      });
    } catch (error) {
      // A concurrent sign-in from the same device stored it first.
      authContext.logger.debug(`[${PLUGIN_ID}] device already stored`, error);
    }
    const overflow = devices.length + 1 - options.newDevice.maxDevices;
    if (overflow > 0) {
      const oldest = [...devices]
        .sort((a, b) => new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime())
        .slice(0, overflow);
      for (const row of oldest) {
        await adapter.delete({ model: MODEL, where: [{ field: "id", value: row.id }] });
      }
    }
  }

  const decision = await options.newDevice.isNewDevice?.({
    user: signIn.user,
    device,
    ipAddress: signIn.session.ipAddress ?? null,
    userAgent: signIn.session.userAgent ?? null,
    known,
    firstSignIn,
  });
  if (!(decision ?? (!known && !firstSignIn))) return;

  await alert(authContext, context, {
    type: "new-device",
    userId,
    user: signIn.user,
    // The user signs in themself, whoever was signed in before.
    actorUserId: userId,
    details: {
      device,
      ...(signIn.session.ipAddress !== undefined ? { ipAddress: signIn.session.ipAddress } : {}),
      ...(signIn.session.userAgent !== undefined ? { userAgent: signIn.session.userAgent } : {}),
    },
  });
}
