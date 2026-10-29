// Turns ERP API validation messages into form field errors.
// This file has no imports, so it can be tested directly with `node --test`.

export const GENERIC_VALIDATION_MESSAGE =
  "The ERP API rejected the input. Please check the fields.";

/**
 * The field a NestJS validation message belongs to. Messages usually start
 * with the field name ("price must ..."). Rules for list entries use two
 * other forms: "each value in shipToCustomerNumbers must ..." and
 * "All shipToCustomerNumbers's elements must be unique".
 */
export function fieldOfMessage<Field extends string>(
  message: string,
  fields: readonly Field[],
): Field | undefined {
  const subject = message
    .replace(/^each value in /, "")
    .replace(/^All (\S+)'s elements /, "$1 ");
  return fields.find((name) => subject.startsWith(`${name} `));
}

/**
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
    const field = fieldOfMessage(message, fields);
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
