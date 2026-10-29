// Form validation for customers.
// Mirrors the ERP API DTO rules (apps/erp-api/src/customers/dto) so users get
// feedback before submitting. The ERP API stays the authoritative check.
import { COUNTRY_CODES } from "./country-codes.ts";

// Field lengths, matching the ERP API and the database columns
export const MAX_LENGTH = {
  customerNumber: 20,
  name: 100,
  street: 100,
  postalCode: 10,
  city: 60,
} as const;

/** Form values; text fields are sent trimmed, except the customer number */
export type CustomerFormValues = {
  customerNumber: string;
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  isActive: boolean;
};

export type CustomerFormField = Exclude<keyof CustomerFormValues, "isActive">;

export type CustomerFieldErrors = Partial<Record<CustomerFormField, string>>;

const POSTAL_CODE_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9 -]*[A-Za-z0-9])?$/;

export function validateCustomerForm(
  values: CustomerFormValues,
  mode: "create" | "edit",
): CustomerFieldErrors {
  const errors: CustomerFieldErrors = {};

  if (mode === "create") {
    const number = values.customerNumber;
    if (number.trim() === "") {
      errors.customerNumber = "Customer number is required.";
    } else if (number.trim() !== number) {
      // Rejected instead of trimmed, so the stored key is exactly what was typed
      errors.customerNumber =
        "Customer number must not start or end with a space.";
    } else if (number.length > MAX_LENGTH.customerNumber) {
      errors.customerNumber = `Use at most ${MAX_LENGTH.customerNumber} characters.`;
    }
  }

  requiredText(errors, "name", "Name", values.name);
  requiredText(errors, "street", "Street", values.street);
  requiredText(errors, "city", "City", values.city);

  const postalCode = values.postalCode.trim();
  if (postalCode === "") {
    errors.postalCode = "Postal code is required.";
  } else if (!POSTAL_CODE_PATTERN.test(postalCode)) {
    errors.postalCode = "Use only letters, digits, spaces and hyphens.";
  } else if (postalCode.length > MAX_LENGTH.postalCode) {
    errors.postalCode = `Use at most ${MAX_LENGTH.postalCode} characters.`;
  }

  if (values.country === "") {
    errors.country = "Select a country.";
  } else if (!COUNTRY_CODES.includes(values.country)) {
    errors.country = "Select a valid country.";
  }

  return errors;
}

function requiredText(
  errors: CustomerFieldErrors,
  field: "name" | "street" | "city",
  label: string,
  value: string,
) {
  const text = value.trim();
  if (text === "") {
    errors[field] = `${label} is required.`;
  } else if (text.length > MAX_LENGTH[field]) {
    errors[field] = `Use at most ${MAX_LENGTH[field]} characters.`;
  }
}
