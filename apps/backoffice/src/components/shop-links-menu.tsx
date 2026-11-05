"use client";

import { useEffect, useRef, useState } from "react";
import type { ShopLink } from "@/lib/shop-links";

/**
 * "Open Shop": the configured customer shops, each opened in a new tab
 * (noopener, noreferrer). Environments without an address are shown, but
 * disabled, so it is visible what is missing (docs/local-setup.md).
 */
export function ShopLinksMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [links, setLinks] = useState<ShopLink[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Loaded when the menu is opened the first time
  useEffect(() => {
    if (!isOpen || links) return;
    let isCurrent = true;
    fetch("/api/shop-links", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<ShopLink[]>) : Promise.reject(new Error())))
      .then(
        (loaded) => isCurrent && setLinks(loaded),
        () => isCurrent && setLoadFailed(true),
      );
    return () => {
      isCurrent = false;
    };
  }, [isOpen, links]);

  // Closes on Escape and on a click outside
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isOpen]);

  return (
    <div ref={menuRef} className="relative" data-shop-links>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="shop-links-list"
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-canvas"
      >
        Open Shop
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true" className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {isOpen && (
        <div id="shop-links-list" className="absolute right-0 z-30 mt-2 w-64 rounded-lg border border-line bg-surface py-1 shadow-lg">
          {loadFailed ? (
            <p className="px-4 py-2 text-sm text-danger">The shop addresses could not be loaded.</p>
          ) : links === null ? (
            <p className="px-4 py-2 text-sm text-ink-muted" aria-busy="true">
              Loading…
            </p>
          ) : (
            <ul>
              {links.map((link) => (
                <li key={link.key}>
                  {link.url ? (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-shop-link={link.key}
                      onClick={() => setIsOpen(false)}
                      className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-canvas"
                    >
                      <span>
                        <span className="block font-medium">{link.label}</span>
                        <span className="block font-mono text-xs break-all text-ink-muted">{link.url}</span>
                      </span>
                      <span aria-hidden="true" className="text-ink-muted">
                        ↗
                      </span>
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    <span
                      aria-disabled="true"
                      data-shop-link={link.key}
                      data-unconfigured
                      className="flex cursor-not-allowed items-center justify-between gap-3 px-4 py-2 text-sm text-ink-muted"
                    >
                      {link.label}
                      <span className="rounded-full border border-line px-2 py-0.5 text-[10px] tracking-wide uppercase">
                        Not configured
                      </span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
