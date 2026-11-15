"use client";

import type { AuditEvent } from "@checodo/better-auth-audit-log";
import { useCallback, useEffect, useState } from "react";
import { RequireSession } from "@/components/require-session";
import type { Result } from "@/components/ui";
import { Button, Card, Code, Hint, ResultMessage, Select, toResult } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { recordDemoEvent } from "./actions";

type Listed = { events: AuditEvent[]; total: number };

const TYPES = [
  "all",
  "sign-in",
  "sign-up",
  "sign-out",
  "session-revoked",
  "password-changed",
  "email-changed",
  "user-deleted",
  "billing.plan-changed",
] as const;
const SCOPES = ["mine", "everyone (admins)"] as const;

export default function AuditLog() {
  const { data: session } = authClient.useSession();
  const [type, setType] = useState<string>("all");
  const [scope, setScope] = useState<string>("mine");
  const [listed, setListed] = useState<Listed | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    const response = await authClient.auditLog.listEvents({
      query: {
        limit: 50,
        ...(type === "all" ? {} : { type }),
        // Admins see everyone's events without a userId; others only their own.
        ...(scope === "mine" ? { userId: session.user.id } : {}),
      },
    });
    setListed(response.data ?? null);
    setResult(response.error ? toResult(response, "") : null);
  }, [session, type, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  async function record() {
    await recordDemoEvent();
    setResult({ ok: true, message: "Recorded billing.plan-changed." });
    void load();
  }

  return (
    <RequireSession>
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <p className="text-sm text-muted-foreground">
        Sign-ins (try a wrong password too), sign-ups, password and email changes, and admin actions
        are recorded automatically. Each event is also logged in the server output by{" "}
        <Code>onEvent</Code>.
      </p>

      <Card
        title="Record an event of your own"
        description={
          <>
            Server code records app events with <Code>auth.api.recordAuditEvent</Code>; it has no
            HTTP route, so clients can&apos;t write to the log.
          </>
        }
      >
        <Button type="button" variant="secondary" onClick={record}>
          Upgrade to pro
        </Button>
        <ResultMessage result={result} />
      </Card>

      <Card title={`Events${listed ? ` (${listed.total})` : ""}`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Type"
            options={TYPES}
            value={type}
            onChange={(event) => setType(event.target.value)}
          />
          <Select
            label="Whose"
            options={SCOPES}
            value={scope}
            onChange={(event) => setScope(event.target.value)}
          />
        </div>
        <Hint>
          &ldquo;Everyone&rdquo; needs the <Code>admin</Code> role: use &ldquo;Make me admin&rdquo;
          on the Blocklist rules page.
        </Hint>
        {listed && listed.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events.</p>
        ) : null}
        <ul className="divide-y divide-border">
          {listed?.events.map((event) => (
            <li key={event.id} className="space-y-1 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <Code>{event.type}</Code>
                <span className={event.status === "failure" ? "text-danger" : ""}>
                  {event.status}
                  {event.errorCode ? ` · ${event.errorCode}` : ""}
                </span>
                <span className="text-muted-foreground">{event.severity}</span>
                <span className="ml-auto text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                user {event.userId ?? "-"} · actor {event.actorUserId ?? "-"} ·{" "}
                {event.ipAddress ?? "no IP"}
                {event.metadata ? ` · ${JSON.stringify(event.metadata)}` : ""}
              </div>
            </li>
          ))}
        </ul>
        <Button type="button" variant="secondary" onClick={load}>
          Refresh
        </Button>
      </Card>
    </RequireSession>
  );
}
