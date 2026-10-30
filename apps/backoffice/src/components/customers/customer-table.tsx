import { countryName } from "@/lib/countries";
import type { Customer } from "@/lib/customers";
import { salesAreaId, salesAreaName } from "@/lib/sales-area-display";
import type { SalesArea } from "@/lib/sales-areas";
import { StatusBadge } from "../list-page";

export function CustomerTable({
  customers,
  salesAreas,
  onSelect,
}: {
  customers: Customer[];
  /** For the names of the sales areas; null while loading */
  salesAreas: SalesArea[] | null;
  onSelect: (customer: Customer) => void;
}) {
  return (
    <div className="overflow-x-auto">
      {/* On small screens the city moves below the name, the city, country,
          sales area and Edit columns are hidden, and tapping a row opens the
          customer */}
      <table className="w-full text-left">
        <thead className="bg-canvas/60 text-xs tracking-wide text-ink-muted uppercase">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Customer Number
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Name
            </th>
            <th
              scope="col"
              className="hidden px-4 py-2.5 font-medium sm:table-cell"
            >
              City
            </th>
            <th
              scope="col"
              className="hidden px-4 py-2.5 font-medium md:table-cell"
            >
              Country
            </th>
            <th
              scope="col"
              className="hidden px-4 py-2.5 font-medium lg:table-cell"
            >
              Sales Areas
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
          {customers.map((customer) => (
            <tr
              key={customer.customerNumber}
              onClick={() => onSelect(customer)}
              className="cursor-pointer hover:bg-brand-soft/50"
            >
              <td className="px-4 py-3 font-mono font-medium whitespace-nowrap text-brand-strong">
                {customer.customerNumber}
              </td>
              <td className="px-4 py-3">
                <div className={customer.isActive ? "" : "text-ink-muted"}>
                  {customer.name}
                </div>
                <div className="hidden text-xs text-ink-muted sm:block">
                  {customer.street}
                </div>
                <div className="text-xs text-ink-muted sm:hidden">
                  {customer.postalCode} {customer.city}
                </div>
              </td>
              <td className="hidden px-4 py-3 sm:table-cell">
                <span className="text-ink-muted tabular-nums">
                  {customer.postalCode}
                </span>{" "}
                {customer.city}
              </td>
              <td className="hidden px-4 py-3 md:table-cell">
                <span className="font-mono text-ink-muted">
                  {customer.country}
                </span>{" "}
                <span className="text-ink-muted">
                  {countryName(customer.country)}
                </span>
              </td>
              <td className="hidden px-4 py-3 lg:table-cell">
                <SalesAreaChips customer={customer} salesAreas={salesAreas} />
              </td>
              <td className="px-4 py-3">
                <StatusBadge isActive={customer.isActive} />
              </td>
              <td className="hidden px-4 py-3 text-right sm:table-cell">
                {/* The button makes editing reachable by keyboard */}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(customer);
                  }}
                  className="rounded-md px-2 py-1 font-medium text-brand hover:bg-brand-soft"
                >
                  Edit<span className="sr-only"> {customer.customerNumber}</span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The customer's sales areas; inactive assignments are marked */
function SalesAreaChips({
  customer,
  salesAreas,
}: {
  customer: Customer;
  salesAreas: SalesArea[] | null;
}) {
  if (customer.salesAreas.length === 0) {
    return <span className="text-xs text-ink-muted">None</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1">
      {customer.salesAreas.map((assignment) => (
        <li
          key={salesAreaId(assignment)}
          title={`${salesAreaName(salesAreas, assignment)}${assignment.isActive ? "" : " (inactive)"}`}
          className={`rounded-full px-2 py-0.5 font-mono text-xs whitespace-nowrap ${
            assignment.isActive
              ? "bg-brand-soft text-brand-strong"
              : "bg-canvas text-ink-muted line-through"
          }`}
        >
          {salesAreaId(assignment)}
          {!assignment.isActive && <span className="sr-only"> (inactive)</span>}
        </li>
      ))}
    </ul>
  );
}
