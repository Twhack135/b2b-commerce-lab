// Calendar dates (without time) such as validity periods and pricing dates.
// The API uses "YYYY-MM-DD" text. PostgreSQL DATE columns arrive in
// JavaScript as Date objects at midnight UTC, so all conversions use UTC and
// never the time zone of the server.

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// Earlier years are rejected: JavaScript reads the years 0 to 99 as 1900 to 1999
const MIN_YEAR = 1900;

/**
 * True for an existing calendar day in the form YYYY-MM-DD between the years
 * 1900 and 9999, e.g. not 2026-02-30
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
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

/** Only call this for a value that passed isCalendarDate */
export function toDbDate(text: string): Date {
  return new Date(`${text}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
