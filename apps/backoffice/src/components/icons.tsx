// A few simple line icons, so we don't need an icon library
type IconProps = { className?: string };

function Icon({ className, d }: IconProps & { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? "size-4"}
    >
      <path d={d} />
    </svg>
  );
}

export const BoxIcon = (p: IconProps) => (
  <Icon {...p} d="M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8" />
);
export const UsersIcon = (p: IconProps) => (
  <Icon
    {...p}
    d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 19v-1a4 4 0 0 0-3-3.87M16 3.13a3.5 3.5 0 0 1 0 6.75"
  />
);
export const BuildingIcon = (p: IconProps) => (
  <Icon
    {...p}
    d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4"
  />
);
export const TagIcon = (p: IconProps) => (
  <Icon
    {...p}
    d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01"
  />
);
export const WarehouseIcon = (p: IconProps) => (
  <Icon {...p} d="M3 21V8l9-5 9 5v13M7 21v-8h10v8M7 17h10" />
);
export const CartIcon = (p: IconProps) => (
  <Icon
    {...p}
    d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.8h7.7a2 2 0 0 0 2-1.6L21 8H6M10 21h.01M17 21h.01"
  />
);
export const SearchIcon = (p: IconProps) => (
  <Icon {...p} d="m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" />
);
export const RefreshIcon = (p: IconProps) => (
  <Icon
    {...p}
    d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"
  />
);
export const PlusIcon = (p: IconProps) => <Icon {...p} d="M12 5v14M5 12h14" />;
export const MinusIcon = (p: IconProps) => <Icon {...p} d="M5 12h14" />;
export const CloseIcon = (p: IconProps) => (
  <Icon {...p} d="M18 6 6 18M6 6l12 12" />
);
export const MenuIcon = (p: IconProps) => (
  <Icon {...p} d="M4 6h16M4 12h16M4 18h16" />
);
export const AlertIcon = (p: IconProps) => (
  <Icon {...p} d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
);
export const CheckIcon = (p: IconProps) => (
  <Icon {...p} d="M20 6 9 17l-5-5" />
);
