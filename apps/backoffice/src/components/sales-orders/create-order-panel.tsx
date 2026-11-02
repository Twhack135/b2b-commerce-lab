"use client";

import Link from "next/link";
import { formatApiAmount } from "@/lib/money";
import type { CreationOutcome } from "@/lib/order-creation";
import type { CreateSalesOrderRequest, SalesOrderSimulation } from "@/lib/sales-orders";
import { salesAreaId } from "@/lib/sales-area-display";
import { ConfirmDialog } from "../forms/confirm-dialog";
import { AlertIcon } from "../icons";

/** Where the creation of a sales order from the simulation stands */
export type CreationState =
  | { phase: "idle" }
  /** The confirmation dialog is open; no request exists yet */
  | { phase: "confirming" }
  | { phase: "submitting"; request: CreateSalesOrderRequest }
  /** The ERP API answered without creating an order (or the result is unknown) */
  | {
      phase: "answered";
      request: CreateSalesOrderRequest;
      outcome: Exclude<CreationOutcome, { kind: "created" }>;
    }
  /** The previous order was created; the form starts a new, empty order */
  | { phase: "created"; salesOrderNumber: string; replayed: boolean };

/**
 * Creating a permanent sales order from the current simulation: the action,
 * the confirmation step and every answer of the ERP API that did not lead
 * to a new order page.
 */
export function CreateOrderPanel({
  result,
  blocker,
  creation,
  decimals,
  onOpen,
  onCancel,
  onConfirm,
  onRetry,
}: {
  /** The current simulation, for the confirmation summary */
  result: SalesOrderSimulation | null;
  /** Why no order can be created now, or null */
  blocker: string | null;
  creation: CreationState;
  decimals?: number;
  onOpen: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onRetry: () => void;
}) {
  if (creation.phase === "created") {
    return (
      <section
        aria-label="Create sales order"
        role="status"
        data-creation-created={creation.salesOrderNumber}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm text-success print:hidden"
      >
        <span className="font-medium">
          Sales order {creation.salesOrderNumber}{" "}
          {creation.replayed ? "had already been created." : "was created."} The form is
          ready for a new order.
        </span>
        <Link
          href={`/sales-orders/${creation.salesOrderNumber}`}
          className="font-medium underline"
        >
          Open sales order {creation.salesOrderNumber}
        </Link>
      </section>
    );
  }

  const isSubmitting = creation.phase === "submitting";
  const mustRetry =
    creation.phase === "answered" && creation.outcome.kind === "retry";
  const canCreate = blocker === null && !isSubmitting && !mustRetry;

  return (
    <section
      aria-label="Create sales order"
      data-create-order
      className="space-y-3 rounded-lg border border-line bg-surface px-4 py-4 print:hidden"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold">Create sales order</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Creates a permanent sales order from this simulation. The ERP API
            checks and prices the order again when it is created; if a price
            has changed, nothing is created and you can review the new prices.
          </p>
          <p className="mt-1 text-xs font-medium text-warning">
            Sales orders cannot be changed or deleted at the moment.
          </p>
        </div>
        <button
          type="button"
          data-create-button
          onClick={onOpen}
          disabled={!canCreate}
          className="rounded-md bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong disabled:opacity-60"
        >
          {isSubmitting ? "Creating…" : "Create Sales Order"}
        </button>
      </div>

      {blocker && !isSubmitting && !mustRetry && (
        <p data-create-blocker className="text-sm text-ink-muted">
          {blocker}
        </p>
      )}

      {isSubmitting && (
        <p role="status" data-creation-state="submitting" className="text-sm font-medium">
          Creating the sales order… Please keep this page open.
        </p>
      )}

      {creation.phase === "answered" && (
        <OutcomeNotice
          outcome={creation.outcome}
          request={creation.request}
          currency={result?.currency ?? creation.request.expectedTotal.currency}
          decimals={decimals}
          onRetry={onRetry}
        />
      )}

      {creation.phase === "confirming" && result?.totals && (
        <ConfirmDialog
          title="Create a permanent sales order?"
          confirmLabel="Create Sales Order"
          busyLabel="Creating…"
          isBusy={false}
          onConfirm={onConfirm}
          onCancel={onCancel}
        >
          <OrderSummary result={result} decimals={decimals} />
        </ConfirmDialog>
      )}
    </section>
  );
}

