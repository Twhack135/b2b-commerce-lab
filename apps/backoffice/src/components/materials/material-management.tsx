"use client";

import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/erp-api";
import { listMaterials, type Material } from "@/lib/materials";
import {
  AlertIcon,
  CheckIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
} from "../icons";
import { MaterialForm } from "./material-form";
import { MaterialTable } from "./material-table";

type Panel = { mode: "create" } | { mode: "edit"; material: Material } | null;

export function MaterialManagement() {
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Increasing this number triggers a reload of the list
  const [reloadCount, setReloadCount] = useState(0);

  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    listMaterials().then(
      (data) => {
        if (!isCurrent) return;
        setMaterials(data);
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
  }, [reloadCount]);

  function reload() {
    setIsLoading(true);
    setReloadCount((count) => count + 1);
  }

  function handleSaved(material: Material, mode: "create" | "edit") {
    setPanel(null);
    setNotice(
      mode === "create"
        ? `Material ${material.materialNumber} was created.`
        : `Material ${material.materialNumber} was updated.`,
    );
    reload();
  }

  const query = search.trim().toLowerCase();
  const visibleMaterials = (materials ?? []).filter(
    (material) =>
      material.materialNumber.toLowerCase().includes(query) ||
      material.description.toLowerCase().includes(query),
  );

  return (
    <div className="mx-auto max-w-6xl">
      {/* Page title and main actions */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
            Master Data
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Material Management</h1>
          <p className="mt-1 text-ink-muted">
            Create and maintain materials of the ERP material master.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setPanel({ mode: "create" });
          }}
          className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 font-medium text-white shadow-sm hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <PlusIcon />
          New Material
        </button>
      </div>

      {notice && (
        <div
          role="status"
          className="mt-6 flex items-center gap-2 rounded-md border border-success/30 bg-success-soft px-4 py-3 text-success"
        >
          <CheckIcon />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* List card */}
      <section
        aria-label="Materials"
        className="mt-6 rounded-lg border border-line bg-surface shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-semibold">
            Materials
            {materials && (
              <span className="ml-2 font-normal text-ink-muted">
                ({query ? `${visibleMaterials.length} of ` : ""}
                {materials.length})
              </span>
            )}
          </h2>

          <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
            <label className="relative flex-1 sm:w-72 sm:flex-none">
              <span className="sr-only">Search materials</span>
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search number or description"
                className="w-full rounded-md border border-line py-2 pr-3 pl-9 outline-none placeholder:text-ink-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </label>
            <button
              type="button"
              onClick={reload}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 font-medium hover:bg-canvas disabled:opacity-60"
            >
              <RefreshIcon className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {loadError ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <div className="grid size-10 place-items-center rounded-full bg-danger-soft text-danger">
              <AlertIcon className="size-5" />
            </div>
            <div>
              <p className="font-semibold">Materials could not be loaded</p>
              <p className="mt-1 text-ink-muted">{loadError}</p>
            </div>
            <button
              type="button"
              onClick={reload}
              disabled={isLoading}
              className="rounded-md bg-brand px-4 py-2 font-medium text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {isLoading ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : materials === null ? (
          <LoadingRows />
        ) : materials.length === 0 ? (
          <EmptyState
            title="No materials yet"
            text="Create the first material to get started."
          />
        ) : visibleMaterials.length === 0 ? (
          <EmptyState
            title="No matching materials"
            text={`Nothing matches “${search.trim()}”.`}
          />
        ) : (
          <MaterialTable
            materials={visibleMaterials}
            onSelect={(material) => {
              setNotice(null);
              setPanel({ mode: "edit", material });
            }}
          />
        )}
      </section>

      {panel && (
        <MaterialForm
          // A new key resets the form when another material is opened
          key={panel.mode === "edit" ? panel.material.materialNumber : "new"}
          material={panel.mode === "edit" ? panel.material : undefined}
          onClose={() => setPanel(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function LoadingRows() {
  return (
    <div aria-busy="true" aria-label="Loading materials" className="divide-y divide-line">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex animate-pulse gap-6 px-4 py-4">
          <div className="h-4 w-24 rounded bg-canvas" />
          <div className="h-4 flex-1 rounded bg-canvas" />
          <div className="h-4 w-20 rounded bg-canvas" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-ink-muted">{text}</p>
    </div>
  );
}
