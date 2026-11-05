"use client";

import dynamic from "next/dynamic";

/**
 * The activation and password reset form runs in the browser only: the
 * token is in the URL fragment, which the server never receives. Until it
 * is loaded, a quiet placeholder of the same height is shown.
 */
export const ActivationFormLoader = dynamic(
  () => import("./activation-form").then((module) => module.ActivationForm),
  { ssr: false, loading: () => <div className="h-72" aria-busy="true" /> },
);
