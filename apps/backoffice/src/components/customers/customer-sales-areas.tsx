"use client";

import { useRef, useState } from "react";
import {
  assignCustomerSalesArea,
  setCustomerSalesAreaActive,
  type Customer,
} from "@/lib/customers";
import { errorMessage } from "@/lib/erp-api";
import {
  assignableSalesAreas,
  findSalesArea,
  parseSalesAreaId,
  salesAreaId,
  salesAreaLabel,
  sameSalesArea,
} from "@/lib/sales-area-display";
import type { SalesArea, SalesAreaAssignment } from "@/lib/sales-areas";
import { FormErrorAlert } from "../forms/form-controls";
import { StatusBadge } from "../list-page";

/**
 * Sales area assignments of a customer (comparable to extending a customer
 * to a sales area in SAP). Each action is saved immediately, independent of
 * the customer form around it. Assignments are never deleted.
 */
export function CustomerSalesAreas({
  customer,
  salesAreas,
  salesAreasError,
  onChanged,
}: {
  customer: Customer;
  /** null while loading */
  salesAreas: SalesArea[] | null;
  salesAreasError: string | null;
  /** Called after every saved change, e.g. to reload the customer list */
  onChanged: () => void;
}) {
  const [assignments, setAssignments] = useState<SalesAreaAssignment[]>(
    customer.salesAreas,
  );
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // A ref changes immediately, so a fast double click cannot send twice
  const busyRef = useRef(false);

  const assignable = assignableSalesAreas(salesAreas ?? [], assignments);

  /** Saves one change; true if it was saved */
  async function run(
    key: string,
    action: () => Promise<SalesAreaAssignment>,
    message: string,
  ): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusyKey(key);
    setError(null);
    setNotice(null);
    try {
      const saved = await action();
      setAssignments((current) => {
        const others = current.filter((a) => !sameSalesArea(a, saved));
        return [...others, saved].sort((a, b) =>
          salesAreaId(a).localeCompare(salesAreaId(b)),
        );
      });
      setNotice(message);
      onChanged();
      return true;
    } catch (caught) {
      // e.g. 409: active B2B units still use the customer in this sales area
      setError([errorMessage(caught)]);
      return false;
    } finally {
      busyRef.current = false;
      setBusyKey(null);
    }
  }

  function assign() {
    const key = parseSalesAreaId(selected);
    if (!key) return;
    void run(
      selected,
      () => assignCustomerSalesArea(customer.customerNumber, key),
      `Assigned to sales area ${selected}.`,
    ).then((saved) => {
      if (saved) setSelected("");
    });
  }

  function toggle(assignment: SalesAreaAssignment) {
    const id = salesAreaId(assignment);
    const isActive = !assignment.isActive;
    void run(
      id,
      () => setCustomerSalesAreaActive(customer.customerNumber, assignment, isActive),
      isActive ? `Sales area ${id} was reactivated.` : `Sales area ${id} was deactivated.`,
    );
  }

  return (
    <section
      aria-labelledby="sales-areas-title"
      className="space-y-3 rounded-md border border-line px-4 py-3"
    >
      <div>
        <h3 id="sales-areas-title" className="font-medium">
          Sales Areas
        </h3>
        <p className="mt-0.5 text-xs text-ink-muted">
          The customer can only be a partner (Sold-to, Bill-to, Payer, Ship-to)
          of B2B units in its active sales areas. Changes in this section are
          saved immediately.
        </p>
      </div>

      {error && <FormErrorAlert messages={error} />}
      {notice && (
        <p role="status" className="text-xs text-success">
          {notice}
        </p>
      )}

      {assignments.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-3 text-center text-sm text-ink-muted">
          Not assigned to any sales area yet.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {assignments.map((assignment) => {
            const id = salesAreaId(assignment);
            const area = findSalesArea(salesAreas, assignment);
            return (
              <li
                key={id}
                data-sales-area={id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm">{id}</div>
                  <div className="text-xs text-ink-muted">
                    {area
                      ? `${area.salesOrganizationName} · ${area.currency}`
                      : "Sales area details not loaded"}
                  </div>
                </div>
                <StatusBadge isActive={assignment.isActive} />
                <button
                  type="button"
                  onClick={() => toggle(assignment)}
                  disabled={busyKey !== null}
                  className="rounded-md px-2 py-1 text-sm font-medium text-brand hover:bg-brand-soft disabled:opacity-50"
                >
                  {busyKey === id
                    ? "Saving…"
                    : assignment.isActive
                      ? "Deactivate"
                      : "Reactivate"}
                  <span className="sr-only"> sales area {id}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-sm">
          <span className="mb-1 block text-xs font-medium text-ink-muted">
            Assign to sales area
          </span>
          <select
            id="assignSalesArea"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={salesAreas === null || assignable.length === 0}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          >
            <option value="">
              {salesAreas === null
                ? salesAreasError
                  ? "Sales areas could not be loaded"
                  : "Loading sales areas…"
                : assignable.length === 0
                  ? "Assigned to all active sales areas"
                  : "Select a sales area"}
            </option>
            {assignable.map((area) => (
              <option key={salesAreaId(area)} value={salesAreaId(area)}>
                {salesAreaLabel(area)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={assign}
          disabled={selected === "" || busyKey !== null}
          className="rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-canvas disabled:opacity-50"
        >
          {busyKey !== null && busyKey === selected ? "Assigning…" : "Assign"}
        </button>
      </div>
    </section>
  );
}
