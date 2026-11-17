"use client";

import type { SecurityAlertsKnownDevice } from "@checodo/better-auth-security-alerts";
import { useCallback, useEffect, useState } from "react";
import { RequireSession } from "@/components/require-session";
import type { Result } from "@/components/ui";
import { Button, Card, Code, Hint, ResultMessage, toResult } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export default function SecurityAlerts() {
  const { data: session } = authClient.useSession();
  const [devices, setDevices] = useState<SecurityAlertsKnownDevice[] | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    const { data } = await authClient.securityAlerts.listDevices();
    setDevices(data ?? []);
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  async function forget(device: SecurityAlertsKnownDevice) {
    const response = await authClient.securityAlerts.forgetDevice({ id: device.id });
    setResult(toResult(response, `Forgot ${device.label}: the next sign-in from it alerts`));
    await load();
  }

  return (
    <RequireSession>
      <h1 className="text-2xl font-semibold">Security alerts</h1>
      <Card
        title="How to try it"
        description={
          <>
            The alerts are logged in the terminal as <Code>[security-alerts]</Code>. Sign in from
            another browser to get a <Code>new-device</Code> alert, then open its link: it leads to{" "}
            <Code>/secure-account</Code>. Changing the password or email on the Account page, or an
            admin action, alerts too.
          </>
        }
      >
        <Hint>The first sign-in of a user never alerts: it is the first device.</Hint>
      </Card>
      <Card title="Your devices" description="Sign-ins from any other device alert.">
        {devices === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No devices yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3">
                <span className="font-medium">{device.label}</span>
                {device.current && <Code>this device</Code>}
                <span className="text-muted-foreground">
                  last seen {new Date(device.lastSeenAt).toLocaleString()}
                </span>
                <Button variant="secondary" onClick={() => forget(device)}>
                  Forget
                </Button>
              </li>
            ))}
          </ul>
        )}
        <ResultMessage result={result} />
      </Card>
    </RequireSession>
  );
}
