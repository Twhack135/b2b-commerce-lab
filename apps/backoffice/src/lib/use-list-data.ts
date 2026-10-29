"use client";

import { useEffect, useState } from "react";
import { errorMessage } from "./erp-api";

/**
 * Loads a list from the ERP API and reloads it on demand.
 * `load` must be a stable function, e.g. listMaterials from lib/materials.
 */
export function useListData<T>(load: () => Promise<T[]>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Increasing this number triggers a reload of the list
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    load().then(
      (data) => {
        if (!isCurrent) return;
        setItems(data);
        setLoadError(null);
        setIsLoading(false);
      },
      (error: unknown) => {
        if (!isCurrent) return;
        setLoadError(errorMessage(error));
        setIsLoading(false);
      },
    );
    // Ignore a response that arrives after a newer reload was started
    return () => {
      isCurrent = false;
    };
  }, [load, reloadCount]);

  function reload() {
    setIsLoading(true);
    setReloadCount((count) => count + 1);
  }

  return { items, isLoading, loadError, reload };
}
