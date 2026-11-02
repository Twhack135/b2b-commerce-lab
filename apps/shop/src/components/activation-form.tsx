"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { parseActivationFragment, submitBlocker, MIN_PASSWORD_LENGTH, type LinkFragment } from "@/lib/activation-link";
import { inputClass, Notice, primaryButtonClass } from "./auth-panel";

// The token is in the fragment of the activation link (#token=...): a
// fragment is never sent to a server and never appears in a Referer header.
// The page reads it and removes it from the address bar and the history at
// once; it is kept only in the state of this component, never stored.
//
// Rendered in the browser only (activation-form-loader.tsx): the fragment
// does not exist on the server.

/** Choose the first password with the one-time activation link */
export function ActivationForm() {
  const [link, setLink] = useState<LinkFragment>(() => parseActivationFragment(window.location.hash));

  // Every link that reaches the address bar is removed from it at once
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, [link]);

  // Opening the link again in this tab only changes the fragment: the page
  // is not reloaded, so the new link is read here
  useEffect(() => {
    function onHashChange() {
      if (window.location.hash) setLink(parseActivationFragment(window.location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (link.kind === "missing") {
    return (
      <div data-activation="missing">
        <Notice kind="info">
          <p className="font-medium">Please open the link from your invitation again.</p>
          <p className="mt-1">
            For your security, this page removes the code from the address bar as soon as it has read it, so
            reloading the page cannot continue. Your link still works if you have not set a password with it yet.
          </p>
        </Notice>
      </div>
    );
  }
  if (link.kind === "malformed") {
    return (
      <div data-activation="incomplete">
        <Notice kind="error">
          This activation link is incomplete. Please copy the complete link from your invitation and open it again.
        </Notice>
      </div>
    );
  }
  // A new link starts with an empty form
  return <PasswordForm key={link.token} token={link.token} />;
}

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "activated" }
  | { kind: "error"; messages: string[]; linkInvalid?: boolean };

function PasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

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
  if (status.kind === "error" && status.linkInvalid) {
    return (
      <div data-activation="invalid">
        <Notice kind="error">
          This activation link is invalid or has expired. Each link works once and for 24 hours.
          Please ask your account manager for a new link.
        </Notice>
      </div>
    );
  }

  const tooShort = Array.from(password.normalize("NFKC")).length < MIN_PASSWORD_LENGTH;
  const mismatch = confirmation !== "" && confirmation !== password;
  const blocker = submitBlocker(password, confirmation);
  const isSubmitting = status.kind === "submitting";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocker || isSubmitting) return;
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
          At least {MIN_PASSWORD_LENGTH} characters. A sentence of several words is easy to remember and hard to
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
      <div>
        <button
          type="submit"
          disabled={isSubmitting || blocker !== null}
          aria-busy={isSubmitting || undefined}
          aria-describedby={blocker && !mismatch ? "submit-hint" : undefined}
          className={primaryButtonClass}
        >
          {isSubmitting ? "Setting password…" : "Set password"}
        </button>
        {/* Says why the button cannot be used yet (the mismatch is shown at its field) */}
        <p id="submit-hint" data-submit-hint aria-live="polite" className="mt-2 min-h-5 text-sm text-ink-muted">
          {blocker && !mismatch ? blocker : ""}
        </p>
      </div>
    </form>
  );
}
