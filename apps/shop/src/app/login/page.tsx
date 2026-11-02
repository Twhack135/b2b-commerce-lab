import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthPanel, inputClass, Notice, primaryButtonClass } from "@/components/auth-panel";
import { signedInSession } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "Sign in",
};

const MESSAGES: Record<string, { kind: "error" | "success" | "info"; text: string }> = {
  invalid: { kind: "error", text: "Invalid e-mail address or password." },
  locked: { kind: "error", text: "Too many attempts. Please wait a few minutes and try again." },
  unavailable: { kind: "error", text: "Sign-in is not available at the moment. Please try again later." },
  signedOut: { kind: "info", text: "You have been signed out." },
  activated: { kind: "success", text: "Your access is ready. Sign in with your new password." },
};

/**
 * Sign-in. The form posts to the shop's own route handler (works without
 * JavaScript); there is no self-registration: access is set up by the
 * supplier and activated with a one-time link.
 */
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthPanel
      title="Sign in"
      intro="Sign in with the e-mail address your company registered for the shop."
    >
      <Suspense fallback={<div className="h-72" aria-busy="true" />}>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </AuthPanel>
  );
}

async function LoginForm({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  if (await signedInSession()) redirect("/account");
  const params = await searchParams;
  const key = typeof params.error === "string" ? params.error : params.signedOut ? "signedOut" : params.activated ? "activated" : null;
  const message = key ? MESSAGES[key] : undefined;

  return (
    <form action="/api/auth/login" method="post" data-login-form className="space-y-5">
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
          id="password"
          name="password"
          type="password"
          required
          maxLength={1024}
          autoComplete="current-password"
          className={inputClass}
        />
      </div>
      <button type="submit" className={primaryButtonClass}>
        Sign in
      </button>
      <p className="text-sm text-ink-muted">
        No access yet or forgot your password? Please contact your account manager.
      </p>
    </form>
  );
}
