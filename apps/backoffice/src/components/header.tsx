import { MenuIcon } from "./icons";

export function Header({ onOpenNav }: { onOpenNav: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="-ml-1 rounded-md p-1.5 text-ink-muted hover:bg-canvas lg:hidden"
      >
        <MenuIcon className="size-5" />
      </button>

      <span className="font-semibold">ERP Backoffice</span>

      <span className="ml-auto rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong">
        Development
      </span>
    </header>
  );
}
