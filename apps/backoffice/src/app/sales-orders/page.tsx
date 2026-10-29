import { redirect } from "next/navigation";

// Sales Orders currently only offers the simulation; the order list follows
// once orders can be placed
export default function SalesOrdersPage() {
  redirect("/sales-orders/simulation");
}
