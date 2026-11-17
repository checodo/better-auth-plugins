import type { GenericEndpointContext } from "@better-auth/core";

type Body = Record<string, unknown>;

/** Endpoints that set a new password with a reset token or OTP. */
export const PASSWORD_RESET_PATHS: ReadonlySet<string> = new Set([
  "/reset-password",
  "/email-otp/reset-password",
  "/phone-number/reset-password",
]);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** The user with this email, if any. */
async function userIdByEmail(ctx: GenericEndpointContext, value: unknown) {
  const email = asString(value)?.trim().toLowerCase();
  if (!email) return undefined;
  return (await ctx.context.internalAdapter.findUserByEmail(email))?.user.id;
}

/** The user with this phone number (phone-number plugin), if any. */
async function userIdByPhone(ctx: GenericEndpointContext, value: unknown) {
  const phone = asString(value)?.trim();
  if (!phone) return undefined;
  const user = await ctx.context.adapter
    .findOne<{ id: string }>({ model: "user", where: [{ field: "phoneNumber", value: phone }] })
    .catch(() => null);
  return user?.id;
}

/**
 * The user a password reset is for, looked up before the reset endpoint
 * runs (the token is gone afterwards): by token for `/reset-password`, by
 * the email or phone number for the OTP resets. `undefined` for other
 * endpoints and when nobody matches.
 */
export async function passwordResetUserId(
  ctx: GenericEndpointContext,
): Promise<string | undefined> {
  const body = (ctx.body ?? {}) as Body;
  if (ctx.path === "/reset-password") {
    const token = asString(body.token) ?? asString((ctx.query as Body | undefined)?.token);
    if (!token) return undefined;
    const verification = await ctx.context.internalAdapter.findVerificationValue(
      `reset-password:${token}`,
    );
    return verification?.value;
  }
  if (ctx.path === "/email-otp/reset-password") return userIdByEmail(ctx, body.email);
  if (ctx.path === "/phone-number/reset-password") return userIdByPhone(ctx, body.phoneNumber);
  return undefined;
}
