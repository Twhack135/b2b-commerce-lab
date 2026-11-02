"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { inputClass, Notice, primaryButtonClass } from "./auth-panel";

const MIN_LENGTH = 15;

// The token is in the fragment of the activation link (#token=...): a
// fragment is never sent to a server and never appears in a Referer header.
// It is read once and then removed from the address bar and the history.
let captured: string | null | undefined;
function tokenFromLink(): string | null {
  if (captured === undefined) {
    const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
    captured = match ? match[1] : null;
  }
  return captured;
}
const noSubscription = () => () => {};

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "activated" }
  | { kind: "error"; messages: string[]; linkInvalid?: boolean };

/** Choose the first password with the one-time activation link */
export function ActivationForm() {
  const token = useSyncExternalStore(noSubscription, tokenFromLink, () => undefined);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (token === undefined) return <div className="h-72" aria-busy="true" />;
  if (status.kind === "activated") {
    return (
      <div className="space-y-5" data-activation="done">
        <Notice kind="success">Your password is set. You can now sign in.</Notice>
        <Link href="/login?activated=1" className={primaryButtonClass}>
          Continue to sign in
        </Link>
      </div>
    );
  }
  if (token === null || (status.kind === "error" && status.linkInvalid)) {
    return (
      <div data-activation="invalid">
        <Notice kind="error">
          This activation link is invalid or has expired. Each link works once and for 24 hours.
          Please ask your account manager for a new link.
        </Notice>
      </div>
    );
  }

  const tooShort = Array.from(password.normalize("NFKC")).length < MIN_LENGTH;
  const mismatch = confirmation !== "" && confirmation !== password;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tooShort || confirmation !== password) return;
    setStatus({ kind: "submitting" });
    const response = await fetch("/api/auth/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { status?: string; messages?: string[] } | null;
    if (body?.status === "activated") {
      setStatus({ kind: "activated" });
      setPassword("");
      setConfirmation("");
    } else if (body?.status === "password") {
      setStatus({ kind: "error", messages: body.messages ?? [] });
    } else if (body?.status === "invalid") {
      setStatus({ kind: "error", messages: [], linkInvalid: true });
    } else if (body?.status === "locked") {
      setStatus({ kind: "error", messages: ["Too many attempts. Please wait a few minutes and try again."] });
    } else {
      setStatus({ kind: "error", messages: ["The activation is not available at the moment. Please try again later."] });
    }
  }

  return (
    <form onSubmit={submit} data-activation-form className="space-y-5" noValidate>
      {status.kind === "error" && status.messages.length > 0 && (
        <Notice kind="error">
          {status.messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </Notice>
      )}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="new-password" className="text-sm font-medium">
            New password
          </label>
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-controls="new-password confirm-password"
            className="text-sm font-medium text-brand hover:underline"
          >
            {visible ? "Hide" : "Show"}
          </button>
        </div>
        <input
          id="new-password"
          type={visible ? "text" : "password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          maxLength={1024}
          aria-describedby="password-rules"
          aria-invalid={password !== "" && tooShort ? true : undefined}
          className={inputClass}
        />
        <p id="password-rules" className="mt-1.5 text-sm text-ink-muted">
          At least {MIN_LENGTH} characters. A sentence of several words is easy to remember and hard to
          guess.
        </p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium">
          Repeat password
        </label>
        <input
          id="confirm-password"
          type={visible ? "text" : "password"}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="new-password"
          maxLength={1024}
          aria-invalid={mismatch ? true : undefined}
          aria-describedby={mismatch ? "confirm-error" : undefined}
          className={inputClass}
        />
        {mismatch && (
          <p id="confirm-error" className="mt-1.5 text-sm text-danger">
            The passwords do not match.
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={status.kind === "submitting" || tooShort || confirmation !== password}
        className={primaryButtonClass}
      >
        {status.kind === "submitting" ? "Setting password…" : "Set password"}
      </button>
    </form>
  );
}
