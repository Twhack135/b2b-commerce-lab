import type { Metadata } from "next";
import { MaterialManagement } from "@/components/materials/material-management";

export const metadata: Metadata = {
  title: "Material Management",
};

export default function MaterialsPage() {
  return <MaterialManagement />;
}
