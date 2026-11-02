import Link from "next/link";
import { signedInSession } from "@/lib/server/session";

/** Header: "Sign in", or the signed-in person with "Sign out" */
export async function AccountMenu() {
  const session = await signedInSession();
  if (!session) {
    return (
      <Link
        href="/login"
        data-sign-in-link
        className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        Sign in
      </Link>
    );
  }
  return (
    <div data-account-menu className="flex items-center gap-2">
      <Link href="/account" className="hidden text-right leading-tight sm:block">
        <span className="block font-medium">{session.user.displayName}</span>
        <span className="block text-xs text-ink-muted">{session.user.account.name}</span>
      </Link>
      <span
        aria-hidden="true"
        className="grid size-9 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand-strong"
      >
        {initials(session.user.displayName)}
      </span>
      <form action="/api/auth/logout" method="post">
        <button
          type="submit"
          data-sign-out
          className="rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-canvas"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase());
  return letters.join("") || "?";
}
