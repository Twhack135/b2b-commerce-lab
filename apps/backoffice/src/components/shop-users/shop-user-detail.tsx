"use client";

import { useEffect, useRef, useState } from "react";
import type { B2bUnit } from "@/lib/b2b-units";
import { errorMessage } from "@/lib/erp-api";
import { salesAreaId } from "@/lib/sales-area-display";
import {
  ACCESS_LABELS,
  ACTIVATION_LABELS,
  activationBlocker,
  assignableUnits,
  formatTimestamp,
  UNIT_ACCESS_LABELS,
} from "@/lib/shop-user-display";
import {
  assignShopUserUnit,
  getShopUser,
  issueActivationLink,
  revokeAllShopUserSessions,
  revokeShopUserSession,
  unassignShopUserUnit,
  updateShopUser,
  type IssuedActivationLink,
  type ShopUserDetail,
  type ShopUserUnitAssignment,
} from "@/lib/shop-users";
import { ConfirmDialog } from "../forms/confirm-dialog";
import { FormErrorAlert, inputClass } from "../forms/form-controls";
import { SidePanel } from "../forms/side-panel";
import { LoadError, LoadingRows } from "../list-page";
import { ActivationLinkDialog } from "./activation-link-dialog";
import { ToneBadge } from "./badges";

type Confirmation =
  | { kind: "disable" }
  | { kind: "enable" }
  | { kind: "unassign"; unit: ShopUserUnitAssignment }
  | { kind: "activation" }
  | { kind: "revoke-all" };

/**
 * Everything about one shop user: access, units, activation and sessions.
 * Every change is sent to the ERP at once and the panel shows the ERP's
 * answer, so it always reflects what the shop checks.
 */
