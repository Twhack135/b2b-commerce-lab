"use client";

import { useState } from "react";
import { listB2bUnits } from "@/lib/b2b-units";
import { listCustomerAccounts } from "@/lib/customer-accounts";
import { filterCounts, filterShopUsers, type ShopUserFilter } from "@/lib/shop-user-display";
import { listShopUsers, type ShopUserDetail } from "@/lib/shop-users";
import { useListData } from "@/lib/use-list-data";
import {
  EmptyState,
  LoadError,
  LoadingRows,
  PageHeader,
  RefreshButton,
  SearchInput,
  SuccessNotice,
} from "../list-page";
import { LocalOnlyNotice } from "./badges";
import { ShopUserCreateForm } from "./shop-user-create-form";
import { ShopUserDetailPanel } from "./shop-user-detail";
import { ShopUserTable } from "./shop-user-table";

type Panel = { kind: "create" } | { kind: "detail"; userId: string } | null;

const FILTERS: { value: ShopUserFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "access", label: "With access" },
  { value: "no-access", label: "No access" },
];

/**
 * Shop users: the people of customer accounts who use the customer shop,
 * with their B2B units, activation and sessions (Sprint 12C).
 */
export function ShopUserManagement() {
  const users = useListData(listShopUsers);
  // For the account and unit choices
  const accounts = useListData(listCustomerAccounts);
  const units = useListData(listB2bUnits);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ShopUserFilter>("all");
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reloadAll() {
    users.reload();
    accounts.reload();
    units.reload();
  }

  function handleCreated(user: ShopUserDetail) {
    setNotice(`Shop user ${user.email} was created. Next step: create an activation link.`);
    users.reload();
    setPanel({ kind: "detail", userId: user.id });
  }

  const all = users.items ?? [];
  const visible = filterShopUsers(all, search, filter);
  const counts = filterCounts(all);
  const isFiltered = search.trim() !== "" || filter !== "all";
  const pending = all.filter((user) => user.activation !== "ACTIVATED").length;
  const sessions = all.reduce((sum, user) => sum + user.activeSessionCount, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Customer Shop"
        title="Shop Users"
        description="People of customer accounts who sign in to the customer shop, with the B2B units they may act for."
        actionLabel="New Shop User"
        onAction={() => {
          setNotice(null);
          setPanel({ kind: "create" });
        }}
      />

      <LocalOnlyNotice />

      {notice && <SuccessNotice message={notice} onDismiss={() => setNotice(null)} />}

      {/* Key figures of the list; each one is also a filter or search below */}
      {users.items && users.items.length > 0 && (
        <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-shop-user-figures>
          <Figure label="Shop users" value={counts.all} />
          <Figure label="With access" value={counts.access} />
          <Figure label="Not yet activated" value={pending} />
          <Figure label="Open sessions" value={sessions} />
        </dl>
      )}

      <section aria-label="Shop users" className="mt-6 rounded-lg border border-line bg-surface shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-semibold">
            Shop Users
            {users.items && (
              <span className="ml-2 font-normal text-ink-muted">
                ({isFiltered ? `${visible.length} of ` : ""}
                {users.items.length})
              </span>
            )}
          </h2>

          <div role="radiogroup" aria-label="Filter by access" className="inline-flex rounded-md border border-line p-0.5">
            {FILTERS.map((option) => {
              const isSelected = filter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setFilter(option.value)}
                  className={`rounded px-3 py-1 text-xs font-medium ${isSelected ? "bg-brand text-white" : "text-ink-muted hover:bg-canvas"}`}
                >
                  {option.label}
                  {users.items && <span className="ml-1 opacity-75">{counts[option.value]}</span>}
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
            <SearchInput label="Search shop users" placeholder="Search name, e-mail or account" value={search} onChange={setSearch} />
            <RefreshButton isLoading={users.isLoading || accounts.isLoading || units.isLoading} onClick={reloadAll} />
          </div>
        </div>

        {users.loadError ? (
          <LoadError title="Shop users could not be loaded" message={users.loadError} isRetrying={users.isLoading} onRetry={reloadAll} />
        ) : users.items === null ? (
          <LoadingRows label="Loading shop users" />
        ) : users.items.length === 0 ? (
          <EmptyState title="No shop users yet" text="Create the first shop user for a customer account with “New Shop User”." />
        ) : visible.length === 0 ? (
          <EmptyState title="No matching shop users" text="Change the search or the filter." />
        ) : (
          <ShopUserTable
            users={visible}
            onSelect={(user) => {
              setNotice(null);
              setPanel({ kind: "detail", userId: user.id });
            }}
          />
        )}
      </section>

      {panel?.kind === "create" && (
        <ShopUserCreateForm accounts={accounts.items} units={units.items} onClose={() => setPanel(null)} onCreated={handleCreated} />
      )}

      {panel?.kind === "detail" && (
        <ShopUserDetailPanel
          // A new key loads another user from scratch
          key={panel.userId}
          userId={panel.userId}
          units={units.items}
          onClose={() => setPanel(null)}
          onChanged={users.reload}
        />
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3 shadow-sm">
      <dt className="text-xs font-medium tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
