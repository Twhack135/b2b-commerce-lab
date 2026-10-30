import { formatApiAmount } from "@/lib/money";
import { SOURCE_LABELS } from "@/lib/price-check";
import type {
  SalesOrderSimulation,
  SimulationMessage,
  SimulationStatus,
} from "@/lib/sales-orders";
import {
  checkLabel,
  SEVERITY_LABELS,
  sortMessages,
  splitChecks,
  STATUS_TEXT,
  totalToShow,
} from "@/lib/simulation-display";
import { salesAreaId } from "@/lib/sales-area-display";
import { AlertIcon, CheckIcon, CloseIcon } from "../icons";
import { PricingAnalysis } from "../pricing/pricing-analysis";

const STATUS_STYLES: Record<SimulationStatus, string> = {
  VALID: "border-success/30 bg-success-soft text-success",
  VALID_WITH_WARNINGS: "border-warning/30 bg-warning-soft text-warning",
  INVALID: "border-danger/30 bg-danger-soft text-danger",
};

const SEVERITY_STYLES: Record<SimulationMessage["severity"], string> = {
  ERROR: "text-danger",
  WARNING: "text-warning",
  INFO: "text-ink-muted",
};

/**
 * The result of an order simulation. An outdated result (the input changed
 * since) stays visible for comparison, but is clearly marked and never
 * presented as a current confirmation.
 */
