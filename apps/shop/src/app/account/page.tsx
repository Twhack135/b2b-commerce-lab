import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Notice } from "@/components/auth-panel";
import type { ShopUnit } from "@/lib/server/erp-shop-api";
import { signedInSession } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "My account",
};

const UNIT_MESSAGES: Record<string, { kind: "success" | "error"; text: string }> = {
  selected: { kind: "success", text: "You are now working for the selected unit." },
  unavailable: { kind: "error", text: "This unit is not available to you. Please choose one of your units." },
};

/** The signed-in state: who is signed in, for which company, and the unit to work for */
export default function AccountPage({ searchParams }: PageProps<"/account">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl border border-line bg-surface" aria-busy="true" />}>
      <Account searchParams={searchParams} />
    </Suspense>
  );
}

async function Account({ searchParams }: Pick<PageProps<"/account">, "searchParams">) {
  const session = await signedInSession();
  if (!session) redirect("/login");
  const { user, units, selectedUnit, requestedUnitRejected } = session;
  const params = await searchParams;
  const message = typeof params.unit === "string" ? UNIT_MESSAGES[params.unit] : undefined;

  return (
    <div className="space-y-6" data-account={user.account.customerNumber}>
      <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="relative bg-shell px-6 py-8 text-white sm:px-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_100%_0%,rgba(11,107,203,0.45),transparent_60%)]"
          />
          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium tracking-[0.2em] text-white/60 uppercase">My account</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl" data-display-name>
                Welcome, {user.displayName}
              </h1>
              <p className="mt-1 text-white/75">{user.account.name}</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur" data-working-for>
              <p className="text-xs tracking-wide text-white/60 uppercase">Working for</p>
              <p className="mt-0.5 font-medium">{selectedUnit ? selectedUnit.name : "No unit selected"}</p>
            </div>
          </div>
        </div>
        <dl className="grid gap-x-8 gap-y-4 px-6 py-6 text-sm sm:grid-cols-3 sm:px-8">
          <div>
            <dt className="text-ink-muted">Signed in as</dt>
            <dd className="mt-1 font-medium break-all" data-signed-in-email>
              {user.email}
            </dd>
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

      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {requestedUnitRejected && !message && (
        <Notice kind="info">The unit you worked for before is no longer available to you.</Notice>
      )}
      {selectedUnit && !selectedUnit.canOrder && (
        <div role="note" data-view-only-notice className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <p className="font-semibold">{selectedUnit.name} is view only</p>
          <p className="mt-0.5">This unit is inactive. You can see its data, but no new orders can be placed for it.</p>
        </div>
      )}

      <section aria-labelledby="units-title" className="rounded-2xl border border-line bg-surface px-6 py-6 shadow-sm sm:px-8" id="units">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="units-title" className="text-base font-semibold">
            Your ordering units
          </h2>
          {units.length > 1 && <p className="text-sm text-ink-muted">Choose the unit you want to work for.</p>}
        </div>
        {units.length === 0 ? (
          <p className="mt-2 text-ink-muted" data-units="none">
            No ordering unit has been assigned to you yet. Please contact your account manager.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2" data-units={units.length}>
            {units.map((unit) => (
              <UnitCard key={unit.unitId} unit={unit} isSelected={unit.unitId === selectedUnit?.unitId} />
            ))}
          </ul>
        )}
        <p className="mt-6 text-sm text-ink-muted">
          Catalog, prices and ordering follow in the next releases. For your security you are signed out after 30
          minutes without activity.
        </p>
      </section>
    </div>
  );
}

function UnitCard({ unit, isSelected }: { unit: ShopUnit; isSelected: boolean }) {
  return (
    <li
      data-unit={unit.unitId}
      data-selected={isSelected ? "true" : undefined}
      data-can-order={unit.canOrder ? "true" : "false"}
      className={`flex flex-col justify-between gap-3 rounded-xl border px-4 py-4 transition-shadow ${
        isSelected ? "border-brand bg-brand-soft/40 shadow-[0_0_0_1px_var(--color-brand)]" : "border-line"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{unit.name}</p>
          <p className="font-mono text-xs text-ink-muted">{unit.unitId}</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            unit.canOrder ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
          }`}
        >
          <span aria-hidden="true" className={`size-1.5 rounded-full ${unit.canOrder ? "bg-success" : "bg-warning"}`} />
          {unit.canOrder ? "Ordering possible" : "View only"}
        </span>
      </div>
      {isSelected ? (
        <p className="text-sm font-medium text-brand-strong">
          <span aria-hidden="true">✓ </span>Selected
        </p>
      ) : (
        <form action="/api/units/select" method="post" data-unit-select={unit.unitId}>
          <input type="hidden" name="unitId" value={unit.unitId} />
          <button type="submit" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-brand hover:text-brand-strong">
            Work for this unit<span className="sr-only"> {unit.name}</span>
          </button>
        </form>
      )}
    </li>
  );
}
