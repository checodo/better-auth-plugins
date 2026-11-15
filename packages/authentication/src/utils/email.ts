/** Hostname labels: letters, digits, hyphens; at least two labels. */
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

export function isValidEmailDomain(domain: string): boolean {
  return DOMAIN.test(domain);
}

/**
 * A placeholder email for a user the provider gives no email:
 * `<account id>@<domain>`. Unique per account, and on a domain that can't
 * receive email (`.invalid` by default).
 */
export function placeholderEmail(accountId: string, domain: string): string {
  return `${accountId.toLowerCase()}@${domain}`;
}

export function hasDomain(email: string, domain: string): boolean {
  return email.toLowerCase().endsWith(`@${domain}`);
}
