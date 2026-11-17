import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { getTestInstance } from "better-auth/test";
import type { SecurityAlert, SecurityAlertsOptions } from "../src/index";
import { securityAlerts } from "../src/index";

export const PASSWORD = "password1234";

export const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};

/** Headers of a browser: its user agent, optionally a session cookie and an IP. */
export function browser(userAgent: string, extra: Record<string, string> = {}): Headers {
  return new Headers({ "user-agent": userAgent, ...extra });
}

/** The `name=value` pairs of a response's `set-cookie` headers, as a `cookie` header. */
export function cookieOf(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => pair && !pair.endsWith("="))
    .join("; ");
}

/** better-auth's own endpoints; the generic plugin list hides them from TypeScript in `setup`. */
type CoreApi = Pick<
  Awaited<ReturnType<typeof getTestInstance>>["auth"]["api"],
  "signUpEmail" | "signInEmail"
>;

interface ResetEmail {
  email: string;
  url: string;
  token: string;
}

/**
 * An auth instance with email and password and the security alerts
 * plugin; `alerts` collects what `sendAlert` gets, `resetEmails` what
 * `sendResetPassword` gets.
 */
export async function setup<const P extends BetterAuthPlugin[] = []>(
  options: Partial<SecurityAlertsOptions> = {},
  config: { plugins?: P; auth?: Partial<BetterAuthOptions> } = {},
) {
  const alerts: SecurityAlert[] = [];
  const resetEmails: ResetEmail[] = [];
  const instance = await getTestInstance(
    {
      ...config.auth,
      emailAndPassword: {
        enabled: true,
        sendResetPassword: async ({ user, url, token }) => {
          resetEmails.push({ email: user.email, url, token });
        },
        ...config.auth?.emailAndPassword,
      },
      plugins: [
        ...(config.plugins ?? []),
        securityAlerts({
          sendAlert: (alert) => {
            alerts.push(alert);
          },
          ...options,
        }),
      ],
    },
    { disableTestUser: true },
  );
  const { auth } = instance;
  const context = await auth.$context;
  const api = auth.api as unknown as CoreApi;

  /** Signs up (and in, from Chrome on macOS); returns the user and its session cookie. */
  const signUp = async (email: string, userAgent = UA.chromeMac) => {
    const { headers, response } = await api.signUpEmail({
      body: { email, password: PASSWORD, name: email.split("@")[0] ?? "user" },
      headers: browser(userAgent),
      returnHeaders: true,
    });
    return { user: response.user, headers: browser(userAgent, { cookie: cookieOf(headers) }) };
  };

  /** Signs in from a browser; returns its headers with the session cookie. */
  const signIn = async (
    email: string,
    userAgent: string,
    extra: Record<string, string> = {},
    password = PASSWORD,
  ) => {
    const { headers } = await api.signInEmail({
      body: { email, password },
      headers: browser(userAgent, extra),
      returnHeaders: true,
    });
    return browser(userAgent, { ...extra, cookie: cookieOf(headers) });
  };

  const ofType = (type: SecurityAlert["type"]) => alerts.filter((alert) => alert.type === type);

  return { ...instance, auth, context, alerts, resetEmails, signUp, signIn, ofType };
}
