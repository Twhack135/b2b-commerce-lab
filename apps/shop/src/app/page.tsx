const PLANNED = [
  {
    title: "Your B2B units",
    text: "Order for the locations your company has authorized you for, with their ship-to addresses.",
  },
  {
    title: "Your customer prices",
    text: "Net prices from your contract conditions, in the currency of your sales area.",
  },
  {
    title: "Simulate before you order",
    text: "See prices, partners and messages before an order becomes binding.",
  },
  {
    title: "Your order history",
    text: "Find the orders of your units and their confirmations.",
  },
];

/** Placeholder start page: describes the shop, offers no function yet */
export default function HomePage() {
  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">Customer Shop</p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Ordering for business customers</h1>
        <p className="mt-2 max-w-2xl text-base text-ink-muted">
          The shop of the B2B Commerce Lab: business customers will order here with their own
          prices, units and delivery addresses, directly from the ERP.
        </p>
      </section>

      <div
        role="note"
        data-preview-notice
        className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-warning"
      >
        <p className="font-semibold">Development preview</p>
        <p className="mt-1">
          Signing in and choosing your ordering unit work already. Catalog, prices and ordering are not
          available yet: this preview shows no prices and accepts no orders.
        </p>
      </div>

      <section aria-labelledby="planned-title">
        <h2 id="planned-title" className="font-semibold">
          Planned
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {PLANNED.map((item) => (
            <li key={item.title} className="rounded-lg border border-line bg-surface px-4 py-3 shadow-sm">
              <p className="font-medium">{item.title}</p>
              <p className="mt-1 text-ink-muted">{item.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
