"use client";

import type { WaitlistAdminEntry, WaitlistEntryStatus } from "@checodo/better-auth-waitlist";
import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import type { Result } from "@/components/ui";
import { Button, Card, Code, Hint, Input, ResultMessage, Select, toResult } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { makeMeAdmin } from "../admin/actions";

const STATUSES = ["all", "unconfirmed", "pending", "approved", "rejected", "registered"] as const;

type Status = {
  email: string;
  status: WaitlistEntryStatus;
  position: number | null;
  inviteExpiresAt: Date | string | null;
};

function formValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
}

export default function Waitlist() {
  const { data: session, refetch: refetchSession } = authClient.useSession();
  const isAdmin = session?.user.role?.split(",").includes("admin") ?? false;

  const [joinResult, setJoinResult] = useState<Result | null>(null);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [entryResult, setEntryResult] = useState<Result | null>(null);
  const [invite, setInvite] = useState("");
  const [inviteResult, setInviteResult] = useState<Result | null>(null);

  const showStatus = useCallback(async (value: string) => {
    const response = await authClient.waitlist.getStatus({ query: { token: value } });
    setStatus(response.data ?? null);
    setEntryResult(response.error ? toResult(response, "") : null);
  }, []);

  // The links the playground logs (src/lib/auth-options.ts) point here:
  // ?confirm=<token> confirms the email, ?invite=<code>&token=<token> is an invite.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const confirm = params.get("confirm");
    const linkToken = confirm ?? params.get("token");
    const code = params.get("invite");
    if (code) setInvite(code);
    if (!linkToken) return;
    setToken(linkToken);
    void (async () => {
      if (confirm) {
        const response = await authClient.waitlist.confirm({ token: confirm });
        if (response.error) {
          setEntryResult(toResult(response, ""));
          return;
        }
      }
      await showStatus(linkToken);
      if (confirm) setEntryResult({ ok: true, message: "Email confirmed." });
    })();
  }, [showStatus]);

  async function join(event: FormEvent<HTMLFormElement>) {
    const { email = "", source } = formValues(event);
    const response = await authClient.waitlist.join({
      email,
      ...(source ? { metadata: { source } } : {}),
    });
    setJoinResult(
      toResult(
        response,
        "Done. The answer is the same for every email; new ones get a confirmation link (see the server log).",
      ),
    );
  }

  async function lookUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await showStatus(token);
  }

  async function leave() {
    const response = await authClient.waitlist.leave({ token });
    setEntryResult(toResult(response, "Left the waitlist. The entry is deleted."));
    if (!response.error) setStatus(null);
  }

  async function checkInvite(event: FormEvent<HTMLFormElement>) {
    const { code = "" } = formValues(event);
    const response = await authClient.waitlist.checkInvite({ query: { code } });
    setInviteResult(
      response.data && !response.data.valid
        ? { ok: false, message: "This invite code is invalid, used, or expired." }
        : toResult(response, "Valid invite. Sign up with the invited email on the home page."),
    );
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Waitlist</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign-up is gated: only approved emails can create an account, whatever the sign-in method.
          Addresses on <Code>acme.test</Code> skip the waitlist (the <Code>allow</Code> option in{" "}
          <Code>src/lib/auth-options.ts</Code>), so the other demos keep working. Emails aren&apos;t
          sent: the playground logs the links in its server output.
        </p>
      </div>

      <Card
        title="Join"
        description={
          <>
            New entries stay <Code>unconfirmed</Code> until the confirmation link is opened (double
            opt-in). Signing up with the address fails with <Code>EMAIL_NOT_APPROVED</Code> until an
            admin approves it below.
          </>
        }
      >
        <form onSubmit={join} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Email" name="email" type="email" required placeholder="ada@example.com" />
            <Input label="Source (optional, stored as metadata)" name="source" />
          </div>
          <Button>Join the waitlist</Button>
          <ResultMessage result={joinResult} />
        </form>
      </Card>

      <Card
        title="Your entry"
        description="Status, position, and leaving, with the token from any of the logged links."
      >
        <form onSubmit={lookUp} className="space-y-3">
          <Input
            label="Token"
            name="token"
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <div className="flex gap-2">
            <Button>Show status</Button>
            <Button type="button" variant="secondary" onClick={leave} disabled={!token}>
              Leave the waitlist
            </Button>
          </div>
        </form>
        <ResultMessage result={entryResult} />
        {status ? (
          <p className="text-sm">
            <Code>{status.email}</Code> is <strong>{status.status}</strong>
            {status.position ? `, #${status.position} in line` : ""}
            {status.inviteExpiresAt
              ? `, invite valid until ${new Date(status.inviteExpiresAt).toLocaleString()}`
              : ""}
            .
          </p>
        ) : null}
      </Card>

      <Card
        title="Check an invite"
        description="Approving an entry logs its invite link in the playground's server output."
      >
        <form onSubmit={checkInvite} className="space-y-3">
          <Input
            label="Invite code"
            name="code"
            required
            value={invite}
            onChange={(event) => setInvite(event.target.value)}
          />
          <Button>Check</Button>
          <ResultMessage result={inviteResult} />
        </form>
      </Card>

      {session && !isAdmin ? (
        <Card
          title="Manage the waitlist"
          description="The admin endpoints answer 403 for everyone else. This button exists only in the playground."
        >
          <Button
            type="button"
            onClick={async () => {
              await makeMeAdmin();
              await refetchSession();
            }}
          >
            Make me admin
          </Button>
        </Card>
      ) : null}

      {isAdmin ? <AdminPanel /> : null}
    </>
  );
}

