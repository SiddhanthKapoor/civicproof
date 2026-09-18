"use client";

import { useEffect } from "react";

/** Scrolls the highlighted excerpt into the middle of the viewport once the page loads. */
export function ScrollToHit({ id = "hit" }: { id?: string }) {
  useEffect(() => {
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 250);
    return () => clearTimeout(t);
  }, [id]);
  return null;
}
