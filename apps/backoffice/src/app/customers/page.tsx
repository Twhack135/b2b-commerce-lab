import type { Metadata } from "next";
import { CustomerManagement } from "@/components/customers/customer-management";

export const metadata: Metadata = {
  title: "Customer Management",
};

export default function CustomersPage() {
  return <CustomerManagement />;
}
