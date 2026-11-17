import { createFail } from "@repo/plugin-utils/options";
import type {
  AuditEvent,
  AuditLogDestinationContext,
  AuditLogDestinationEntry,
  DestinationSettings,
  HttpDestinationOptions,
} from "./types";

const fail: (message: string) => never = createFail("audit-log");

const identity = (event: AuditEvent): unknown => event;

function decodeSecret(secret: string): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer> | null = null;
  try {
    const binary = atob(secret.startsWith("whsec_") ? secret.slice(6) : secret);
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    bytes = null;
  }
  if (!bytes || bytes.length < 24 || bytes.length > 64) {
    fail(
      '"secret" of httpDestination must be a base64 key of 24 to 64 bytes (optionally "whsec_...").',
    );
  }
  return bytes;
}

const toBase64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

/**
 * Sends events to a URL with a POST: a webhook, a SIEM, or a log
 * service's HTTP intake. A response other than 2xx counts as failed (and
 * is logged); there are no retries.
 *
 * @example
 * ```ts
 * import { httpDestination } from "@checodo/better-auth-audit-log/destinations";
 *
 * auditLog({
 *   destinations: [
 *     httpDestination({
 *       url: "https://example.com/webhooks/audit",
 *       secret: process.env.AUDIT_WEBHOOK_SECRET,
 *       batch: { size: 50, wait: 2000 },
 *     }),
 *   ],
 * });
 * ```
 */
export function httpDestination(options: HttpDestinationOptions): AuditLogDestinationEntry {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    fail('"url" of httpDestination must be an absolute URL.');
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    fail('"url" of httpDestination must start with "https:" or "http:".');
  }
  const format = options.format ?? "json";
  if (format !== "json" && format !== "ndjson") {
    fail('"format" of httpDestination must be "json" or "ndjson".');
  }
  const key =
    options.secret === undefined
      ? null
      : crypto.subtle.importKey(
          "raw",
          decodeSecret(options.secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );

  return {
    name: options.name ?? "http",
    events: options.events,
    batch: options.batch,
    timeout: options.timeout,
    transform: options.transform ?? identity,
    send: async (batch: unknown[], { signal }: AuditLogDestinationContext) => {
      const body =
        format === "ndjson"
          ? `${batch.map((item) => JSON.stringify(item)).join("\n")}\n`
          : JSON.stringify(batch);
      const headers = new Headers(options.headers);
      headers.set(
        "content-type",
        format === "ndjson" ? "application/x-ndjson" : "application/json",
      );
      if (key) {
        const id = `msg_${crypto.randomUUID()}`;
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const signature = await crypto.subtle.sign(
          "HMAC",
          await key,
          new TextEncoder().encode(`${id}.${timestamp}.${body}`),
        );
        headers.set("webhook-id", id);
        headers.set("webhook-timestamp", timestamp);
        headers.set("webhook-signature", `v1,${toBase64(signature)}`);
      }
      const response = await fetch(url, { method: "POST", headers, body, signal });
      // Free the connection; the body isn't needed.
      await response.body?.cancel().catch(() => {});
      // The origin only: the path or query may carry a token.
      if (!response.ok) throw new Error(`${url.origin} answered ${response.status}`);
    },
  };
}

/**
 * Writes one JSON line per event to the console (`console.log`): for
 * development, or a platform that collects stdout.
 *
 * @example
 * ```ts
 * import { consoleDestination } from "@checodo/better-auth-audit-log/destinations";
 *
 * auditLog({ destinations: [consoleDestination()] });
 * ```
 */
export function consoleDestination(options: DestinationSettings = {}): AuditLogDestinationEntry {
  return {
    name: options.name ?? "console",
    events: options.events,
    batch: options.batch,
    timeout: options.timeout,
    transform: options.transform ?? identity,
    send: (batch: unknown[]) => {
      for (const item of batch) console.log(JSON.stringify(item));
    },
  };
}

export type {
  AuditLogDestination,
  AuditLogDestinationBatch,
  AuditLogDestinationContext,
  AuditLogDestinationEntry,
  DestinationSettings,
  HttpDestinationOptions,
} from "./types";
