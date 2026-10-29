import { formatAmount } from "@/lib/money";
import {
  conditionWarnings,
  SCOPE_LABELS,
  VALIDITY_LABELS,
  validityStatus,
  type ValidityStatus,
} from "@/lib/price-condition-form";
import type { PriceCondition } from "@/lib/price-conditions";
import { AlertIcon } from "../icons";
import { StatusBadge } from "../list-page";

export function PriceConditionTable({
  conditions,
  today,
  onSelect,
}: {
  conditions: PriceCondition[];
  /** null until known in the browser; validity badges are hidden until then */
  today: string | null;
  onSelect: (condition: PriceCondition) => void;
}) {
  return (
    <div className="overflow-x-auto">
      {/* On small screens the level and validity move below the material
          and the condition ID and Edit columns are hidden; tapping a row opens it */}
      <table className="w-full text-left">
        <thead className="bg-canvas/60 text-xs tracking-wide text-ink-muted uppercase">
          <tr>
            <th scope="col" className="hidden px-3 sm:px-4 py-2.5 font-medium lg:table-cell">
              ID
            </th>
            <th scope="col" className="px-3 py-2.5 sm:px-4 font-medium">
              Material
            </th>
            <th scope="col" className="hidden px-3 sm:px-4 py-2.5 font-medium md:table-cell">
              Type
            </th>
            <th scope="col" className="hidden px-3 sm:px-4 py-2.5 font-medium md:table-cell">
              Level
            </th>
            <th scope="col" className="hidden px-3 sm:px-4 py-2.5 font-medium sm:table-cell">
              Sold-to / Unit
            </th>
            <th scope="col" className="px-3 py-2.5 sm:px-4 text-right font-medium">
              Amount
            </th>
            <th scope="col" className="hidden px-3 sm:px-4 py-2.5 font-medium md:table-cell">
              Validity
            </th>
            <th scope="col" className="px-3 py-2.5 sm:px-4 font-medium">
              Status
            </th>
            <th scope="col" className="hidden px-3 sm:px-4 py-2.5 sm:table-cell">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {conditions.map((condition) => {
            const warnings = conditionWarnings(condition);
            return (
              <tr
                key={condition.conditionId}
                data-condition={condition.conditionId}
                onClick={() => onSelect(condition)}
                className="cursor-pointer align-top hover:bg-brand-soft/50"
              >
                <td className="hidden px-3 sm:px-4 py-3 font-mono text-xs text-ink-muted tabular-nums lg:table-cell">
                  {condition.conditionId}
                </td>
                <td className="px-3 py-3 sm:px-4">
                  <div className="font-mono font-medium whitespace-nowrap text-brand-strong">
                    {condition.materialNumber}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {condition.materialDescription}
                  </div>
                  <div className="mt-1 text-xs text-ink-muted md:hidden">
                    <span className="font-mono font-medium text-ink">
                      {condition.conditionType.code}
                    </span>{" "}
                    · {SCOPE_LABELS[condition.scope]}{" "}
                    <span className="font-mono whitespace-nowrap">
                      {condition.unit?.unitId ?? condition.soldTo?.customerNumber}
                    </span>
                    <br />
                    {/* May wrap between the dates on small screens */}
                    <Validity condition={condition} canWrap />
                  </div>
                </td>
                <td
                  className="hidden px-3 sm:px-4 py-3 md:table-cell"
                  data-condition-type={condition.conditionType.code}
                >
                  <div className="font-mono text-sm font-medium">
                    {condition.conditionType.code}
                  </div>
                  <div className="text-xs text-ink-muted">{condition.conditionType.name}</div>
                </td>
                <td className="hidden px-3 sm:px-4 py-3 md:table-cell">
                  <ScopeBadge scope={condition.scope} />
                </td>
                <td className="hidden px-3 sm:px-4 py-3 sm:table-cell">
                  <ConditionKey condition={condition} />
                </td>
                <td className="px-3 py-3 sm:px-4 text-right whitespace-nowrap tabular-nums">
                  <span className="font-medium">{formatAmount(condition.amount)}</span>{" "}
                  <span className="text-xs text-ink-muted">{condition.currency}</span>
                </td>
                <td className="hidden px-3 sm:px-4 py-3 text-sm md:table-cell">
                  <Validity condition={condition} />
                </td>
                <td className="px-3 py-3 sm:px-4">
                  <div className="flex flex-col items-start gap-1.5">
                    <StatusBadge isActive={condition.isActive} />
                    {today && condition.isActive && (
                      <ValidityBadge status={validityStatus(condition, today)} />
                    )}
                    {warnings.length > 0 && (
                      <span
                        title={warnings.join("\n")}
                        className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium whitespace-nowrap text-danger"
                      >
                        <AlertIcon className="size-3.5" />
                        {warnings.length}
                        <span className="hidden sm:inline">
                          {warnings.length === 1 ? " warning" : " warnings"}
                        </span>
                        <span className="sr-only">: {warnings.join(". ")}</span>
                      </span>
                    )}
                  </div>
                </td>
                <td className="hidden px-3 sm:px-4 py-3 text-right sm:table-cell">
                  {/* The button makes editing reachable by keyboard */}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(condition);
                    }}
                    className="rounded-md px-2 py-1 font-medium text-brand hover:bg-brand-soft"
                  >
                    Edit<span className="sr-only"> price condition {condition.conditionId}</span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ScopeBadge({ scope }: { scope: PriceCondition["scope"] }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
        scope === "B2B_UNIT"
          ? "bg-brand-soft text-brand-strong"
          : "bg-canvas text-ink"
      }`}
    >
      {SCOPE_LABELS[scope]}
    </span>
  );
}

/** Sold-to or unit with its Sold-to; inactive ones are marked */
function ConditionKey({ condition }: { condition: PriceCondition }) {
  if (condition.unit) {
    const { unit } = condition;
    return (
      <div className={unit.isActive ? "" : "text-danger"}>
        <div className="font-mono text-xs">{unit.unitId}</div>
        <div className="text-xs text-ink-muted">
          {unit.name}
          {!unit.isActive && <span className="ml-1 font-medium text-danger">(inactive)</span>}
        </div>
        <div className={`text-xs ${unit.soldTo.isActive ? "text-ink-muted" : "text-danger"}`}>
          Sold-to {unit.soldTo.customerNumber}
          {!unit.soldTo.isActive && " (inactive)"}
        </div>
      </div>
    );
  }
  const soldTo = condition.soldTo!;
  return (
    <div className={soldTo.isActive ? "" : "text-danger"}>
      <div className="font-mono text-xs">{soldTo.customerNumber}</div>
      <div className="text-xs text-ink-muted">
        {soldTo.name}
        {!soldTo.isActive && <span className="ml-1 font-medium text-danger">(inactive)</span>}
      </div>
    </div>
  );
}

function Validity({
  condition,
  canWrap = false,
}: {
  condition: PriceCondition;
  canWrap?: boolean;
}) {
  return (
    <span className={`tabular-nums ${canWrap ? "" : "whitespace-nowrap"}`}>
      <span className="whitespace-nowrap">{condition.validFrom} –</span>{" "}
      <span className="whitespace-nowrap">{condition.validTo ?? "open-ended"}</span>
    </span>
  );
}

const VALIDITY_STYLES: Record<ValidityStatus, string> = {
  current: "bg-success-soft text-success",
  future: "bg-brand-soft text-brand-strong",
  expired: "bg-canvas text-ink-muted",
  inactive: "bg-canvas text-ink-muted",
};

function ValidityBadge({ status }: { status: ValidityStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${VALIDITY_STYLES[status]}`}
    >
      {VALIDITY_LABELS[status]}
    </span>
  );
}
