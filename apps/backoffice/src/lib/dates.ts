// Calendar dates as YYYY-MM-DD text, as used by the ERP pricing API.
// Text in this form compares like dates, so no Date objects are needed.
// This file has no imports, so it can be tested directly with `node --test`.

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// Same range as the ERP API
const MIN_YEAR = 1900;

/** True for an existing day between 1900-01-01 and 9999-12-31, e.g. not 2026-02-30 */
export function isCalendarDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  if (year < MIN_YEAR) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Today in the user's own time zone. Only used as a visible, editable
 * default and for the validity badges; prices are always determined for
 * the date that is sent to the ERP API.
 */
export function todayIsoDate(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
