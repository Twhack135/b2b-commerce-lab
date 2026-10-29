"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { listB2bUnits } from "@/lib/b2b-units";
import { ApiError, errorMessage } from "@/lib/erp-api";
import {
  clientMaterialSearch,
  toMaterialOption,
} from "@/lib/material-search";
import { listMaterials } from "@/lib/materials";
import {
  addItem,
  addItemAfter,
  emptySimulationForm,
  hasErrors,
  inputKey,
  quantityEnter,
  removeItem,
  selectUnit,
  toSimulationRequest,
  updateItem,
  validateSimulationForm,
  type HeaderField,
  type ItemField,
  type OrderSimulationValues,
} from "@/lib/order-simulation-form";
import {
  simulateSalesOrder,
  type SalesOrderSimulation,
} from "@/lib/sales-orders";
import {
  badRequestErrors,
  headerFieldMessages,
  itemMessagesByIndex,
  partnerRoleMessages,
} from "@/lib/simulation-display";
import { useListData } from "@/lib/use-list-data";
import { useToday } from "@/lib/use-today";
import { FormErrorAlert } from "../forms/form-controls";
import { LoadError, PageHeader } from "../list-page";
import { OrderHeaderForm } from "./order-header-form";
import { focusInput, OrderItemsEditor } from "./order-items-editor";
import { SimulationResult } from "./simulation-result";

type Simulated = { result: SalesOrderSimulation; inputKey: string };

/**
 * Read-only order simulation: enter an order for a B2B unit and let the ERP
 * API determine partners, prices and messages. Nothing is stored, and there
 * is deliberately no way to place the order here.
 */
