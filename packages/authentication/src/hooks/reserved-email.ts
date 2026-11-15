import type { BetterAuthOptions, GenericEndpointContext } from "@better-auth/core";
import { getCurrentAdapter } from "@better-auth/core/context";
import { APIError } from "better-auth/api";
import { AUTHENTICATION_ERROR_CODES } from "../error-codes";
import type { ProviderDefinition } from "../providers/types";
import { hasDomain } from "../utils/email";

type Context = GenericEndpointContext | null | undefined;

/**
 * Placeholder emails (`<account id>@steam.invalid`) belong to the provider
 * they came from:
 *
 * - If anyone could sign up with one, they could take a player's
 *   placeholder first and block (or, with careless account linking, take
 *   over) that player's sign-in. So users with these domains can only be
 *   created or changed by that provider's own callback, or by server code
 *   outside a request.
 * - With `overrideUserInfoOnSignIn`, better-auth writes the provider's
 *   email back on every sign-in. For a user with a real email (who linked
 *   the provider account, or changed their email later) that would replace
 *   it with the placeholder; the email change is dropped instead.
 */
export function createReservedEmailHooks(
  definitions: ProviderDefinition[],
): BetterAuthOptions["databaseHooks"] {
  /** The provider whose placeholder `email` is, if the request is that provider's callback; throws otherwise. */
  const ownerOf = (email: unknown, context: Context): ProviderDefinition | null => {
    if (typeof email !== "string" || !context) return null;
    const owner = definitions.find((definition) => hasDomain(email, definition.emailDomain));
    if (!owner) return null;
    const params = context.params as { id?: unknown } | undefined;
    if (context.path !== "/callback/:id" || params?.id !== owner.provider.id) {
      throw APIError.from("BAD_REQUEST", AUTHENTICATION_ERROR_CODES.EMAIL_DOMAIN_RESERVED);
    }
    return owner;
  };

  return {
    user: {
      create: {
        before: async (user, context) => {
          ownerOf(user.email, context);
        },
      },
      update: {
        before: async (data, context) => {
          if (!ownerOf(data.email, context) || !context) return;
          // Emails are unique: if no user has the placeholder, this update
          // would replace another email with it.
          const adapter = await getCurrentAdapter(context.context.adapter);
          const holder = await adapter.findOne({
            model: "user",
            where: [{ field: "email", value: (data.email as string).toLowerCase() }],
          });
          if (!holder) return { data: { email: undefined, emailVerified: undefined } };
        },
      },
    },
  };
}