export function SimulationResult({
  result,
  isOutdated,
  decimals,
}: {
  result: SalesOrderSimulation;
  isOutdated: boolean;
  /** Decimal places of the document currency, e.g. 0 for JPY */
  decimals?: number;
}) {
  const total = totalToShow(result);
  const { performed, notPerformed } = splitChecks(result.checks);
  const status = STATUS_TEXT[result.status];

  return (
    <section
      aria-label="Simulation result"
      data-outdated={isOutdated}
      className="space-y-4"
    >
      {isOutdated && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-ink-muted/30 bg-surface px-4 py-3 font-medium"
        >
          <AlertIcon className="size-4 text-ink-muted" />
          Outdated – simulate again. The input has changed since this result;
          its status and prices no longer apply.
        </div>
      )}

      <div className={`space-y-4 ${isOutdated ? "opacity-50 grayscale" : ""}`}>
        <div
          role={isOutdated ? undefined : "status"}
          data-status={result.status}
          className={`rounded-lg border px-4 py-3 ${STATUS_STYLES[result.status]}`}
        >
          <p className="text-base font-semibold">
            {isOutdated ? "Previous simulation: " : "Simulation: "}
            {status.title}
          </p>
          <p className="mt-0.5 text-sm">{status.text}</p>
        </div>

        {/* The header data as applied by the ERP API */}
        <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-ink-muted">Sales area</dt>
            <dd data-result-sales-area className="font-mono">
              {salesAreaId(result.salesArea)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Document currency</dt>
            <dd data-result-currency className="font-mono">
              {result.currency ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Order date</dt>
            <dd data-result-order-date className="font-mono tabular-nums">
              {result.pricingDate}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Requested delivery date</dt>
            <dd data-result-requested-delivery-date>
              {result.requestedDeliveryDate ? (
                <>
                  <span className="font-mono tabular-nums">{result.requestedDeliveryDate}</span>
                  <span className="block text-xs text-ink-muted">requested, not confirmed</span>
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Ship-to</dt>
            <dd className="font-mono">{result.partners?.shipTo?.customerNumber ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Requested shipping method</dt>
            <dd>{result.requestedShippingMethod === "EXPRESS" ? "Express" : "Standard"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Customer reference</dt>
            <dd className="break-all">{result.customerReference ?? "—"}</dd>
          </div>
        </dl>

        {result.requiresSalesReview && result.proposedOrderBlock && (
          <div
            data-sales-review
            className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-warning"
          >
            <p className="flex items-center gap-2 font-semibold">
              <AlertIcon className="size-4" />
              Sales review would be required
            </p>
            <p className="mt-1 text-sm">
              If this order is placed, it would receive delivery block{" "}
              <strong className="font-mono">{result.proposedOrderBlock.code}</strong>{" "}
              because it contains a customer note. Delivery would only start after
              Sales has reviewed the note and released the block. The order itself
              could still be placed.
            </p>
            <p className="mt-1 text-xs">
              No order and no delivery block exist: this is a simulation.
            </p>
          </div>
        )}

        {result.messages.length > 0 && <MessageList messages={result.messages} />}

        <ItemTable result={result} decimals={decimals} />

        <div
          data-total
          className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1 rounded-lg border border-line bg-surface px-4 py-3"
        >
          {total ? (
            <>
              <span className="text-ink-muted">Net value</span>
              <span className="text-xl font-semibold tabular-nums">
                {formatApiAmount(total.netValue, decimals)} {total.currency}
              </span>
              <span className="text-xs text-ink-muted">excl. VAT and freight</span>
            </>
          ) : (
            <span className="font-medium text-danger">
              No total – resolve the errors first.
            </span>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-line bg-surface px-4 py-3">
            <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Checks performed
            </h3>
            <ul className="mt-2 space-y-1.5">
              {performed.map((check) => (
                <li key={check.check} data-check={check.check} className="flex items-center gap-2 text-sm">
                  {check.result === "PASSED" ? (
                    <CheckIcon className="size-4 text-success" />
                  ) : (
                    <CloseIcon className="size-4 text-danger" />
                  )}
                  <span className="flex-1">{checkLabel(check)}</span>
                  <span className={check.result === "PASSED" ? "text-success" : "font-medium text-danger"}>
                    {check.result === "PASSED" ? "Passed" : "Failed"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-line bg-surface px-4 py-3">
            <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Not checked in this simulation
            </h3>
            <ul className="mt-2 space-y-1.5">
              {notPerformed.map((check) => (
                <li key={check.check} data-check={check.check} data-result="NOT_PERFORMED" className="text-sm">
                  <span className="font-medium">{checkLabel(check)}</span>
                  <span className="ml-1 text-xs text-ink-muted">– not checked. {check.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function MessageList({ messages }: { messages: SimulationMessage[] }) {
  return (
    <ul aria-label="Messages" className="divide-y divide-line rounded-lg border border-line bg-surface">
      {sortMessages(messages).map((message, index) => (
        <li
          key={`${message.code}-${index}`}
          data-message={message.code}
          data-severity={message.severity}
          className="flex gap-3 px-4 py-2.5 text-sm"
        >
          <span className={`w-16 shrink-0 font-medium ${SEVERITY_STYLES[message.severity]}`}>
            {SEVERITY_LABELS[message.severity]}
          </span>
          <span>{message.text}</span>
        </li>
      ))}
    </ul>
  );
}

function ItemTable({
  result,
  decimals,
}: {
  result: SalesOrderSimulation;
  decimals?: number;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-left">
        <thead className="bg-canvas/60 text-xs tracking-wide text-ink-muted uppercase">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-medium sm:px-4">Item</th>
            <th scope="col" className="px-3 py-2.5 font-medium sm:px-4">Material</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium sm:px-4">Qty</th>
            <th scope="col" className="hidden px-3 py-2.5 text-right font-medium sm:table-cell sm:px-4">Unit price</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium sm:px-4">Net value</th>
            <th scope="col" className="hidden px-3 py-2.5 font-medium md:table-cell md:px-4">Price source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {result.items.map((item) => (
            <tr key={item.itemNumber} data-result-item={item.itemNumber} className="align-top">
              <td className="px-3 py-3 font-mono text-sm tabular-nums sm:px-4">{item.itemNumber}</td>
              <td className="px-3 py-3 sm:px-4">
                <div className="font-mono text-sm">{item.materialNumber}</div>
                {item.materialDescription && (
                  <div className="text-xs text-ink-muted">{item.materialDescription}</div>
                )}
                {item.pricing && (
                  <div className="mt-1 text-xs text-ink-muted md:hidden">
                    {item.pricing.conditionType && (
                      <span className="font-mono font-medium text-ink">
                        {item.pricing.conditionType.code}{" "}
                      </span>
                    )}
                    {SOURCE_LABELS[item.pricing.source]}
                    <span className="sm:hidden">
                      {" "}· {item.unitPrice && formatApiAmount(item.unitPrice, decimals)} {item.currency} each
                    </span>
                  </div>
                )}
                {item.messages.map((m) => (
                  <p key={m.code} className={`mt-1 text-xs ${SEVERITY_STYLES[m.severity]}`}>
                    {m.text}
                  </p>
                ))}
                {item.pricing && item.currency && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs font-medium text-brand">
                      Pricing analysis
                    </summary>
                    <div className="mt-2 max-w-xl">
                      <PricingAnalysis
                        steps={item.pricing.steps}
                        currency={item.currency}
                        decimals={decimals}
                        showTitle={false}
                      />
                    </div>
                  </details>
                )}
              </td>
              <td className="px-3 py-3 text-right tabular-nums sm:px-4">{item.quantity}</td>
              <td className="hidden px-3 py-3 text-right whitespace-nowrap tabular-nums sm:table-cell sm:px-4">
                {item.unitPrice ? `${formatApiAmount(item.unitPrice, decimals)} ${item.currency}` : "—"}
              </td>
              <td className="px-3 py-3 text-right font-medium whitespace-nowrap tabular-nums sm:px-4">
                {item.netValue ? (
                  <>
                    {formatApiAmount(item.netValue, decimals)} <span className="text-xs font-normal text-ink-muted">{item.currency}</span>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="hidden px-3 py-3 text-sm md:table-cell md:px-4">
                {item.pricing ? (
                  <>
                    <div>{SOURCE_LABELS[item.pricing.source]}</div>
                    {item.pricing.conditionType && (
                      <div data-item-condition-type={item.pricing.conditionType.code} className="text-xs">
                        <span className="font-mono font-medium">{item.pricing.conditionType.code}</span>{" "}
                        <span className="text-ink-muted">{item.pricing.conditionType.name}</span>
                      </div>
                    )}
                    <div className="text-xs text-ink-muted">condition {item.pricing.conditionId}</div>
                  </>
                ) : (
                  <span className="text-ink-muted">Not priced</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