export function OrderSimulation() {
  const units = useListData(listB2bUnits);
  const materials = useListData(listMaterials);
  // Pricing date = order date = today. The user cannot change it.
  // LIMITATION (Sprint 8B only): today is the date of the user's browser;
  // the ERP API must become authoritative for the order and pricing date
  // before real orders can be placed.
  const today = useToday();
  const pricingDate = today ?? "";

  const [values, setValues] = useState<OrderSimulationValues>(emptySimulationForm);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [badRequest, setBadRequest] = useState<ReturnType<typeof badRequestErrors> | null>(null);
  const [generalError, setGeneralError] = useState<string[] | null>(null);
  const [simulated, setSimulated] = useState<Simulated | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const simulatingRef = useRef(false);
  // Feedback for one item, e.g. why Enter did not add the next item
  const [itemNotice, setItemNotice] = useState<{ key: number; text: string } | null>(null);
  // An input to focus once it is rendered (the material of a new item)
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);

  useEffect(() => {
    if (focusRequest) focusInput(focusRequest.id);
  }, [focusRequest]);

  const form = values;

  const materialOptions = useMemo(
    () => (materials.items ?? []).map(toMaterialOption),
    [materials.items],
  );
  const materialsByNumber = useMemo(
    () => new Map(materialOptions.map((m) => [m.materialNumber, m])),
    [materialOptions],
  );
  const search = useMemo(() => clientMaterialSearch(materialOptions), [materialOptions]);

  const clientErrors = validateSimulationForm(form, units.items ?? [], pricingDate);
  const isOutdated =
    simulated !== null && simulated.inputKey !== inputKey(form, pricingDate);
  // Messages are only shown at the inputs while they belong to this input
  const current = simulated && !isOutdated ? simulated.result : null;

  const headerErrors: Partial<Record<HeaderField, string>> = {};
  const itemErrors: Record<number, Partial<Record<ItemField, string>>> = {};
  if (current) {
    const byField = headerFieldMessages(current);
    for (const field of ["unitId", "shipToCustomerNumber", "requestedDeliveryDate"] as const) {
      const firstError = byField[field]?.find((m) => m.severity === "ERROR");
      if (firstError) headerErrors[field] = firstError.text;
    }
  }
  if (badRequest) {
    Object.assign(headerErrors, badRequest.header);
    form.items.forEach((item, index) => {
      const errors = badRequest.items.get(index);
      if (errors) itemErrors[item.key] = { ...errors };
    });
  }
  if (submitAttempted) {
    Object.assign(headerErrors, clientErrors.header);
    for (const [key, errors] of Object.entries(clientErrors.items)) {
      itemErrors[Number(key)] = { ...itemErrors[Number(key)], ...errors };
    }
  }

  /**
   * Applies a change to the latest values (not to the values of the last
   * render), so quick successive actions such as several "Add item" clicks
   * are never lost
   */
  function change(update: (current: OrderSimulationValues) => OrderSimulationValues) {
    setValues(update);
    setBadRequest(null);
    setItemNotice(null);
  }

  /** Enter in a quantity: next item, or a new item after the last one */
  function handleQuantityEnter(key: number) {
    const result = quantityEnter(form, key);
    if (result.kind === "blocked") {
      setItemNotice({ key, text: result.reason });
    } else if (result.kind === "focus-next") {
      setItemNotice(null);
      focusInput(`item-${result.key}-material`);
    } else {
      // addItemAfter adds nothing if another Enter already added the row
      change((v) => addItemAfter(v, key));
      setFocusRequest({ id: `item-${result.key}-material` });
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (simulatingRef.current) return;
    setSubmitAttempted(true);
    setGeneralError(null);
    if (hasErrors(clientErrors)) {
      focusFirstError();
      return;
    }

    simulatingRef.current = true;
    setIsSimulating(true);
    const key = inputKey(form, pricingDate);
    try {
      const result = await simulateSalesOrder(toSimulationRequest(form, pricingDate));
      setSimulated({ result, inputKey: key });
      setBadRequest(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        const mapped = badRequestErrors(error.messages);
        setBadRequest(mapped);
        setGeneralError(
          mapped.other.length > 0
            ? mapped.other
            : ["The ERP API rejected the input. Please check the marked fields."],
        );
        focusFirstError();
      } else {
        setGeneralError([errorMessage(error)]);
      }
    } finally {
      simulatingRef.current = false;
      setIsSimulating(false);
    }
  }

  function reset() {
    setValues(emptySimulationForm());
    setSubmitAttempted(false);
    setBadRequest(null);
    setGeneralError(null);
    setSimulated(null);
    setItemNotice(null);
  }

  const loadError = units.loadError ?? materials.loadError;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Sales"
        title="Order Simulation"
        description="Check an order for a B2B unit before it is placed: partners, prices and business messages."
      />

      <div
        role="note"
        className="mt-6 rounded-md border border-brand/30 bg-brand-soft px-4 py-3 text-sm"
      >
        <p className="font-medium text-brand-strong">Read-only simulation</p>
        <p className="mt-0.5 text-ink">
          No sales order is created, no delivery block is set and no stock is
          reserved. A valid simulation does not guarantee that the order can
          be delivered: stock, delivery date, freight, tax and credit are not
          checked.
        </p>
      </div>

      {loadError ? (
        <div className="mt-6 rounded-lg border border-line bg-surface">
          <LoadError
            title="Master data could not be loaded"
            message={loadError}
            isRetrying={units.isLoading || materials.isLoading}
            onRetry={() => {
              units.reload();
              materials.reload();
            }}
          />
        </div>
      ) : (
        <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-6">
          {generalError && <FormErrorAlert messages={generalError} />}

          <OrderHeaderForm
            values={form}
            units={units.items}
            unitsError={units.loadError}
            errors={headerErrors}
            partnerMessages={current ? partnerRoleMessages(current) : {}}
            fieldMessages={current ? headerFieldMessages(current) : {}}
            onSelectUnit={(unitId) =>
              change((v) => selectUnit(v, units.items?.find((u) => u.unitId === unitId)))
            }
            orderDate={today}
            onChange={(changes) => change((v) => ({ ...v, ...changes }))}
          />

          <OrderItemsEditor
            items={form.items}
            errors={itemErrors}
            itemListError={submitAttempted ? clientErrors.itemList : undefined}
            resultMessages={current ? itemMessagesByIndex(current) : new Map()}
            materials={materialsByNumber}
            search={search}
            onChange={(key, changes) => change((v) => updateItem(v, key, changes))}
            onAdd={() => change(addItem)}
            onRemove={(key) => change((v) => removeItem(v, key))}
            notice={itemNotice}
            onQuantityEnter={handleQuantityEnter}
          />

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={reset}
              disabled={isSimulating}
              className="rounded-md border border-line bg-surface px-4 py-2 font-medium hover:bg-canvas disabled:opacity-50"
            >
              Reset
            </button>
            <button
              type="submit"
              disabled={
                isSimulating ||
                units.items === null ||
                materials.items === null ||
                today === null
              }
              className="rounded-md bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {isSimulating ? "Simulating…" : "Simulate Order"}
            </button>
          </div>
        </form>
      )}

      {simulated && (
        <div className="mt-6">
          <SimulationResult result={simulated.result} isOutdated={isOutdated} />
        </div>
      )}
    </div>
  );
}

/** Moves the focus to the first marked input after the errors are shown */
function focusFirstError() {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}
