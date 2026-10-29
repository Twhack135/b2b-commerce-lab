import type { Metadata } from "next";
import { OrderSimulation } from "@/components/sales-orders/order-simulation";

export const metadata: Metadata = {
  title: "Order Simulation",
};

export default function OrderSimulationPage() {
  return <OrderSimulation />;
}
