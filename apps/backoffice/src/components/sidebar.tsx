"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BoxIcon,
  BuildingIcon,
  CartIcon,
  TagIcon,
  UsersIcon,
  WarehouseIcon,
} from "./icons";

type NavItem = {
  label: string;
  icon: (props: { className?: string }) => React.ReactNode;
  // Modules without a href are not implemented yet
  href?: string;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Materials", href: "/materials", icon: BoxIcon },
  { label: "Customers", href: "/customers", icon: UsersIcon },
  { label: "B2B Units", href: "/b2b-units", icon: BuildingIcon },
  { label: "Pricing", href: "/pricing", icon: TagIcon },
  { label: "Inventory", icon: WarehouseIcon },
  { label: "Sales Orders", href: "/sales-orders", icon: CartIcon },
];

export function Sidebar({
  isOpen,
  onNavigate,
}: {
  isOpen: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-shell text-white transition-transform lg:static lg:translate-x-0 ${
        isOpen ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex h-14 items-center gap-3 border-b border-white/10 px-5">
        <div className="grid size-8 place-items-center rounded-md bg-brand text-xs font-bold">
          BC
        </div>
        <div className="leading-tight">
          <div className="font-semibold">B2B Commerce Lab</div>
          <div className="text-xs text-white/60">ERP Backoffice</div>
        </div>
      </div>

      <nav aria-label="Modules" className="flex-1 px-3 py-4">
        <p className="px-3 pb-2 text-xs font-medium tracking-wide text-white/50 uppercase">
          Modules
        </p>
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;

            if (!item.href) {
              return (
                <li key={item.label}>
                  <span
                    aria-disabled="true"
                    title="Not implemented yet"
                    className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-white/40"
                  >
                    <Icon className="size-4" />
                    <span className="flex-1">{item.label}</span>
                    <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] tracking-wide uppercase">
                      Soon
                    </span>
                  </span>
                </li>
              );
            }

            const isActive = pathname.startsWith(item.href);
            return (
              <li key={item.label}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 transition-colors ${
                    isActive
                      ? "bg-shell-muted font-medium text-white shadow-[inset_3px_0_0_var(--color-brand)]"
                      : "text-white/80 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <p className="border-t border-white/10 px-5 py-3 text-xs text-white/40">
        Modules marked “Soon” are not implemented yet.
      </p>
    </aside>
  );
}
