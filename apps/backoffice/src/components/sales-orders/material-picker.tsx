"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  materialLabel,
  type MaterialOption,
  type MaterialSearch,
  type MaterialSearchResult,
} from "@/lib/material-search";
import { SearchIcon } from "../icons";
import { inputClass } from "../forms/form-controls";

/**
 * Searchable material selection (ARIA combobox with a listbox).
 * Type to search by material number or description; arrow keys move,
 * Enter selects, Escape closes. Leaving the field without choosing keeps
 * the selected material. The results come from `search`, which may be a
 * client-side filter today and a server request later.
 */
export function MaterialPicker({
  id,
  label,
  selected,
  search,
  error,
  disabled = false,
  onSelect,
  onEnterWithoutList,
}: {
  id: string;
  /** Accessible name, e.g. "Material for item 20" */
  label: string;
  selected: MaterialOption | null;
  search: MaterialSearch;
  error?: string;
  disabled?: boolean;
  onSelect: (option: MaterialOption) => void;
  /** Enter while no result list is open, e.g. to move on to the quantity */
  onEnterWithoutList?: () => void;
}) {
  const listId = useId();
  const errorId = `${id}-error`;
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<MaterialSearchResult>({ options: [], total: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Ignores a slow answer for an older query (relevant for a server search)
  const latestQuery = useRef("");

  async function runSearch(text: string) {
    latestQuery.current = text;
    const next = await search(text);
    if (latestQuery.current !== text) return;
    setResult(next);
    // Only a typed search activates the first result. When the list just
    // opens (e.g. on focus), Enter must not pick a material by accident.
    setActiveIndex(text.trim() === "" ? -1 : 0);
  }

  function open(text: string) {
    setIsOpen(true);
    setQuery(text);
    void runSearch(text);
  }

  function close() {
    setIsOpen(false);
    setQuery("");
  }

  function choose(option: MaterialOption) {
    onSelect(option);
    close();
    selectAfterChoice.current = true;
  }

  // After a choice, mark the shown material once it is rendered, so typing
  // again starts a new search instead of appending to "MAT-001 – Heat Pump"
  const selectAfterChoice = useRef(false);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (
      selectAfterChoice.current &&
      input &&
      selected &&
      !isOpen &&
      input.value === materialLabel(selected)
    ) {
      selectAfterChoice.current = false;
      if (document.activeElement === input) input.select();
    }
  });

  // Keep the active option visible while moving with the arrow keys
  useEffect(() => {
    if (!isOpen) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const count = result.options.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) open(query);
      else if (count > 0) setActiveIndex((i) => (i + 1 + count) % count);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (isOpen && count > 0) setActiveIndex((i) => (i <= 0 ? count - 1 : i - 1));
    } else if (event.key === "Enter") {
      // Never submit the form from the material field. Enter selects the
      // active result; without one it moves on (e.g. to the quantity).
      const option = isOpen ? result.options[activeIndex] : undefined;
      if (option) {
        event.preventDefault();
        choose(option);
      } else if (isOpen || onEnterWithoutList) {
        event.preventDefault();
        close();
        onEnterWithoutList?.();
      }
    } else if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        close();
      }
    }
  }

  const activeId =
    isOpen && activeIndex >= 0 && activeIndex < result.options.length
      ? `${listId}-${activeIndex}`
      : undefined;
  const shown = isOpen ? query : selected ? materialLabel(selected) : "";

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={selected ? undefined : "Search number or description"}
        value={shown}
        onFocus={() => open("")}
        onChange={(e) => open(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={close}
        className={`${inputClass(error)} pl-9`}
      />
      {isOpen && (
        <div className="absolute z-20 mt-1 w-full min-w-64 rounded-md border border-line bg-surface shadow-lg">
          {result.options.length === 0 ? (
            <p role="status" className="px-3 py-3 text-sm text-ink-muted">
              {query.trim() === ""
                ? "No materials available."
                : `No material matches “${query.trim()}”.`}
            </p>
          ) : (
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={`${label} – results`}
              className="max-h-64 overflow-y-auto py-1"
            >
              {result.options.map((option, index) => (
                <li
                  key={option.materialNumber}
                  id={`${listId}-${index}`}
                  data-index={index}
                  data-material={option.materialNumber}
                  role="option"
                  aria-selected={index === activeIndex}
                  // Keep the focus in the input, so blur does not close first
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`cursor-pointer px-3 py-2 ${index === activeIndex ? "bg-brand-soft" : ""}`}
                >
                  <span className="font-mono text-sm">{option.materialNumber}</span>
                  <span className="ml-2 text-sm">{option.description}</span>
                </li>
              ))}
            </ul>
          )}
          {result.total > result.options.length && (
            <p className="border-t border-line px-3 py-1.5 text-xs text-ink-muted">
              Showing {result.options.length} of {result.total}. Type to narrow the search.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
