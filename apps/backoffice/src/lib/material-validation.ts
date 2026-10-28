// Form validation for materials.
// Mirrors the ERP API DTO rules (apps/erp-api/src/materials/dto) so users get
// feedback before submitting. The ERP API stays the authoritative check.
// This file has no imports, so it can be tested directly with `node --test`.

/** Largest value that fits into the database column Decimal(12, 2) */
export const MAX_PRICE = 9_999_999_999.99;

/** Form inputs are text; price is converted to a number on submit */
export type MaterialFormValues = {
  materialNumber: string;
  description: string;
  price: string;
  currency: string;
};

export type MaterialFormField = keyof MaterialFormValues;

export type FieldErrors = Partial<Record<MaterialFormField, string>>;

/** Accepts "349.99" and "349,99" */
function normalizePrice(text: string) {
  return text.trim().replace(",", ".");
}

/** Only call this for a price that passed validateMaterialForm */
export function parsePrice(text: string): number {
  return Number(normalizePrice(text));
}

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

  const price = normalizePrice(values.price);
  if (price === "") {
    errors.price = "Price is required.";
  } else if (!/^\d+(\.\d+)?$/.test(price)) {
    errors.price = "Enter a number, for example 349.99.";
  } else if (/\.\d{3,}$/.test(price)) {
    errors.price = "Use at most two decimal places.";
  } else if (Number(price) < 0.01) {
    errors.price = "Price must be at least 0.01.";
  } else if (Number(price) > MAX_PRICE) {
    errors.price = "Price must not exceed 9,999,999,999.99.";
  }

  if (!/^[A-Z]{3}$/.test(values.currency)) {
    errors.currency = "Use a three-letter currency code, for example EUR.";
  }

  return errors;
}
