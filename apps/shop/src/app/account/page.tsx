import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { signedInSession } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "My account",
};

/** The signed-in state: who is signed in, for which company and units */
export default function AccountPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl border border-line bg-surface" aria-busy="true" />}>
      <Account />
    </Suspense>
  );
}

async function Account() {
  const session = await signedInSession();
  if (!session) redirect("/login");
  const { user, units } = session;

  return (
    <div className="space-y-6" data-account={user.account.customerNumber}>
      <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="bg-shell px-6 py-8 text-white sm:px-8">
          <p className="text-xs font-medium tracking-[0.2em] text-white/60 uppercase">My account</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl" data-display-name>
            Welcome, {user.displayName}
          </h1>
          <p className="mt-1 text-white/75">{user.account.name}</p>
        </div>
        <dl className="grid gap-x-8 gap-y-4 px-6 py-6 text-sm sm:grid-cols-3 sm:px-8">
          <div>
            <dt className="text-ink-muted">Signed in as</dt>
            <dd className="mt-1 font-medium break-all" data-signed-in-email>{user.email}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Customer number</dt>
            <dd className="mt-1 font-mono">{user.account.customerNumber}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Role</dt>
            <dd className="mt-1">Buyer</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="units-title" className="rounded-2xl border border-line bg-surface px-6 py-6 shadow-sm sm:px-8">
        <h2 id="units-title" className="font-semibold">
          Your ordering units
        </h2>
        {units.length === 0 ? (
          <p className="mt-2 text-ink-muted" data-units="none">
            No ordering unit has been assigned to you yet. Please contact your account manager.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2" data-units={units.length}>
            {units.map((unit) => (
              <li key={unit.unitId} data-unit={unit.unitId} className="rounded-xl border border-line px-4 py-3">
                <p className="font-medium">{unit.name}</p>
                <p className="mt-0.5 flex items-center justify-between gap-2 text-sm text-ink-muted">
                  <span className="font-mono">{unit.unitId}</span>
                  <span className={unit.canOrder ? "text-success" : "text-warning"}>
                    {unit.canOrder ? "Ordering possible" : "View only"}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-sm text-ink-muted">
          Catalog, prices and ordering follow in the next releases. For your security you are signed
          out after 30 minutes without activity.
        </p>
      </section>
    </div>
  );
}
