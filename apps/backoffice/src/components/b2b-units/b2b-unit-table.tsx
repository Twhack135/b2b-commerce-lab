import { inactivePartnerWarnings } from "@/lib/b2b-unit-form";
import type { B2bUnit, PartnerSummary } from "@/lib/b2b-units";
import { AlertIcon } from "../icons";
import { StatusBadge } from "../list-page";

export function B2bUnitTable({
  units,
  onSelect,
}: {
  units: B2bUnit[];
  onSelect: (unit: B2bUnit) => void;
}) {
  return (
    <div className="overflow-x-auto">
      {/* On small screens the account moves below the name and the Sold-to,
          ship-to count and Edit columns are hidden; tapping a row opens it */}
      <table className="w-full text-left">
        <thead className="bg-canvas/60 text-xs tracking-wide text-ink-muted uppercase">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Unit ID
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Name
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
              Account
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">
              Sold-to
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
              Default Ship-to
            </th>
            <th scope="col" className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">
              Ship-tos
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Status
            </th>
            <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {units.map((unit) => {
            const warnings = inactivePartnerWarnings(unit);
            const defaultShipTo = unit.shipTos.find((s) => s.isDefault);
            return (
              <tr
                key={unit.unitId}
                onClick={() => onSelect(unit)}
                className="cursor-pointer align-top hover:bg-brand-soft/50"
              >
                <td className="px-4 py-3 font-mono font-medium whitespace-nowrap text-brand-strong">
                  {unit.unitId}
                </td>
                <td className="px-4 py-3">
                  <div className={unit.isActive ? "" : "text-ink-muted"}>{unit.name}</div>
                  <div className="text-xs text-ink-muted md:hidden">
                    Account{" "}
                    <span className="whitespace-nowrap">{unit.account.customerNumber}</span>
                  </div>
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <Partner partner={unit.account} />
                </td>
                <td className="hidden px-4 py-3 lg:table-cell">
                  <Partner partner={unit.soldTo} />
                </td>
                <td className="hidden px-4 py-3 sm:table-cell">
                  {defaultShipTo && <Partner partner={defaultShipTo} />}
                </td>
                <td className="hidden px-4 py-3 text-right tabular-nums lg:table-cell">
                  {unit.shipTos.length}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1.5">
                    <StatusBadge isActive={unit.isActive} />
                    {warnings.length > 0 && (
                      <span
                        title={warnings.join("\n")}
                        className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium whitespace-nowrap text-danger"
                      >
                        <AlertIcon className="size-3.5" />
                        {warnings.length}
                        {/* Short on small screens; the full list is in the tooltip */}
                        <span className="hidden sm:inline">
                          {warnings.length === 1 ? " inactive partner" : " inactive partners"}
                        </span>
                        <span className="sr-only">: {warnings.join(" ")}</span>
                      </span>
                    )}
                  </div>
                </td>
                <td className="hidden px-4 py-3 text-right sm:table-cell">
                  {/* The button makes editing reachable by keyboard */}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(unit);
                    }}
                    className="rounded-md px-2 py-1 font-medium text-brand hover:bg-brand-soft"
                  >
                    Edit<span className="sr-only"> {unit.unitId}</span>
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

/** Customer number and name; inactive partners are marked */
function Partner({ partner }: { partner: PartnerSummary }) {
  return (
    <div className={partner.isActive ? "" : "text-danger"}>
      <div className="font-mono text-xs">{partner.customerNumber}</div>
      <div className="text-xs text-ink-muted">
        {partner.name}
        {!partner.isActive && <span className="ml-1 font-medium text-danger">(inactive)</span>}
      </div>
    </div>
  );
}
