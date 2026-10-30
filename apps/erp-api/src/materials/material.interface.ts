export interface Material {
  materialNumber: string;
  description: string;
  /**
   * DEPRECATED since Sprint 9C-B: no longer used for pricing; list prices
   * are ZP01 price conditions per sales area. null if never set.
   */
  price: number | null;
  currency: string | null;
}
