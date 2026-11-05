"use client";

import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/erp-api";
import { SCOPE_LABELS } from "@/lib/price-condition-form";
import { assignmentLabel, stepDescription, stepFlags } from "@/lib/pricing-procedure-display";
import {
  getPricingProcedure,
  listPricingProcedures,
  type PricingProcedure,
} from "@/lib/pricing-procedures";
import { useListData } from "@/lib/use-list-data";

/**
 * Read-only view of the pricing procedures (Sprint 13A, comparable to SAP
 * pricing procedure configuration): which procedure a sales area uses, its
 * steps and the access sequences that find the condition records. The
 * configuration is versioned through migrations; it cannot be changed here.
 */
export function PricingProceduresOverview() {
  const procedures = useListData(listPricingProcedures);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<PricingProcedure | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const code = selected ?? procedures.items?.[0]?.code ?? null;

  useEffect(() => {
    if (!code) return;
    let isCurrent = true;
    getPricingProcedure(code).then(
      (loaded) => {
        if (!isCurrent) return;
        setDetail(loaded);
        setDetailError(null);
      },
      (error: unknown) => isCurrent && setDetailError(errorMessage(error)),
    );
    return () => {
      isCurrent = false;
    };
  }, [code]);

  const shown = detail?.code === code ? detail : null;

  return (
    <section aria-labelledby="pricing-procedures-title" className="mt-6 rounded-lg border border-line bg-surface shadow-sm" data-pricing-procedures>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="pricing-procedures-title" className="font-semibold">
          Pricing Procedures
        </h2>
        <p className="text-xs text-ink-muted">Read-only configuration, changed through versioned migrations.</p>
      </div>

      {procedures.loadError ? (
        <p role="alert" className="px-4 py-6 text-sm text-danger">
          Pricing procedures could not be loaded. {procedures.loadError}
        </p>
      ) : procedures.items === null ? (
        <p className="px-4 py-6 text-sm text-ink-muted">Loading pricing procedures…</p>
      ) : procedures.items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-muted">No pricing procedure is configured.</p>
      ) : (
        <div className="space-y-4 px-4 py-4">
          <div role="tablist" aria-label="Pricing procedure" className="flex flex-wrap gap-2">
            {procedures.items.map((procedure) => {
              const isSelected = procedure.code === code;
              return (
                <button
                  key={procedure.code}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  data-procedure={procedure.code}
                  onClick={() => setSelected(procedure.code)}
                  className={`rounded-lg border px-3 py-2 text-left ${isSelected ? "border-brand bg-brand-soft/60" : "border-line hover:bg-canvas"}`}
                >
                  <span className="block font-mono text-sm font-semibold">{procedure.code}</span>
                  <span className="block text-xs text-ink-muted">
                    {procedure.name} · {procedure.assignments.map(assignmentLabel).join(", ") || "not assigned"}
                  </span>
                </button>
              );
            })}
          </div>

          {detailError ? (
            <p role="alert" className="text-sm text-danger">
              The pricing procedure could not be loaded. {detailError}
            </p>
          ) : !shown ? (
            <p className="text-sm text-ink-muted">Loading steps…</p>
          ) : (
            <div role="tabpanel" data-procedure-detail={shown.code}>
              <p className="mb-3 text-xs text-ink-muted">
                Revision {shown.revision}
                {shown.isActive ? "" : " · inactive"} · used by {shown.assignments.map(assignmentLabel).join(", ") || "no sales area"}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-canvas/60 text-xs tracking-wide text-ink-muted uppercase">
                    <tr>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Step</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Description</th>
                      <th scope="col" className="hidden px-3 py-2.5 font-medium md:table-cell">Determination</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Flags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {shown.steps.map((step) => (
                      <tr key={step.stepNumber} data-step={step.stepNumber} className="align-top">
                        <td className="px-3 py-3 text-right font-mono tabular-nums">{step.stepNumber}</td>
                        <td className="px-3 py-3">
                          <div className={step.kind === "SUBTOTAL" ? "font-semibold" : "font-medium"}>{step.label}</div>
                          <div className="text-xs text-ink-muted">
                            {step.kind === "SUBTOTAL" ? `Subtotal ${step.subtotalKey}` : "Condition"}
                            <span className="md:hidden"> · {stepDescription(step)}</span>
                          </div>
                        </td>
                        <td className="hidden px-3 py-3 md:table-cell">
                          <div className="text-xs">{stepDescription(step)}</div>
                          {step.accessSequence && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-xs font-medium text-brand">Accesses</summary>
                              <ol className="mt-1 space-y-0.5 text-xs text-ink-muted" data-accesses={step.accessSequence.code}>
                                {step.accessSequence.accesses.map((access) => (
                                  <li key={access.accessNumber}>
                                    <span className="font-mono">{access.accessNumber}</span> · {access.conditionType.code}{" "}
                                    {access.conditionType.name} · {SCOPE_LABELS[access.scope]}
                                  </li>
                                ))}
                              </ol>
                            </details>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            {stepFlags(step).map((flag) => (
                              <span key={flag} className="rounded-full bg-canvas px-2 py-0.5 text-xs whitespace-nowrap text-ink-muted">
                                {flag}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-ink-muted">
                The first access that finds a valid record wins: B2B unit before Sold-to before sales area, and within a
                level the special price ZP03 before the customer net price ZP02. Statistical steps are shown but never part
                of a value.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
