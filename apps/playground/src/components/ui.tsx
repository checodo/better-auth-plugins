"use client";

import type { ComponentProps, ReactNode } from "react";

export function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-medium">{title}</h2>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

export function Input({ label, ...props }: ComponentProps<"input"> & { label: string }) {
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        {...props}
        className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-ring"
      />
    </label>
  );
}

export function Select({
  label,
  options,
  ...props
}: ComponentProps<"select"> & { label: string; options: readonly string[] }) {
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        {...props}
        className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 outline-none focus:border-ring"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

export function Button({
  variant = "primary",
  ...props
}: ComponentProps<"button"> & {
  variant?: "primary" | "secondary";
}) {
  const style =
    variant === "primary"
      ? "bg-primary text-primary-foreground"
      : "border border-border bg-background";
  return (
    <button
      type="submit"
      {...props}
      className={`rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${style} ${props.className ?? ""}`}
    />
  );
}

export type Result = { ok: true; message: string } | { ok: false; code?: string; message: string };

/** Shows the outcome of the last action, with better-auth's error code. */
export function ResultMessage({ result }: { result: Result | null }) {
  if (!result) return null;
  return (
    <p className={`text-sm ${result.ok ? "text-success" : "text-danger"}`} role="status">
      {result.ok ? "✓ " : "✗ "}
      {result.message}
      {!result.ok && result.code ? (
        <code className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{result.code}</code>
      ) : null}
    </p>
  );
}

/** Turns a better-auth client response into a `Result`. */
export function toResult(
  response: {
    error: {
      code?: string | undefined;
      message?: string | undefined;
      status?: number | undefined;
      statusText?: string | undefined;
    } | null;
  },
  success: string,
): Result {
  if (response.error) {
    const { code, message, status, statusText } = response.error;
    // Server errors often come without a message: show the HTTP status instead.
    const fallback = status ? `Request failed: ${status} ${statusText ?? ""}`.trim() : "Failed";
    return { ok: false, code, message: message || fallback };
  }
  return { ok: true, message: success };
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 font-mono text-xs">{children}</code>;
}
