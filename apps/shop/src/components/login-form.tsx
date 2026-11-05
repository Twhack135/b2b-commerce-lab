"use client";

import { useRef, useState } from "react";
import { LOGIN_MESSAGES, type LoginMessage } from "@/lib/login-messages";
import { loginResult } from "@/lib/login-result";
import { inputClass, Notice, primaryButtonClass } from "./auth-panel";

/**
 * The sign-in form. Without JavaScript it is a plain form POST to
 * /api/auth/login. With JavaScript the same request is sent with fetch, so
 * after a failed attempt the e-mail address stays in the field and only the
 * password is cleared; the address is never put into the URL, a cookie or
 * browser storage. The server route and its checks are the same either way.
 *
 * The fields are uncontrolled on purpose: what a person types before the
 * page is hydrated stays in the fields. Controlled fields were reset to
 * their empty state by the hydration, and the sign-in then did nothing.
 */
export function LoginForm({ initialMessage }: { initialMessage: string | null }) {
  const [message, setMessage] = useState<LoginMessage | undefined>(initialMessage ? LOGIN_MESSAGES[initialMessage] : undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    const form = new FormData(event.currentTarget);
    setIsSubmitting(true);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      body: new URLSearchParams({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") }),
    }).catch(() => null);
    const result = loginResult(response?.url ?? null, window.location.origin);
    if (result.kind === "signed-in") {
      // A full page load after signing in: the header (shared layout), the
      // client router cache and every page see the new session
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/account");
      return;
    }
    // As after the plain form: the reason in the address (never the e-mail)
    window.history.replaceState(window.history.state, "", `/login?error=${result.reason}`);
    setMessage(LOGIN_MESSAGES[result.reason]);
    if (passwordRef.current) passwordRef.current.value = "";
    setIsSubmitting(false);
    passwordRef.current?.focus();
  }

  return (
    <form action="/api/auth/login" method="post" onSubmit={submit} data-login-form className="space-y-5">
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
          E-mail address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="username"
          autoFocus
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
          Password
        </label>
        <input
          ref={passwordRef}
          id="password"
          name="password"
          type="password"
          required
          maxLength={1024}
          autoComplete="current-password"
          className={inputClass}
        />
      </div>
      <button type="submit" disabled={isSubmitting} aria-busy={isSubmitting || undefined} className={primaryButtonClass}>
        {isSubmitting ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-sm text-ink-muted">
        No access yet or forgot your password? Please contact your account manager.
      </p>
    </form>
  );
}
