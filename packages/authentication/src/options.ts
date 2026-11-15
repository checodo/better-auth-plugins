import { createFail } from "@repo/plugin-utils/options";
import { epic } from "./providers/epic";
import { steam } from "./providers/steam";
import type { ProviderDefinition } from "./providers/types";
import { xbox } from "./providers/xbox";
import type { AuthenticationOptions } from "./types";
import { isValidEmailDomain } from "./utils/email";

const fail = createFail("authentication");

function emailDomain(providerId: string, domain: string | undefined): string {
  const resolved = (domain ?? `${providerId}.invalid`).toLowerCase();
  if (!isValidEmailDomain(resolved)) {
    fail(`"${providerId}.emailDomain" must be a domain name, got ${JSON.stringify(domain)}.`);
  }
  return resolved;
}

function requireClient(
  providerId: string,
  options: { clientId?: unknown; clientSecret?: unknown },
) {
  if (typeof options.clientId !== "string" || options.clientId === "") {
    fail(`"${providerId}.clientId" is required.`);
  }
  if (typeof options.clientSecret !== "string" || options.clientSecret === "") {
    fail(`"${providerId}.clientSecret" is required.`);
  }
}

/** Validates the options once, at creation, and builds the providers. */
export function resolveProviders(options: AuthenticationOptions): ProviderDefinition[] {
  const definitions: ProviderDefinition[] = [];
  if (options.steam) {
    if (options.steam.apiKey !== undefined && options.steam.apiKey.trim() === "") {
      fail('"steam.apiKey" is empty; leave it out to sign in without loading profiles.');
    }
    definitions.push(steam(options.steam, emailDomain("steam", options.steam.emailDomain)));
  }
  if (options.epic) {
    requireClient("epic", options.epic);
    definitions.push(epic(options.epic, emailDomain("epic", options.epic.emailDomain)));
  }
  if (options.xbox) {
    requireClient("xbox", options.xbox);
    definitions.push(xbox(options.xbox, emailDomain("xbox", options.xbox.emailDomain)));
  }
  if (definitions.length === 0) fail("Configure at least one provider: steam, epic, or xbox.");

  const domains = definitions.map((definition) => definition.emailDomain);
  if (new Set(domains).size !== domains.length) {
    fail("Each provider needs an email domain of its own.");
  }
  return definitions;
}