/** What the user confirms: the simulated order with its prices */
function OrderSummary({
  result,
  decimals,
}: {
  result: SalesOrderSimulation;
  decimals?: number;
}) {
  const money = (amount: string) =>
    `${formatApiAmount(amount, decimals)} ${result.currency}`;
  return (
    <div data-confirm-summary className="space-y-3 text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="text-ink-muted">B2B unit</dt>
        <dd className="font-mono">{result.partners?.unit.unitId}</dd>
        <dt className="text-ink-muted">Ship-to</dt>
        <dd className="font-mono">{result.partners?.shipTo?.customerNumber}</dd>
        <dt className="text-ink-muted">Sales area</dt>
        <dd className="font-mono">{salesAreaId(result.salesArea)}</dd>
        {result.requestedDeliveryDate && (
          <>
            <dt className="text-ink-muted">Requested delivery</dt>
            <dd>
              <span className="font-mono">{result.requestedDeliveryDate}</span>{" "}
              <span className="text-xs text-ink-muted">(not confirmed)</span>
            </dd>
          </>
        )}
      </dl>

      <table className="w-full text-left">
        <thead className="text-xs text-ink-muted">
          <tr>
            <th scope="col" className="py-1 font-medium">Item</th>
            <th scope="col" className="py-1 font-medium">Material</th>
            <th scope="col" className="py-1 text-right font-medium">Qty</th>
            <th scope="col" className="py-1 text-right font-medium">Unit price</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {result.items.map((item) => (
            <tr key={item.itemNumber} data-confirm-item={item.itemNumber}>
              <td className="py-1 font-mono tabular-nums">{item.itemNumber}</td>
              <td className="py-1 font-mono">{item.materialNumber}</td>
              <td className="py-1 text-right tabular-nums">{item.quantity}</td>
              <td className="py-1 text-right whitespace-nowrap tabular-nums">
                {item.unitPrice && money(item.unitPrice)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p data-confirm-total className="flex flex-wrap items-baseline justify-end gap-x-2 border-t border-line pt-2">
        <span className="text-ink-muted">Net value</span>
        <span className="text-base font-semibold tabular-nums">
          {result.totals && money(result.totals.netValue)}
        </span>
        <span className="text-xs text-ink-muted">excl. VAT and freight</span>
      </p>

      {result.proposedOrderBlock && (
        <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-warning">
          The order will receive delivery block{" "}
          <strong className="font-mono">{result.proposedOrderBlock.code}</strong>:
          Sales must review the customer note before delivery.
        </p>
      )}

      <p data-confirm-warning className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
        The sales order is permanent. It cannot be changed or deleted at the
        moment.
      </p>
      <p className="text-xs text-ink-muted">
        The ERP API sets the order date and checks every price again. If a
        price differs from the prices shown here, no order is created.
      </p>
    </div>
  );
}

function OutcomeNotice({
  outcome,
  request,
  currency,
  decimals,
  onRetry,
}: {
  outcome: Exclude<CreationOutcome, { kind: "created" }>;
  request: CreateSalesOrderRequest;
  currency: string;
  decimals?: number;
  onRetry: () => void;
}) {
  const money = (amount: string | null) =>
    amount === null ? "no price" : `${formatApiAmount(amount, decimals)} ${currency}`;

  if (outcome.kind === "retry") {
    const concurrent = outcome.reason === "CONCURRENT_UPDATE";
    return (
      <Notice tone="warning" kind={`retry-${outcome.reason}`} title={
        concurrent
          ? "The order data was changed at the same time – nothing was created"
          : "Result unknown – the sales order may already have been created"
      }>
        <Messages messages={outcome.messages} />
        <p className="mt-1">
          Retrying sends exactly the same request (request ID{" "}
          <span data-request-id className="font-mono">{request.requestId}</span>), so
          at most one sales order is created. The input is locked until the result
          is known.
        </p>
        <button
          type="button"
          data-retry
          onClick={onRetry}
          className="mt-2 rounded-md bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-strong"
        >
          Retry with the same request
        </button>
      </Notice>
    );
  }
  if (outcome.kind === "price-changed") {
    return (
      <Notice tone="warning" kind="price-changed" title="Prices have changed – no sales order was created">
        <ul className="mt-1 space-y-0.5">
          {outcome.changedItems.map((item) => (
            <li key={item.itemNumber} data-changed-item={item.itemNumber}>
              Item <span className="font-mono">{item.itemNumber}</span> ·{" "}
              <span className="font-mono">{item.materialNumber}</span>: confirmed{" "}
              <span className="tabular-nums line-through">{money(item.expectedUnitPrice)}</span>,
              now <strong className="tabular-nums">{money(item.unitPrice)}</strong>
            </li>
          ))}
        </ul>
        <Messages messages={outcome.messages} />
        <p className="mt-1">
          The result above shows the current prices. Review them and create the
          order again; a new confirmation is required.
        </p>
      </Notice>
    );
  }
  if (outcome.kind === "invalid") {
    return (
      <Notice tone="danger" kind="invalid" title="No sales order was created: the order has errors">
        <Messages messages={outcome.messages} />
        <p className="mt-1">The errors are marked in the input and in the result above.</p>
      </Notice>
    );
  }
  if (outcome.kind === "reused") {
    return (
      <Notice tone="danger" kind="reused" title="Not created: this request was already used for another order">
        <Messages messages={outcome.messages} />
        <p className="mt-1">
          No new order was created. Simulate the order again to start a new
          creation.
        </p>
        {outcome.salesOrderNumber && (
          <Link
            href={`/sales-orders/${outcome.salesOrderNumber}`}
            className="mt-1 inline-block font-medium text-brand underline"
          >
            Open sales order {outcome.salesOrderNumber}
          </Link>
        )}
      </Notice>
    );
  }
  return (
    <Notice tone="danger" kind="rejected" title="No sales order was created">
      <Messages messages={outcome.messages} />
    </Notice>
  );
}

function Notice({
  tone,
  kind,
  title,
  children,
}: {
  tone: "warning" | "danger";
  kind: string;
  title: string;
  children: React.ReactNode;
}) {
  const styles =
    tone === "warning"
      ? "border-warning/30 bg-warning-soft text-warning"
      : "border-danger/30 bg-danger-soft text-danger";
  return (
    <div role="alert" data-creation-outcome={kind} className={`rounded-md border px-4 py-3 text-sm ${styles}`}>
      <p className="flex items-center gap-2 font-semibold">
        <AlertIcon className="size-4 shrink-0" />
        {title}
      </p>
      <div className="text-ink">{children}</div>
    </div>
  );
}

function Messages({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <ul className="mt-1 list-disc pl-5">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}
