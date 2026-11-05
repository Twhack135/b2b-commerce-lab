import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthPanel } from "@/components/auth-panel";
import { LoginForm } from "@/components/login-form";
import { LOGIN_MESSAGES } from "@/lib/login-messages";
import { signedInSession } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * Sign-in. The form posts to the shop's own route handler, also without
 * JavaScript (components/login-form.tsx). There is no self-registration:
 * access is set up by the supplier and activated with a one-time link.
 */
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthPanel
      title="Sign in"
      intro="Sign in with the e-mail address your company registered for the shop."
    >
      <Suspense fallback={<div className="h-72" aria-busy="true" />}>
        <SignIn searchParams={searchParams} />
      </Suspense>
    </AuthPanel>
  );
}

async function SignIn({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  if (await signedInSession()) redirect("/account");
  const params = await searchParams;
  const key = typeof params.error === "string" ? params.error : params.signedOut ? "signedOut" : params.activated ? "activated" : null;
  return <LoginForm initialMessage={key && Object.hasOwn(LOGIN_MESSAGES, key) ? key : null} />;
}
