import { formatAmount } from "@/lib/money";
import { SOURCE_LABELS, stepStatus, type StepStatus } from "@/lib/price-check";
import type { PricingStep } from "@/lib/pricing";

/**
 * The checked levels of a price determination (B2B unit, Sold-to, base
 * price), comparable to the SAP pricing analysis. Used by the Price Check
 * and the Order Simulation.
 */
export function PricingAnalysis({
  steps,
  currency,
  showTitle = true,
}: {
  steps: PricingStep[];
  currency: string;
  /** Hide the title when the surrounding element already names it */
  showTitle?: boolean;
}) {
  return (
    <div>
      {showTitle && (
        <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
          Pricing analysis
        </h3>
      )}
      <ol className={`${showTitle ? "mt-2 " : ""}divide-y divide-line rounded-md border border-line`}>
        {steps.map((step, index) => {
          const status = stepStatus(step);
          return (
            <li
              key={step.source}
              data-step={step.source}
              data-status={status}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 ${status === "applied" ? "bg-success-soft/50" : ""}`}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-canvas text-xs font-medium">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{SOURCE_LABELS[step.source]}</span>
                {step.conditionType && (
                  <span
                    data-step-condition-type={step.conditionType.code}
                    title={step.conditionType.name}
                    className="ml-2 inline-flex items-center gap-1 rounded bg-canvas px-1.5 py-0.5 text-xs"
                  >
                    <span className="font-mono font-medium">{step.conditionType.code}</span>
                    <span className="text-ink-muted">{step.conditionType.name}</span>
                  </span>
                )}
                {step.conditionId !== null && (
                  <span className="ml-2 text-xs text-ink-muted">condition {step.conditionId}</span>
                )}
              </span>
              <span className="tabular-nums">
                {step.amount === null ? "—" : `${formatAmount(step.amount)} ${currency}`}
              </span>
              <StepBadge status={status} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const STEP_LABELS: Record<StepStatus, string> = {
  applied: "Applied",
  "not-used": "Found, lower priority",
  none: "No valid condition",
};

const STEP_STYLES: Record<StepStatus, string> = {
  applied: "bg-success-soft text-success",
  "not-used": "bg-canvas text-ink",
  none: "bg-canvas text-ink-muted",
};

function StepBadge({ status }: { status: StepStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STEP_STYLES[status]}`}>
      {STEP_LABELS[status]}
    </span>
  );
}
