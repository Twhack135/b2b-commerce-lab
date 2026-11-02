"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  selectSalesArea,
  selectUnit,
  toSimulationRequest,
  updateItem,
  validateSimulationForm,
  type HeaderField,
  type ItemField,
  type OrderSimulationValues,
} from "@/lib/order-simulation-form";
import {
  changedPricesByItem,
  clearPendingRequest,
  CONCURRENT_RETRY_DELAYS_MS,
  creationBlocker,
  creationOutcome,
  parsePendingRequest,
  readPendingText,
  savePendingRequest,
  toCreateRequest,
  type ChangedItemPrice,
  type CreationOutcome,
} from "@/lib/order-creation";
import {
  createSalesOrder,
  simulateSalesOrder,
  type CreateSalesOrderRequest,
  type SalesOrderSimulation,
  type SimulationRequest,
} from "@/lib/sales-orders";
import {
  badRequestErrors,
  headerFieldMessages,
  itemMessagesByIndex,
  partnerRoleMessages,
} from "@/lib/simulation-display";
import { currencyDecimals } from "@/lib/sales-area-display";
import { listSalesAreas } from "@/lib/sales-areas";
import { useListData } from "@/lib/use-list-data";
import { useToday } from "@/lib/use-today";
import { FormErrorAlert } from "../forms/form-controls";
import { LoadError, PageHeader } from "../list-page";
import { CreateOrderPanel, type CreationState } from "./create-order-panel";
import { OrderHeaderForm } from "./order-header-form";
import { focusInput, OrderItemsEditor } from "./order-items-editor";
import { SimulationResult } from "./simulation-result";

/** A simulation result with the exact request and input it belongs to */
type Simulated = {
  result: SalesOrderSimulation;
  inputKey: string;
  request: SimulationRequest;
};

const IDLE: CreationState = { phase: "idle" };

