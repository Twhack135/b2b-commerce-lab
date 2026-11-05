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
 */
export function LoginForm({ initialMessage }: { initialMessage: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<LoginMessage | undefined>(initialMessage ? LOGIN_MESSAGES[initialMessage] : undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      body: new URLSearchParams({ email, password }),
    }).catch(() => null);
    const result = loginResult(response?.url ?? null, window.location.origin);
    if (result.kind === "signed-in") {
      // A full page load after signing in: the header (shared layout), the
      // client router cache and every page see the new session. A client
      // navigation plus refresh raced in tests and could stay on /login.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/account");
      return;
    }
    // As after the plain form: the reason in the address (never the e-mail)
    window.history.replaceState(window.history.state, "", `/login?error=${result.reason}`);
    setMessage(LOGIN_MESSAGES[result.reason]);
    setPassword("");
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
          value={email}
          onChange={(event) => setEmail(event.target.value)}
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
          value={password}
          onChange={(event) => setPassword(event.target.value)}
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
