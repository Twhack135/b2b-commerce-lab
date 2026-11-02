import { ACCESS_LABELS, ACTIVATION_LABELS } from "@/lib/shop-user-display";
import type { ShopUserSummary } from "@/lib/shop-users";
import { ToneBadge } from "./badges";

export function ShopUserTable({
  users,
  onSelect,
}: {
  users: ShopUserSummary[];
  onSelect: (user: ShopUserSummary) => void;
}) {
  return (
    <div className="overflow-x-auto">
      {/* On small screens the account moves below the name and the units,
          sessions and Manage columns are hidden; tapping a row opens it */}
      <table className="w-full text-left">
        <thead className="bg-canvas/60 text-xs tracking-wide text-ink-muted uppercase">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              User
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
              Customer Account
            </th>
            <th scope="col" className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">
              Units
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">
              Activation
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Access
            </th>
            <th scope="col" className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">
              Open Sessions
            </th>
            <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {users.map((user) => {
            const access = ACCESS_LABELS[user.access];
            const activation = ACTIVATION_LABELS[user.activation];
            return (
              <tr
                key={user.id}
                data-shop-user={user.email}
                onClick={() => onSelect(user)}
                className="cursor-pointer align-top hover:bg-brand-soft/50"
              >
                <td className="px-4 py-3">
                  <div className={`font-medium ${user.access === "GRANTED" ? "" : "text-ink-muted"}`}>{user.displayName}</div>
                  <div className="text-xs break-all text-ink-muted">{user.email}</div>
                  <div className="mt-1 text-xs text-ink-muted md:hidden">
                    <span className="font-mono">{user.account.customerNumber}</span> · {user.unitCount}{" "}
                    {user.unitCount === 1 ? "unit" : "units"}
                  </div>
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <div className="font-mono text-xs">{user.account.customerNumber}</div>
                  <div className="text-xs text-ink-muted">
                    {user.account.name}
                    {!user.account.isActive && <span className="ml-1 font-medium text-danger">(inactive)</span>}
                  </div>
                </td>
                <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">{user.unitCount}</td>
                <td className="hidden px-4 py-3 lg:table-cell">
                  <ToneBadge {...activation} />
                </td>
                <td className="px-4 py-3">
                  <ToneBadge {...access} />
                </td>
                <td className="hidden px-4 py-3 text-right tabular-nums lg:table-cell">{user.activeSessionCount}</td>
                <td className="hidden px-4 py-3 text-right sm:table-cell">
                  {/* The button makes the details reachable by keyboard */}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(user);
                    }}
                    className="rounded-md px-2 py-1 font-medium text-brand hover:bg-brand-soft"
                  >
                    Manage<span className="sr-only"> {user.email}</span>
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
