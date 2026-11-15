import { auditLogClient } from "@checodo/better-auth-audit-log/client";
import { authenticationClient } from "@checodo/better-auth-authentication/client";
import { blocklistClient } from "@checodo/better-auth-blocklist/client";
import { referralClient } from "@checodo/better-auth-referral/client";
import { waitlistClient } from "@checodo/better-auth-waitlist/client";
import { adminClient, organizationClient, usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [
    blocklistClient(),
    waitlistClient(),
    referralClient(),
    usernameClient(),
    adminClient(),
    organizationClient({ teams: { enabled: true } }),
    auditLogClient(),
    authenticationClient(),
  ],
});
