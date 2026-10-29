"use client";

import type { MaterialOption, MaterialSearch } from "@/lib/material-search";
import {
  canStepQuantity,
  itemNumberAt,
  MAX_ITEMS,
  MAX_QUANTITY,
  stepQuantity,
  type ItemDraft,
  type ItemField,
} from "@/lib/order-simulation-form";
import type { SimulationMessage } from "@/lib/sales-orders";
import { CloseIcon, MinusIcon, PlusIcon } from "../icons";
import { inputClass } from "../forms/form-controls";
import { MaterialPicker } from "./material-picker";

/**
 * Order positions in request order. The same material may be chosen in
 * several positions; positions are never merged. Item numbers follow the
 * order (10, 20, 30), as in the ERP API.
 *
 * Quick entry by keyboard: material, Enter, quantity, Enter. Enter in the
 * quantity of the last item adds the next item (see quantityEnter).
 */
export function OrderItemsEditor({
  items,
  errors,
  itemListError,
  resultMessages,
  materials,
  search,
  notice,
  onChange,
  onAdd,
  onRemove,
  onQuantityEnter,
}: {
  items: ItemDraft[];
  /** Visible input errors by item key */
  errors: Record<number, Partial<Record<ItemField, string>>>;
  itemListError?: string;
  /** Messages of a current (not outdated) simulation by position index */
  resultMessages: Map<number, SimulationMessage[]>;
  /** Known materials by number, to show the selected material */
  materials: Map<string, MaterialOption>;
  search: MaterialSearch;
  onChange: (key: number, changes: Partial<Omit<ItemDraft, "key">>) => void;
  onAdd: () => void;
  onRemove: (key: number) => void;
  /** Feedback for one item, e.g. why Enter added no item */
  notice: { key: number; text: string } | null;
  /** Enter in the quantity input of an item */
  onQuantityEnter: (key: number) => void;
}) {
  const isFull = items.length >= MAX_ITEMS;

  return (
    <section
      aria-labelledby="items-title"
      className="rounded-lg border border-line bg-surface shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="items-title" className="font-semibold">
          Items
          <span className="ml-2 font-normal text-ink-muted">
            ({items.length} of {MAX_ITEMS})
          </span>
        </h2>
        <p className="text-xs text-ink-muted">
          The same material may appear in several items; items are never merged.
        </p>
      </div>

      {itemListError && (
        <p role="alert" className="px-4 pt-3 text-xs text-danger">
          {itemListError}
        </p>
      )}

      <div className="hidden grid-cols-[4rem_1fr_11rem_2.5rem] gap-3 px-4 pt-3 text-xs font-medium tracking-wide text-ink-muted uppercase sm:grid">
        <span>Item</span>
        <span>Material</span>
        <span>Quantity</span>
        <span className="sr-only">Remove</span>
      </div>

      <ol className="divide-y divide-line">
        {items.map((item, index) => {
          const itemNumber = itemNumberAt(index);
          const itemErrors = errors[item.key] ?? {};
          const messages = resultMessages.get(index) ?? [];
          const materialId = `item-${item.key}-material`;
          const quantityId = `item-${item.key}-quantity`;
          return (
            <li
              key={item.key}
              data-item={itemNumber}
              className="grid grid-cols-[3rem_1fr_2.5rem] items-start gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[4rem_1fr_11rem_2.5rem]"
            >
              <span className="pt-2 font-mono text-sm font-medium tabular-nums">
                {itemNumber}
              </span>

              <div className="col-start-2 row-start-1 min-w-0">
                <MaterialPicker
                  id={materialId}
                  label={`Material for item ${itemNumber}`}
                  selected={materials.get(item.materialNumber) ?? null}
                  search={search}
                  error={itemErrors.materialNumber}
                  onSelect={(option) =>
                    onChange(item.key, { materialNumber: option.materialNumber })
                  }
                  onEnterWithoutList={() => focusInput(quantityId)}
                />
                {itemErrors.materialNumber && (
                  <p id={`${materialId}-error`} role="alert" className="mt-1 text-xs text-danger">
                    {itemErrors.materialNumber}
                  </p>
                )}
              </div>

              <div className="col-start-2 sm:col-start-3 sm:row-start-1">
                <label htmlFor={quantityId} className="mb-1 block text-xs text-ink-muted sm:sr-only">
                  Quantity for item {itemNumber}
                </label>
                <div className="flex items-stretch">
                  <StepButton
                    label={`Decrease quantity for item ${itemNumber}`}
                    disabled={!canStepQuantity(item.quantity, -1)}
                    onClick={() => onChange(item.key, { quantity: stepQuantity(item.quantity, -1) })}
                    className="rounded-l-md border-r-0"
                  >
                    <MinusIcon className="size-4" />
                  </StepButton>
                  <input
                    id={quantityId}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={itemErrors.quantity ? true : undefined}
                    aria-describedby={itemErrors.quantity ? `${quantityId}-error` : undefined}
                    value={item.quantity}
                    onChange={(e) => onChange(item.key, { quantity: e.target.value })}
                    onKeyDown={(e) => {
                      // Enter moves on or adds the next item; it never
                      // submits the form. A held-down key is ignored.
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      if (!e.repeat) onQuantityEnter(item.key);
                    }}
                    className={`${inputClass(itemErrors.quantity)} min-w-0 rounded-none text-center tabular-nums`}
                  />
                  <StepButton
                    label={`Increase quantity for item ${itemNumber}`}
                    disabled={!canStepQuantity(item.quantity, 1)}
                    onClick={() => onChange(item.key, { quantity: stepQuantity(item.quantity, 1) })}
                    className="rounded-r-md border-l-0"
                  >
                    <PlusIcon className="size-4" />
                  </StepButton>
                </div>
                {itemErrors.quantity && (
                  <p id={`${quantityId}-error`} role="alert" className="mt-1 text-xs text-danger">
                    {itemErrors.quantity}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => onRemove(item.key)}
                aria-label={`Remove item ${itemNumber}`}
                title="Remove item"
                className="col-start-3 row-start-1 mt-0.5 grid size-9 place-items-center rounded-md text-ink-muted hover:bg-canvas hover:text-danger sm:col-start-4"
              >
                <CloseIcon className="size-4" />
              </button>

              {notice?.key === item.key && (
                <p
                  role="status"
                  data-item-notice
                  className="col-span-2 col-start-2 text-xs font-medium text-warning sm:col-span-3"
                >
                  {notice.text}
                </p>
              )}

              {messages.length > 0 && (
                <ul className="col-span-2 col-start-2 space-y-1 sm:col-span-3">
                  {messages.map((message) => (
                    <li
                      key={message.code}
                      className={`text-xs ${message.severity === "ERROR" ? "text-danger" : "text-ink-muted"}`}
                    >
                      {message.text}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
        <button
          type="button"
          onClick={onAdd}
          disabled={isFull}
          className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 font-medium hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusIcon />
          Add item
        </button>
        <span className="text-xs text-ink-muted">
          {isFull
            ? `The maximum of ${MAX_ITEMS} items is reached.`
            : `Quantities in pieces, 1 to ${MAX_QUANTITY.toLocaleString("en-US")}.`}
        </span>
      </div>
    </section>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid w-10 shrink-0 place-items-center border border-line bg-canvas text-ink hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

/** Focuses an input and marks its text, so typing replaces it */
export function focusInput(id: string) {
  const input = document.getElementById(id);
  if (input instanceof HTMLInputElement) {
    input.focus();
    input.select();
  }
}
