import type { Metadata } from "next";
import { Suspense } from "react";
import { SalesOrderOverview } from "@/components/sales-orders/sales-order-overview";

export const metadata: Metadata = {
  title: "Sales Orders",
};

// Search, filters and the page are only known at request time (the URL
// query), so the overview is read inside <Suspense> (Cache Components)
export default function SalesOrdersPage() {
  return (
    <Suspense
      fallback={
        <div
          aria-busy="true"
          aria-label="Loading sales orders"
          className="mx-auto h-40 max-w-7xl animate-pulse rounded-lg border border-line bg-surface"
        />
      }
    >
      <SalesOrderOverview />
    </Suspense>
  );
}
