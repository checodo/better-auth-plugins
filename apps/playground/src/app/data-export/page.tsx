"use client";

import type { DataExport } from "@checodo/better-auth-data-export/client";
import { useState } from "react";
import { RequireSession } from "@/components/require-session";
import type { Result } from "@/components/ui";
import { Button, Card, Code, Hint, ResultMessage, toResult } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export default function DataExportPage() {
  const [file, setFile] = useState<DataExport | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function preview() {
    const response = await authClient.dataExport.download();
    setFile(response.data ?? null);
    setResult(response.error ? toResult(response, "") : null);
  }

  return (
    <RequireSession>
      <h1 className="text-2xl font-semibold">Data export</h1>
      <p className="text-sm text-muted-foreground">
        Everything stored about you, as one JSON file (GDPR Art. 15 and 20). Needs a sign-in within
        the last day, and 3 downloads an hour.
      </p>

      <Card title="Your data">
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/auth/data-export/download"
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Download my data
          </a>
          <Button type="button" variant="secondary" onClick={preview}>
            Show it here
          </Button>
        </div>
        <ResultMessage result={result} />
        <Hint>
          Signed in more than a day ago? The download answers <Code>SESSION_NOT_FRESH</Code>: sign
          out and in again.
        </Hint>
      </Card>

      {file ? (
        <Card
          title="Models"
          description={`${Object.keys(file.data).length} models, exported ${file.exportedAt}`}
        >
          <ul className="divide-y divide-border text-sm">
            {Object.entries(file.data).map(([model, rows]) => (
              <li key={model} className="flex justify-between gap-2 py-2">
                <Code>{model}</Code>
                <span>
                  {rows.length} rows
                  {file.omitted[model] ? `, without ${file.omitted[model].join(", ")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </RequireSession>
  );
}