export function ShopUserDetailPanel({
  userId,
  units,
  onClose,
  onChanged,
}: {
  userId: string;
  /** All B2B units, for the units of the user's account; null while loading */
  units: B2bUnit[] | null;
  onClose: () => void;
  /** The list should be reloaded */
  onChanged: () => void;
}) {
  const [user, setUser] = useState<ShopUserDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [issuedLink, setIssuedLink] = useState<IssuedActivationLink | null>(null);
  const [unitToAssign, setUnitToAssign] = useState("");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    let isCurrent = true;
    getShopUser(userId).then(
      (loaded) => {
        if (!isCurrent) return;
        setUser(loaded);
        setDisplayName(loaded.displayName);
        setLoadError(null);
      },
      (error: unknown) => isCurrent && setLoadError(errorMessage(error)),
    );
    return () => {
      isCurrent = false;
    };
  }, [userId, reloadCount]);

  /** Runs one change; the ERP's answer replaces the shown user */
  async function run(label: string, action: () => Promise<ShopUserDetail | null>, success: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setActionError(null);
    setNotice(null);
    try {
      const updated = await action();
      if (updated) {
        setUser(updated);
        setDisplayName(updated.displayName);
      }
      setNotice(success);
      onChanged();
    } catch (error) {
      setActionError(errorMessage(error));
      // Show the current state after a refused change
      setReloadCount((count) => count + 1);
    } finally {
      busyRef.current = false;
      setBusy(null);
      setConfirmation(null);
    }
  }

  async function confirm() {
    if (!user || !confirmation) return;
    switch (confirmation.kind) {
      case "disable":
        return run("status", () => updateShopUser(user.id, { status: "DISABLED" }), "The user is disabled. All sessions have ended.");
      case "enable":
        return run("status", () => updateShopUser(user.id, { status: "ACTIVE" }), "The user is enabled again. Earlier sessions stay ended.");
      case "unassign": {
        const unit = confirmation.unit;
        return run("units", () => unassignShopUserUnit(user.id, unit.unitId), `${unit.unitId} was removed. It takes effect with the user's next request.`);
      }
      case "revoke-all":
        return run("sessions", () => revokeAllShopUserSessions(user.id), "All sessions have ended.");
      case "activation":
        return run(
          "activation",
          async () => {
            setIssuedLink(await issueActivationLink(user.id));
            return getShopUser(user.id);
          },
          "A new activation link was created. An earlier unused link no longer works.",
        );
    }
  }

  const isBusy = busy !== null;
  const accountUnits = user ? assignableUnits(units ?? [], user.account.customerNumber, user.units.map((u) => u.unitId)) : [];
  const nameChanged = user !== null && displayName.trim() !== user.displayName;

  return (
    // While the link is shown, Escape must not close the panel behind it
    <SidePanel title="Shop User" size="lg" isBusy={isBusy || issuedLink !== null} onClose={onClose}>
      {loadError && !user ? (
        <LoadError title="The shop user could not be loaded" message={loadError} isRetrying={false} onRetry={() => setReloadCount((c) => c + 1)} />
      ) : !user ? (
        <LoadingRows label="Loading the shop user" />
      ) : (
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5" data-shop-user-detail={user.email}>
          {/* Header */}
          <div className="flex items-start gap-4">
            <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-soft text-base font-semibold text-brand-strong">
              {initials(user.displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold">{user.displayName}</h3>
              <p className="break-all text-ink-muted">{user.email}</p>
              <p className="mt-1 text-xs text-ink-muted">
                Account <span className="font-mono">{user.account.customerNumber}</span> · {user.account.name} · Buyer
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span data-access={user.access}>
                  <ToneBadge {...ACCESS_LABELS[user.access]} />
                </span>
                <span data-activation={user.activation}>
                  <ToneBadge {...ACTIVATION_LABELS[user.activation]} />
                </span>
              </div>
            </div>
          </div>

          {actionError && <FormErrorAlert messages={[actionError]} />}
          {notice && (
            <p role="status" data-detail-notice className="rounded-md border border-success/30 bg-success-soft px-4 py-3 text-success">
              {notice}
            </p>
          )}

          {/* Access */}
          <Section title="Access" description={ACCESS_LABELS[user.access].hint}>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-4 py-3">
              <div>
                <p className="font-medium">{user.status === "ACTIVE" ? "User is enabled" : "User is disabled"}</p>
                <p className="text-xs text-ink-muted">
                  {user.status === "ACTIVE"
                    ? "Disabling ends all sessions at once and blocks sign-in. Units stay assigned."
                    : "Enabling allows signing in again with the existing password."}
                </p>
              </div>
              {user.status === "ACTIVE" ? (
                <button type="button" data-action="disable" disabled={isBusy} onClick={() => setConfirmation({ kind: "disable" })} className="rounded-md border border-danger/40 px-3 py-1.5 font-medium text-danger hover:bg-danger-soft disabled:opacity-50">
                  Disable user
                </button>
              ) : (
                <button type="button" data-action="enable" disabled={isBusy} onClick={() => setConfirmation({ kind: "enable" })} className="rounded-md border border-line px-3 py-1.5 font-medium hover:bg-canvas disabled:opacity-50">
                  Enable user
                </button>
              )}
            </div>
            {!user.account.isActive && (
              <p className="mt-2 text-xs text-danger">
                The customer account {user.account.customerNumber} is inactive. Reactivate it under Customers to give its users access again.
              </p>
            )}
          </Section>

          {/* Profile */}
          <Section title="Display name" description="Shown to the user in the shop.">
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!nameChanged) return;
                void run("name", () => updateShopUser(user.id, { displayName: displayName.trim() }), "The display name was saved.");
              }}
            >
              <label htmlFor="detail-display-name" className="sr-only">
                Display name
              </label>
              <input id="detail-display-name" value={displayName} maxLength={100} onChange={(event) => setDisplayName(event.target.value)} className={`${inputClass(undefined)} min-w-0 flex-1`} />
              <button type="submit" disabled={isBusy || !nameChanged || !displayName.trim()} className="rounded-md bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong disabled:opacity-50">
                {busy === "name" ? "Saving…" : "Save"}
              </button>
            </form>
          </Section>

          {/* Units */}
          <Section title="Authorized B2B units" description="The user sees and orders only for these units of their own account.">
            {user.units.length === 0 ? (
              <p className="rounded-md border border-dashed border-line px-4 py-3 text-ink-muted" data-no-units>
                No unit assigned: the user can sign in but cannot see any unit.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-md border border-line" data-assigned-units>
                {user.units.map((unit) => (
                  <li key={unit.unitId} data-assigned-unit={unit.unitId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{unit.name}</p>
                      <p className="font-mono text-xs text-ink-muted">
                        {unit.unitId} · {salesAreaId(unit.salesArea)}
                        {!unit.isActive && <span className="ml-1 font-sans font-medium text-warning">(unit inactive)</span>}
                      </p>
                    </div>
                    <ToneBadge {...UNIT_ACCESS_LABELS[unit.access]} />
                    <button type="button" disabled={isBusy} onClick={() => setConfirmation({ kind: "unassign", unit })} className="rounded-md px-2 py-1 font-medium text-danger hover:bg-danger-soft disabled:opacity-50">
                      Remove<span className="sr-only"> {unit.unitId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!unitToAssign) return;
                const unitId = unitToAssign;
                void run("units", () => assignShopUserUnit(user.id, unitId), `${unitId} was assigned.`).then(() => setUnitToAssign(""));
              }}
            >
              <label htmlFor="assign-unit" className="sr-only">
                Unit to assign
              </label>
              <select id="assign-unit" value={unitToAssign} onChange={(event) => setUnitToAssign(event.target.value)} disabled={accountUnits.length === 0} className={`${inputClass(undefined)} min-w-0 flex-1`}>
                <option value="">
                  {units === null ? "Loading units…" : accountUnits.length === 0 ? "No further active unit of this account" : "Select a unit of this account"}
                </option>
                {accountUnits.map((unit) => (
                  <option key={unit.unitId} value={unit.unitId}>
                    {unit.unitId} · {unit.name}
                  </option>
                ))}
              </select>
              <button type="submit" data-action="assign" disabled={isBusy || !unitToAssign} className="rounded-md border border-line bg-surface px-4 py-2 font-medium hover:bg-canvas disabled:opacity-50">
                {busy === "units" ? "Saving…" : "Assign"}
              </button>
            </form>
          </Section>

          {/* Activation */}
          <Section title="Activation" description="The person sets their own password with a one-time link. The Backoffice never sees a password.">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-4 py-3">
              <div className="text-xs text-ink-muted">
                <p className="text-sm font-medium text-ink">{ACTIVATION_LABELS[user.activation].label}</p>
                {user.activationDetails.activatedAt && <p>Password set on {formatTimestamp(user.activationDetails.activatedAt)}</p>}
                {user.activationDetails.openLink && (
                  <p>
                    Link created {formatTimestamp(user.activationDetails.openLink.createdAt)}, {user.activation === "LINK_EXPIRED" ? "expired" : "valid until"}{" "}
                    {formatTimestamp(user.activationDetails.openLink.expiresAt)}
                  </p>
                )}
                {activationBlocker(user) && <p>{activationBlocker(user)}</p>}
              </div>
              <button type="button" data-action="activation" disabled={isBusy || activationBlocker(user) !== null} onClick={() => setConfirmation({ kind: "activation" })} className="rounded-md bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-strong disabled:opacity-50">
                {busy === "activation" ? "Creating…" : user.activation === "NOT_INVITED" ? "Create activation link" : "Create new link"}
              </button>
            </div>
          </Section>

          {/* Sessions */}
          <Section title="Signed-in sessions" description="Browsers in which the user is signed in right now. Ending a session signs that browser out at its next request.">
            {user.sessions.length === 0 ? (
              <p className="rounded-md border border-dashed border-line px-4 py-3 text-ink-muted" data-no-sessions>
                No open session.
              </p>
            ) : (
              <>
                <ul className="divide-y divide-line rounded-md border border-line" data-sessions={user.sessions.length}>
                  {user.sessions.map((session, index) => (
                    <li key={session.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1 text-xs text-ink-muted">
                        <p className="text-sm font-medium text-ink">Session {index + 1}</p>
                        <p>
                          Signed in {formatTimestamp(session.createdAt)} · last activity {formatTimestamp(session.lastSeenAt)}
                        </p>
                        <p>Ends without activity at {formatTimestamp(session.endsAt)}</p>
                      </div>
                      <button
                        type="button"
                        data-action="revoke-session"
                        disabled={isBusy}
                        onClick={() => void run("sessions", () => revokeShopUserSession(user.id, session.id), "The session has ended.")}
                        className="rounded-md px-2 py-1 font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
                      >
                        End session
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" data-action="revoke-all" disabled={isBusy} onClick={() => setConfirmation({ kind: "revoke-all" })} className="mt-3 rounded-md border border-danger/40 px-3 py-1.5 font-medium text-danger hover:bg-danger-soft disabled:opacity-50">
                  End all sessions
                </button>
              </>
            )}
          </Section>
        </div>
      )}

      {user && confirmation && (
        <ConfirmDialog
          title={CONFIRMATIONS[confirmation.kind].title}
          confirmLabel={CONFIRMATIONS[confirmation.kind].confirm}
          busyLabel="Please wait…"
          isBusy={isBusy}
          onConfirm={() => void confirm()}
          onCancel={() => setConfirmation(null)}
        >
          <p>{confirmationText(confirmation, user)}</p>
        </ConfirmDialog>
      )}

      {user && issuedLink && (
        <ActivationLinkDialog link={issuedLink} recipient={user} onClose={() => setIssuedLink(null)} />
      )}
    </SidePanel>
  );
}

const CONFIRMATIONS: Record<Confirmation["kind"], { title: string; confirm: string }> = {
  disable: { title: "Disable shop user?", confirm: "Disable user" },
  enable: { title: "Enable shop user?", confirm: "Enable user" },
  unassign: { title: "Remove B2B unit?", confirm: "Remove unit" },
  activation: { title: "Create activation link?", confirm: "Create link" },
  "revoke-all": { title: "End all sessions?", confirm: "End all sessions" },
};

function confirmationText(confirmation: Confirmation, user: ShopUserDetail): string {
  switch (confirmation.kind) {
    case "disable":
      return `${user.displayName} is signed out everywhere at once and can no longer sign in. Unit assignments and orders are kept.`;
    case "enable":
      return `${user.displayName} can sign in again. Sessions that ended stay ended.`;
    case "unassign":
      return `${user.displayName} loses access to ${confirmation.unit.unitId} with the next request. The unit and its orders are kept.`;
    case "activation":
      return user.activationDetails.openLink
        ? "A new one-time link is created and shown once. The earlier unused link stops working."
        : "A one-time link is created and shown once. It is valid for 24 hours.";
    case "revoke-all":
      return `Every browser of ${user.displayName} is signed out at its next request. Signing in again stays possible; to block access, disable the user.`;
  }
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="font-semibold">{title}</h4>
      <p className="mb-3 text-xs text-ink-muted">{description}</p>
      {children}
    </section>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}
