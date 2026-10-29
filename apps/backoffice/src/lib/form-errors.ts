// Turns ERP API validation messages into form field errors.
// This file has no imports, so it can be tested directly with `node --test`.

export const GENERIC_VALIDATION_MESSAGE =
  "The ERP API rejected the input. Please check the fields.";

/**
 * NestJS validation messages start with the field name,
 * e.g. "price must have at most two decimal places".
 * Messages for known fields are shown at that field (first one wins);
 * all other messages are returned separately.
 */
export function splitValidationMessages<Field extends string>(
  messages: string[],
  fields: readonly Field[],
) {
  const fieldErrors: Partial<Record<Field, string>> = {};
  const otherMessages: string[] = [];

  for (const message of messages) {
    const field = fields.find((name) => message.startsWith(`${name} `));
    if (!field) {
      otherMessages.push(toSentence(message));
    } else if (!fieldErrors[field]) {
      fieldErrors[field] = toSentence(message);
    }
  }

  return { fieldErrors, otherMessages };
}

function toSentence(message: string) {
  return message.charAt(0).toUpperCase() + message.slice(1) + ".";
}
