"use client";

import { useState } from "react";
import { listMaterials, type Material } from "@/lib/materials";
import { useListData } from "@/lib/use-list-data";
import {
  EmptyState,
  LoadError,
  LoadingRows,
  PageHeader,
  RefreshButton,
  SearchInput,
  SuccessNotice,
} from "../list-page";
import { MaterialForm } from "./material-form";
import { MaterialTable } from "./material-table";

type Panel = { mode: "create" } | { mode: "edit"; material: Material } | null;

export function MaterialManagement() {
  const {
    items: materials,
    isLoading,
    loadError,
    reload,
  } = useListData(listMaterials);

  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      <PageHeader
        title="Material Management"
        description="Create and maintain materials of the ERP material master. Prices are maintained per sales area in Pricing."
        actionLabel="New Material"
        onAction={() => {
          setNotice(null);
          setPanel({ mode: "create" });
        }}
      />

      {notice && (
        <SuccessNotice message={notice} onDismiss={() => setNotice(null)} />
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
            <SearchInput
              label="Search materials"
              placeholder="Search number or description"
              value={search}
              onChange={setSearch}
            />
            <RefreshButton isLoading={isLoading} onClick={reload} />
          </div>
        </div>

        {loadError ? (
          <LoadError
            title="Materials could not be loaded"
            message={loadError}
            isRetrying={isLoading}
            onRetry={reload}
          />
        ) : materials === null ? (
          <LoadingRows label="Loading materials" />
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
