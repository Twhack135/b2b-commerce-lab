import { erpFetch } from "./erp-api";

/**
 * A material as returned by the ERP API. Its former price and currency
 * are deprecated: prices are maintained per sales area in Pricing (ZP01).
 * The ERP API still returns them, but the Backoffice neither shows nor
 * sends them.
 */
export type Material = {
  materialNumber: string;
  description: string;
  /** DEPRECATED, never used for pricing */
  price?: number | null;
  /** DEPRECATED, never used for pricing */
  currency?: string | null;
};

export type MaterialInput = { materialNumber: string; description: string };

export type MaterialChanges = Omit<MaterialInput, "materialNumber">;

export function listMaterials() {
  return erpFetch<Material[]>("/materials");
}

export function createMaterial(material: MaterialInput) {
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
