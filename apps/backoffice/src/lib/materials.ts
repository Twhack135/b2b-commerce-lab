import { erpFetch } from "./erp-api";

/** A material as returned by the ERP API */
export type Material = {
  materialNumber: string;
  description: string;
  price: number;
  currency: string;
};

export type MaterialChanges = Omit<Material, "materialNumber">;

export function listMaterials() {
  return erpFetch<Material[]>("/materials");
}

export function createMaterial(material: Material) {
  return erpFetch<Material>("/materials", { method: "POST", body: material });
}

export function updateMaterial(
  materialNumber: string,
  changes: MaterialChanges,
) {
  return erpFetch<Material>(`/materials/${encodeURIComponent(materialNumber)}`, {
    method: "PATCH",
    body: changes,
  });
}

export function formatPrice(price: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
}
