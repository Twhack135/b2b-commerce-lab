import {
  CALCULATION_TYPE_LABELS,
  CONDITION_CLASS_LABELS,
  RESTRICTION_TEXTS,
} from "@/lib/condition-type-display";
import type { ConditionType } from "@/lib/condition-types";
import { SCOPE_LABELS, scopesOf } from "@/lib/price-condition-form";
import { CheckIcon } from "../icons";
import { StatusBadge } from "../list-page";

/**
 * Read-only overview of the condition types (comparable to SAP condition
 * type configuration). Administration follows in a later release.
 */
export function ConditionTypesOverview({
  types,
  loadError,
}: {
  /** null while loading */
  types: ConditionType[] | null;
  loadError: string | null;
}) {
  return (
    <section
      aria-labelledby="condition-types-title"
      className="mt-6 rounded-lg border border-line bg-surface shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="condition-types-title" className="font-semibold">
          Condition Types
        </h2>
        <p className="text-xs text-ink-muted">
          Read-only configuration. Prices of condition records follow the levels
          B2B unit, Sold-to, material base price.
        </p>
      </div>

      {loadError ? (
        <p role="alert" className="px-4 py-6 text-sm text-danger">
          Condition types could not be loaded. {loadError}
        </p>
      ) : types === null ? (
        <p className="px-4 py-6 text-sm text-ink-muted">Loading condition types…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-canvas/60 text-xs tracking-wide text-ink-muted uppercase">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-medium sm:px-4">Code</th>
                <th scope="col" className="px-3 py-2.5 font-medium sm:px-4">Description</th>
                <th scope="col" className="hidden px-3 py-2.5 font-medium sm:px-4 md:table-cell">Condition class</th>
                <th scope="col" className="hidden px-3 py-2.5 font-medium sm:px-4 md:table-cell">Calculation type</th>
                <th scope="col" className="hidden px-3 py-2.5 font-medium sm:px-4 lg:table-cell">Levels</th>
                <th scope="col" className="hidden px-3 py-2.5 font-medium sm:table-cell sm:px-4">Status</th>
                <th scope="col" className="px-3 py-2.5 font-medium sm:px-4">Usable for condition records</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {types.map((type) => (
                <tr key={type.code} data-condition-type-row={type.code} className="align-top">
                  <td className="px-3 py-3 font-mono font-medium sm:px-4">{type.code}</td>
                  <td className="px-3 py-3 sm:px-4">
                    <div>{type.name}</div>
                    <div className="text-xs text-ink-muted md:hidden">
                      {CONDITION_CLASS_LABELS[type.conditionClass]} ·{" "}
                      {CALCULATION_TYPE_LABELS[type.calculationType]}
                    </div>
                  </td>
                  <td className="hidden px-3 py-3 text-sm sm:px-4 md:table-cell">
                    {CONDITION_CLASS_LABELS[type.conditionClass]}
                  </td>
                  <td className="hidden px-3 py-3 text-sm sm:px-4 md:table-cell">
                    {CALCULATION_TYPE_LABELS[type.calculationType]}
                  </td>
                  <td className="hidden px-3 py-3 text-sm sm:px-4 lg:table-cell" data-levels={type.code}>
                    {/* Configured in the ERP API, e.g. ZP01 only per sales area */}
                    {scopesOf(type).map((scope) => SCOPE_LABELS[scope]).join(", ") || "—"}
                  </td>
                  <td className="hidden px-3 py-3 sm:table-cell sm:px-4">
                    <StatusBadge isActive={type.isActive} />
                  </td>
                  <td className="px-3 py-3 text-sm sm:px-4" data-usable={type.usableForPriceConditions}>
                    {type.usableForPriceConditions ? (
                      <span className="inline-flex items-center gap-1.5 font-medium text-success">
                        <CheckIcon className="size-4" />
                        Yes
                      </span>
                    ) : (
                      <span className="text-ink-muted">
                        <span className="font-medium text-ink">No</span>
                        {type.restriction && ` – ${RESTRICTION_TEXTS[type.restriction]}`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
