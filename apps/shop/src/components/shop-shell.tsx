// The frame of every shop page: header with navigation, content, footer.
// Areas that do not exist yet are shown as "Soon" and are not links; there
// is deliberately no sign-in, so nothing looks like working access control.

import Link from "next/link";

const NAV_ITEMS = ["Catalog", "Quick Order", "My Orders", "Account"];

export function ShopShell({ children }: { children: React.ReactNode }) {
  return (
    <div data-shop-shell className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-md bg-brand text-xs font-bold text-white">
              BC
            </span>
            <span className="leading-tight">
              <span className="block font-semibold">B2B Commerce Lab</span>
              <span className="block text-xs text-ink-muted">Customer Shop</span>
            </span>
          </Link>

          <span
            data-preview-badge
            className="ml-auto rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-warning sm:order-last"
          >
            Development preview
          </span>

          <nav aria-label="Shop" className="w-full sm:w-auto">
            <ul className="flex flex-wrap gap-1">
              {NAV_ITEMS.map((label) => (
                <li key={label}>
                  <span
                    data-nav-item={label}
                    aria-disabled="true"
                    title="Not available yet"
                    className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md px-3 py-1.5 text-ink-muted"
                  >
                    {label}
                    <span className="rounded-full border border-line px-1.5 text-[10px] tracking-wide uppercase">
                      Soon
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>

      <footer className="bg-shell text-white/70">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs sm:px-6">
          B2B Commerce Lab · Customer Shop · Development preview, runs on this computer only
        </div>
      </footer>
    </div>
  );
}
