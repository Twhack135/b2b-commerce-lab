"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, errorMessage } from "@/lib/erp-api";
import { SOURCE_LABELS } from "@/lib/price-check";
import {
  createdNotice,
  isSalesOrderNumber,
  orderAmount,
  orderNotes,
  PARTNER_ROLES,
  SHIPPING_METHOD_LABELS,
} from "@/lib/sales-order-display";
import { getSalesOrder, type SalesOrder } from "@/lib/sales-orders";
import { salesAreaId } from "@/lib/sales-area-display";
import { AlertIcon, CheckIcon } from "../icons";
import { LoadError, PageHeader } from "../list-page";

type Loaded =
  | { state: "loading" }
  | { state: "not-found" }
  | { state: "error"; message: string }
  | { state: "loaded"; order: SalesOrder };

/**
 * The order confirmation of a stored sales order. Everything shown comes
 * from the order itself (its snapshots), never from current master data or
 * price conditions; the page can be opened and printed at any time.
 */
export function SalesOrderConfirmation({
  salesOrderNumber,
  created,
}: {
  salesOrderNumber: string;
  /** "new" or "existing" right after a creation */
  created?: string;
}) {
  const isValidNumber = isSalesOrderNumber(salesOrderNumber);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [notice, setNotice] = useState(createdNotice(salesOrderNumber, created));
  // Increasing this number loads the order again (Retry)
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (!isValidNumber) return;
    let isCurrent = true;
    getSalesOrder(salesOrderNumber).then(
      (order) => {
        if (isCurrent) setLoaded({ state: "loaded", order });
      },
      (error: unknown) => {
        if (!isCurrent) return;
        setLoaded(
          error instanceof ApiError && error.status === 404
            ? { state: "not-found" }
            : { state: "error", message: errorMessage(error) },
        );
      },
    );
    // Ignore an answer that arrives after a newer request was started
    return () => {
      isCurrent = false;
    };
  }, [isValidNumber, salesOrderNumber, reloadCount]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Sales"
        title={`Sales Order ${salesOrderNumber}`}
        description="Order confirmation, as stored when the order was created."
      />

      {notice && (
        <div
          role="status"
          data-created-notice
          className="mt-6 flex items-center gap-2 rounded-md border border-success/30 bg-success-soft px-4 py-3 text-success print:hidden"
        >
          <CheckIcon />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="mt-6">
        {!isValidNumber ? (
          <Problem
            kind="invalid"
            title="Not a sales order number"
            text={`"${salesOrderNumber}" is not a sales order number. Sales order numbers have 10 digits, e.g. 1000000001.`}
          />
        ) : loaded.state === "loading" ? (
          <div aria-busy="true" aria-label="Loading sales order" className="h-40 animate-pulse rounded-lg border border-line bg-surface" />
        ) : loaded.state === "not-found" ? (
          <Problem
            kind="not-found"
            title="Sales order not found"
            text={`There is no sales order ${salesOrderNumber}.`}
          />
        ) : loaded.state === "error" ? (
          <div className="rounded-lg border border-line bg-surface">
            <LoadError
              title="The sales order could not be loaded"
              message={loaded.message}
              isRetrying={false}
              onRetry={() => {
                setLoaded({ state: "loading" });
                setReloadCount((count) => count + 1);
              }}
            />
          </div>
        ) : (
          <OrderDocument order={loaded.order} />
        )}
      </div>
    </div>
  );
}

function Problem({ kind, title, text }: { kind: string; title: string; text: string }) {
  return (
    <div data-problem={kind} className="flex flex-col items-center gap-3 rounded-lg border border-line bg-surface px-6 py-14 text-center">
      <div className="grid size-10 place-items-center rounded-full bg-danger-soft text-danger">
        <AlertIcon className="size-5" />
      </div>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-ink-muted">{text}</p>
      </div>
      <Link href="/sales-orders/simulation" className="font-medium text-brand underline">
        Go to the Order Simulation
      </Link>
    </div>
  );
}

