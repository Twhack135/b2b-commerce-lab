// Material search for order positions. The order editor only knows the
// MaterialSearch function, so the client-side search below can later be
// replaced by a server-side search without changing the editor.
// Only type imports, so it can be tested directly with `node --test`.
import type { Material } from "./materials.ts";

export type MaterialOption = {
  materialNumber: string;
  description: string;
  currency: string;
};

export type MaterialSearchResult = {
  options: MaterialOption[];
  /** Number of all matches; more than options.length if cut off */
  total: number;
};

/** Returns the matches of a query; may be asynchronous (server search) */
export type MaterialSearch = (
  query: string,
) => MaterialSearchResult | Promise<MaterialSearchResult>;

/** Shown at most at once; the user can refine the search for more */
export const MAX_MATERIAL_OPTIONS = 50;

export function toMaterialOption(material: Material): MaterialOption {
  return {
    materialNumber: material.materialNumber,
    description: material.description,
    currency: material.currency,
  };
}

/**
 * Case-insensitive search in material number and description. Every word
 * of the query must occur, e.g. "therm 002". Exact and prefix matches of the
 * material number come first, then the others by material number.
 */
export function filterMaterials(
  materials: MaterialOption[],
  query: string,
  limit = MAX_MATERIAL_OPTIONS,
): MaterialSearchResult {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = materials.filter((m) => {
    const text = `${m.materialNumber} ${m.description}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });

  const q = query.trim().toLowerCase();
  const rank = (m: MaterialOption) => {
    const number = m.materialNumber.toLowerCase();
    if (q !== "" && number === q) return 0;
    if (q !== "" && number.startsWith(q)) return 1;
    return 2;
  };
  matches.sort(
    (a, b) =>
      rank(a) - rank(b) || a.materialNumber.localeCompare(b.materialNumber),
  );
  return { options: matches.slice(0, limit), total: matches.length };
}

/** A MaterialSearch over already loaded materials */
export function clientMaterialSearch(materials: MaterialOption[]): MaterialSearch {
  return (query) => filterMaterials(materials, query);
}

export function materialLabel(option: MaterialOption) {
  return `${option.materialNumber} – ${option.description}`;
}