function AdminPanel() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [entries, setEntries] = useState<WaitlistAdminEntry[]>([]);
  const [stats, setStats] = useState<Record<WaitlistEntryStatus | "total", number> | null>(null);
  const [listResult, setListResult] = useState<Result | null>(null);
  const [actionResult, setActionResult] = useState<Result | null>(null);

  const load = useCallback(async () => {
    const [list, counts] = await Promise.all([
      authClient.waitlist.listEntries({
        query: { limit: 100, ...(status === "all" ? {} : { status }) },
      }),
      authClient.waitlist.getStats(),
    ]);
    setListResult(list.error ? toResult(list, "") : null);
    setEntries(list.data?.entries ?? []);
    setStats(counts.data ?? null);
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(
    action: Promise<{ error: Parameters<typeof toResult>[0]["error"] }>,
    success: string,
  ) {
    setActionResult(toResult(await action, success));
    void load();
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    const { email = "" } = formValues(event);
    await run(authClient.waitlist.createInvite({ email }), `Invited ${email}. See the server log.`);
  }

  return (
    <>
      <Card
        title="Invite directly"
        description="Adds the email if needed, approves it, and sends the invite (logged here)."
      >
        <form onSubmit={invite} className="flex items-end gap-3">
          <div className="flex-1">
            <Input label="Email" name="email" type="email" required />
          </div>
          <Button>Invite</Button>
        </form>
      </Card>

      <Card
        title={`Entries${stats ? ` (${stats.total})` : ""}`}
        description={
          stats
            ? `${stats.unconfirmed} unconfirmed · ${stats.pending} pending · ${stats.approved} approved · ${stats.rejected} rejected · ${stats.registered} registered`
            : undefined
        }
      >
        <div className="flex items-end gap-3">
          <div className="w-48">
            <Select
              label="Status"
              name="status"
              options={STATUSES}
              value={status}
              onChange={(event) => setStatus(event.target.value as (typeof STATUSES)[number])}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              run(authClient.waitlist.approveEntries({ count: 10 }), "Approved the next 10.")
            }
          >
            Approve next 10 pending
          </Button>
        </div>
        <ResultMessage result={listResult ?? actionResult} />
        {entries.length === 0 && !listResult ? (
          <p className="text-sm text-muted-foreground">No entries.</p>
        ) : null}
        <ul className="divide-y divide-border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Code>{entry.email}</Code>
              <span className="text-muted-foreground">{entry.status}</span>
              <span className="ml-auto flex gap-2">
                {entry.status !== "registered" && entry.status !== "unconfirmed" ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        run(
                          authClient.waitlist.approveEntries({ ids: [entry.id] }),
                          `Approved ${entry.email}. The invite link is in the server log.`,
                        )
                      }
                    >
                      {entry.status === "approved" ? "Renew invite" : "Approve"}
                    </Button>
                    {entry.status !== "rejected" ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                          run(
                            authClient.waitlist.rejectEntry({ id: entry.id }),
                            `Rejected ${entry.email}.`,
                          )
                        }
                      >
                        Reject
                      </Button>
                    ) : null}
                  </>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    run(
                      authClient.waitlist.deleteEntry({ id: entry.id }),
                      `Deleted ${entry.email}.`,
                    )
                  }
                >
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <Hint>
          Approved entries get an invite that expires after 7 days. Signing up marks them{" "}
          <Code>registered</Code>.
        </Hint>
      </Card>
    </>
  );
}