function OrderDocument({ order }: { order: SalesOrder }) {
  const money = (amount: string) => orderAmount(order, amount);
  return (
    <article data-sales-order={order.salesOrderNumber} className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        <Link
          href="/sales-orders/simulation"
          className="rounded-md border border-line bg-surface px-4 py-2 font-medium hover:bg-canvas"
        >
          New Order Simulation
        </Link>
        <button
          type="button"
          data-print
          onClick={() => window.print()}
          className="rounded-md bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong"
        >
          Print Confirmation
        </button>
      </div>

      {/* Header */}
      <section aria-label="Order header" className="rounded-lg border border-line bg-surface px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-ink-muted">Sales order</p>
            <p data-order-number className="font-mono text-xl font-semibold">{order.salesOrderNumber}</p>
          </div>
          <span data-order-status={order.status} className="rounded-full border border-success/30 bg-success-soft px-3 py-1 text-xs font-semibold text-success">
            Open
          </span>
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Order date" field="order-date">
            <span className="font-mono tabular-nums">{order.orderDate}</span>
            <span className="block text-xs text-ink-muted">{order.timeZone}</span>
          </Fact>
          <Fact label="Sales area" field="sales-area">
            <span className="font-mono">{salesAreaId(order.salesArea)}</span>
          </Fact>
          <Fact label="Document currency" field="currency">
            <span className="font-mono">{order.currency}</span>
          </Fact>
          <Fact label="B2B unit" field="unit">
            <span className="font-mono">{order.unit.unitId}</span>
            <span className="block text-xs text-ink-muted">{order.unit.name}</span>
          </Fact>
          <Fact label="Customer reference" field="customer-reference">
            <span className="break-all">{order.customerReference ?? "—"}</span>
          </Fact>
          <Fact label="Requested shipping method" field="shipping-method">
            {SHIPPING_METHOD_LABELS[order.requestedShippingMethod]}
          </Fact>
          <Fact label="Requested delivery date" field="requested-delivery-date">
            {order.requestedDeliveryDate ? (
              <>
                <span className="font-mono tabular-nums">{order.requestedDeliveryDate}</span>
                <span className="block text-xs text-ink-muted">requested, not confirmed</span>
              </>
            ) : (
              "—"
            )}
          </Fact>
          <Fact label="Created" field="created-at">
            <span className="tabular-nums">{new Date(order.createdAt).toISOString().replace("T", " ").slice(0, 19)} UTC</span>
          </Fact>
        </dl>
      </section>

      {order.deliveryBlock && (
        <div data-delivery-block={order.deliveryBlock} className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-warning">
          <p className="flex items-center gap-2 font-semibold">
            <AlertIcon className="size-4" />
            Delivery block <span className="font-mono">{order.deliveryBlock}</span>
          </p>
          <p className="mt-1 text-sm">
            The order contains a customer note. Delivery waits until Sales has
            reviewed the note and released the block.
          </p>
        </div>
      )}

      {order.customerNote && (
        <section aria-label="Customer note" data-customer-note className="rounded-lg border border-line bg-surface px-4 py-3">
          <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Customer note</h3>
          <p className="mt-1 text-sm whitespace-pre-wrap break-words">{order.customerNote}</p>
        </section>
      )}

      {/* Partners as stored with the order */}
      <section aria-label="Partners" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PARTNER_ROLES.map(([role, label]) => {
          const partner = order.partners[role];
          return (
            <div key={role} data-order-partner={role} className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
              <p className="text-xs font-medium text-ink-muted">{label}</p>
              <p className="mt-0.5 font-mono">{partner.customerNumber}</p>
              <p className="font-medium">{partner.name}</p>
              <p className="text-ink-muted">{partner.street}</p>
              <p className="text-ink-muted">
                {partner.postalCode} {partner.city}, {partner.country}
              </p>
            </div>
          );
        })}
      </section>

      {/* Items with the applied price conditions */}
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-canvas/60 text-xs tracking-wide text-ink-muted uppercase">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-medium sm:px-4">Item</th>
              <th scope="col" className="px-3 py-2.5 font-medium sm:px-4">Material</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium sm:px-4">Qty</th>
              <th scope="col" className="hidden px-3 py-2.5 text-right font-medium sm:table-cell sm:px-4 print:table-cell">Unit price</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium sm:px-4">Net value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {order.items.map((item) => (
              <tr key={item.itemNumber} data-order-item={item.itemNumber} className="align-top">
                <td className="px-3 py-3 font-mono tabular-nums sm:px-4">{item.itemNumber}</td>
                <td className="px-3 py-3 sm:px-4">
                  <div className="font-mono">{item.materialNumber}</div>
                  <div className="text-xs text-ink-muted">{item.materialDescription}</div>
                  <span className="text-xs text-ink-muted sm:hidden print:hidden">
                    {money(item.unitPrice)} each
                  </span>
                  {item.conditions.map((condition) => (
                    <p key={condition.stepNumber} data-order-condition={condition.conditionType.code} className="mt-1 text-xs text-ink-muted">
                      <span className="font-mono font-medium text-ink">{condition.conditionType.code}</span>{" "}
                      {condition.conditionType.name} · {SOURCE_LABELS[condition.source]} · condition{" "}
                      {condition.conditionId} · {money(condition.amount)} · valid {condition.validFrom} –{" "}
                      {condition.validTo ?? "open-ended"}
                    </p>
                  ))}
                </td>
                <td className="px-3 py-3 text-right tabular-nums sm:px-4">{item.quantity}</td>
                <td className="hidden px-3 py-3 text-right whitespace-nowrap tabular-nums sm:table-cell sm:px-4 print:table-cell">
                  {money(item.unitPrice)}
                </td>
                <td className="px-3 py-3 text-right font-medium whitespace-nowrap tabular-nums sm:px-4">
                  {money(item.netValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div data-order-total className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1 rounded-lg border border-line bg-surface px-4 py-3">
        <span className="text-ink-muted">Net value</span>
        <span className="text-xl font-semibold tabular-nums">{money(order.totals.netValue)}</span>
        <span className="text-xs text-ink-muted">excl. VAT and freight</span>
      </div>

      <section aria-label="Order information" className="rounded-lg border border-line bg-surface px-4 py-3">
        <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Order information</h3>
        <ul data-order-notes className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {orderNotes(order).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}

function Fact({ label, field, children }: { label: string; field: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd data-order-field={field}>{children}</dd>
    </div>
  );
}
