import type { Metadata } from "next";
import { Suspense } from "react";
import { SalesOrderConfirmation } from "@/components/sales-orders/sales-order-confirmation";

export async function generateMetadata({
  params,
}: PageProps<"/sales-orders/[salesOrderNumber]">): Promise<Metadata> {
  const { salesOrderNumber } = await params;
  return { title: `Sales Order ${salesOrderNumber}` };
}

// The order number and ?created= are only known at request time, so they
// are read inside <Suspense> (Cache Components): the page frame is
// prerendered, the confirmation streams in.
export default function SalesOrderPage({
  params,
  searchParams,
}: PageProps<"/sales-orders/[salesOrderNumber]">) {
  return (
    <Suspense
      fallback={
        <div
          aria-busy="true"
          aria-label="Loading sales order"
          className="mx-auto h-40 max-w-5xl animate-pulse rounded-lg border border-line bg-surface"
        />
      }
    >
      <Confirmation params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Confirmation({
  params,
  searchParams,
}: Pick<PageProps<"/sales-orders/[salesOrderNumber]">, "params" | "searchParams">) {
  const { salesOrderNumber } = await params;
  const { created } = await searchParams;
  return (
    <SalesOrderConfirmation
      salesOrderNumber={salesOrderNumber}
      created={typeof created === "string" ? created : undefined}
    />
  );
}
