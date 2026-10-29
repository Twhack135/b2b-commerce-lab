import type { Metadata } from "next";
import { B2bUnitManagement } from "@/components/b2b-units/b2b-unit-management";

export const metadata: Metadata = {
  title: "B2B Units",
};

export default function B2bUnitsPage() {
  return <B2bUnitManagement />;
}
