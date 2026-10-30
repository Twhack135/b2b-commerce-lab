// Form validation for materials.
// Mirrors the ERP API DTO rules (apps/erp-api/src/materials/dto) so users get
// feedback before submitting. The ERP API stays the authoritative check.
// This file has no imports, so it can be tested directly with `node --test`.
//
// A material has no price of its own: prices are maintained per sales area
// in Pricing (list price ZP01 and customer prices).

export type MaterialFormValues = {
  materialNumber: string;
  description: string;
};

export type MaterialFormField = keyof MaterialFormValues;

export type FieldErrors = Partial<Record<MaterialFormField, string>>;

export function validateMaterialForm(
  values: MaterialFormValues,
  mode: "create" | "edit",
): FieldErrors {
  const errors: FieldErrors = {};

  if (mode === "create") {
    if (values.materialNumber.trim() === "") {
      errors.materialNumber = "Material number is required.";
    } else if (values.materialNumber.trim() !== values.materialNumber) {
      // Rejected instead of trimmed, so the stored key is exactly what was typed
      errors.materialNumber =
        "Material number must not start or end with a space.";
    }
  }

  if (values.description.trim() === "") {
    errors.description = "Description is required.";
  }

  return errors;
}