/** The session storage, or undefined where it cannot be used */
function sessionStore(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const noSubscription = () => () => {};

/**
 * Order simulation: enter an order for a B2B unit and let the ERP API
 * determine partners, prices and messages. A simulation stores nothing; a
 * valid simulation can then be confirmed as a permanent sales order.
 */
export function OrderSimulation() {
  const router = useRouter();
  const units = useListData(listB2bUnits);
  const materials = useListData(listMaterials);
  // The shop context: the first field of the order header
  const salesAreas = useListData(listSalesAreas);
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
  // Creating a sales order from the simulation
  const [creationState, setCreation] = useState<CreationState>(IDLE);
  const creatingRef = useRef(false);
  // Prices that changed since the user confirmed them (409 PRICE_CHANGED)
  const [changedPrices, setChangedPrices] = useState<Map<number, ChangedItemPrice> | null>(null);

  // A creation whose result is unknown survives a reload (session storage):
  // it can only be repeated unchanged, never replaced by a new request
  const pendingText = useSyncExternalStore(
    noSubscription,
    () => readPendingText(sessionStore()),
    () => null,
  );
  const recovered = useMemo(() => parsePendingRequest(pendingText), [pendingText]);
  const creation: CreationState =
    creationState.phase === "idle" && recovered
      ? {
          phase: "answered",
          request: recovered,
          outcome: {
            kind: "retry",
            reason: "UNCERTAIN",
            messages: [
              "A sales order creation was started earlier and its result is not known.",
            ],
          },
        }
      : creationState;

  useEffect(() => {
    if (focusRequest) focusInput(focusRequest.id);
  }, [focusRequest]);

  // An answer of the ERP API to a creation may be far below the visible part
  // of the page: show it once it is rendered
  useEffect(() => {
    if (creationState.phase === "answered") {
      document
        .querySelector("[data-creation-outcome]")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [creationState]);

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

  const clientErrors = validateSimulationForm(
    form,
    units.items ?? [],
    pricingDate,
    salesAreas.items ?? [],
  );
  const isOutdated =
    simulated !== null && simulated.inputKey !== inputKey(form, pricingDate);
  // While an order is being created, or its result is unknown, the input
  // must not change: only the same request may be repeated
  const isLocked =
    creation.phase === "submitting" ||
    (creation.phase === "answered" && creation.outcome.kind === "retry");
  const blocker = creationBlocker(simulated, isOutdated);
  // Messages are only shown at the inputs while they belong to this input
  const current = simulated && !isOutdated ? simulated.result : null;

  const headerErrors: Partial<Record<HeaderField, string>> = {};
  const itemErrors: Record<number, Partial<Record<ItemField, string>>> = {};
  if (current) {
    const byField = headerFieldMessages(current);
    for (const field of ["salesArea", "unitId", "shipToCustomerNumber", "requestedDeliveryDate"] as const) {
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
    if (isLocked) return;
    setValues(update);
    setBadRequest(null);
    setItemNotice(null);
    // An answer about the previous input no longer applies
    setCreation(IDLE);
    setChangedPrices(null);
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
    if (simulatingRef.current || isLocked) return;
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
      const request = toSimulationRequest(form, pricingDate);
      const result = await simulateSalesOrder(request);
      setSimulated({ result, inputKey: key, request });
      setBadRequest(null);
      setCreation(IDLE);
      setChangedPrices(null);
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
    if (isLocked) return;
    clearOrder();
    setCreation(IDLE);
  }

  /** An empty order: form, result and answers of the previous order are gone */
  function clearOrder() {
    setValues(emptySimulationForm());
    setChangedPrices(null);
    setSubmitAttempted(false);
    setBadRequest(null);
    setGeneralError(null);
    setSimulated(null);
    setItemNotice(null);
  }

  /** Opens the confirmation step for the current simulation */
  function openCreation() {
    if (blocker || isLocked || creatingRef.current) return;
    setCreation({ phase: "confirming" });
  }

  /** The user confirmed: a new creation attempt with a new request ID */
  function confirmCreation() {
    if (!simulated || blocker || creatingRef.current) return;
    void submitCreation(toCreateRequest(simulated, crypto.randomUUID()));
  }

  /** Repeats the unanswered request exactly as it was sent */
  function retryCreation() {
    if (creation.phase !== "answered" || creation.outcome.kind !== "retry") return;
    void submitCreation(creation.request);
  }

  async function submitCreation(request: CreateSalesOrderRequest) {
    if (creatingRef.current) return;
    creatingRef.current = true;
    savePendingRequest(sessionStore(), request);
    setCreation({ phase: "submitting", request });

    let outcome: CreationOutcome;
    for (let attempt = 0; ; attempt++) {
      try {
        outcome = creationOutcome(await createSalesOrder(request));
      } catch (error) {
        outcome = creationOutcome({ error });
      }
      // A concurrent change stored nothing; the same request is safe to repeat
      const delay = CONCURRENT_RETRY_DELAYS_MS[attempt];
      if (outcome.kind === "retry" && outcome.reason === "CONCURRENT_UPDATE" && delay !== undefined) {
        await wait(delay);
        continue;
      }
      break;
    }
    creatingRef.current = false;
    // Only an unknown result must be kept for a repetition
    if (outcome.kind !== "retry") clearPendingRequest(sessionStore());

    if (outcome.kind === "created") {
      // The order is done. Next.js keeps the state of this page while the
      // confirmation is shown (Cache Components) and restores it on the way
      // back, so the page must not keep the finished creation (it would stay
      // locked as "submitting"): it starts a new, empty order instead.
      clearOrder();
      setCreation({
        phase: "created",
        salesOrderNumber: outcome.order.salesOrderNumber,
        replayed: outcome.replayed,
      });
      router.push(
        `/sales-orders/${outcome.order.salesOrderNumber}?created=${outcome.replayed ? "existing" : "new"}`,
      );
      return;
    }
    if ((outcome.kind === "price-changed" || outcome.kind === "invalid") && simulated) {
      // The current evaluation of the ERP API replaces the old result; the
      // input is unchanged (it was locked), so it belongs to the input
      setSimulated({ ...simulated, result: outcome.evaluation });
      setChangedPrices(
        outcome.kind === "price-changed" ? changedPricesByItem(outcome.changedItems) : null,
      );
    }
    setCreation({ phase: "answered", request, outcome });
  }

  const loadError = units.loadError ?? materials.loadError ?? salesAreas.loadError;
  // The document currency of the result, or of a recovered pending request
  const resultCurrency =
    simulated?.result.currency ??
    (creation.phase === "answered" || creation.phase === "submitting"
      ? creation.request.expectedTotal.currency
      : null);
  const decimals = resultCurrency ? currencyDecimals(salesAreas.items, resultCurrency) : undefined;

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
        <p className="font-medium text-brand-strong">Simulation first</p>
        <p className="mt-0.5 text-ink">
          Simulating stores nothing: no sales order is created, no delivery block
          is set and no stock is reserved. A sales order is only created when you
          choose Create Sales Order and confirm it. A valid simulation does not
          guarantee that the order can be delivered: stock, delivery date,
          freight, tax and credit are not checked.
        </p>
      </div>

      {loadError ? (
        <div className="mt-6 rounded-lg border border-line bg-surface">
          <LoadError
            title="Master data could not be loaded"
            message={loadError}
            isRetrying={units.isLoading || materials.isLoading || salesAreas.isLoading}
            onRetry={() => {
              units.reload();
              materials.reload();
              salesAreas.reload();
            }}
          />
        </div>
      ) : (
        <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-6">
          {generalError && <FormErrorAlert messages={generalError} />}

          {/* Locked while an order is created or its result is unknown */}
          <fieldset
            disabled={isLocked}
            data-locked={isLocked || undefined}
            className="min-w-0 space-y-6"
          >
            <OrderHeaderForm
              values={form}
              salesAreas={salesAreas.items}
              salesAreasError={salesAreas.loadError}
              onSelectSalesArea={(salesArea) =>
                change((v) => selectSalesArea(v, salesArea, units.items ?? []))
              }
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
          </fieldset>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={reset}
              disabled={isSimulating || isLocked}
              className="rounded-md border border-line bg-surface px-4 py-2 font-medium hover:bg-canvas disabled:opacity-50"
            >
              Reset
            </button>
            <button
              type="submit"
              disabled={
                isSimulating ||
                isLocked ||
                units.items === null ||
                materials.items === null ||
                salesAreas.items === null ||
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
          <SimulationResult
            result={simulated.result}
            isOutdated={isOutdated}
            decimals={decimals}
            changedPrices={isOutdated ? undefined : (changedPrices ?? undefined)}
          />
        </div>
      )}

      {(simulated || creation.phase !== "idle") && !loadError && (
        <div className="mt-6">
          <CreateOrderPanel
            result={simulated && !isOutdated ? simulated.result : null}
            blocker={blocker}
            creation={creation}
            decimals={decimals}
            onOpen={openCreation}
            onCancel={() => setCreation(IDLE)}
            onConfirm={confirmCreation}
            onRetry={retryCreation}
          />
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
