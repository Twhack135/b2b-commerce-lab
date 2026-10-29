import type { Metadata } from "next";
import { PricingManagement } from "@/components/pricing/pricing-management";

export const metadata: Metadata = {
  title: "Pricing",
};

export default function PricingPage() {
  return <PricingManagement />;
}
