import { COUNTRY_CODES } from "./country-codes";

// Country names come from the browser's built-in data, so we don't need
// to maintain 249 names ourselves
const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string) {
  return displayNames.of(code) ?? code;
}

/** All countries for a select field, sorted by name */
export const COUNTRY_OPTIONS = COUNTRY_CODES.map((code) => ({
  code,
  name: countryName(code),
})).sort((a, b) => a.name.localeCompare(b.name, "en"));
