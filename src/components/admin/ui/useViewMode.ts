"use client";

import { useCallback, useEffect, useState } from "react";

export type ViewMode = "grid" | "table";
const PREFIX = "payless-admin-view:";

/**
 * Grid / table preference per admin section, remembered in this browser.
 * Without a saved preference, phones start on cards (tables are hard to read at 375 px).
 */
export function useViewMode(section: string, desktopDefault: ViewMode = "table"): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(desktopDefault);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(PREFIX + section);
    } catch {
      /* storage blocked: keep default */
    }
    if (saved === "grid" || saved === "table") setMode(saved);
    else if (window.matchMedia?.("(max-width: 767px)").matches) setMode("grid");
  }, [section]);

  const update = useCallback(
    (m: ViewMode) => {
      setMode(m);
      try {
        window.localStorage.setItem(PREFIX + section, m);
      } catch {
        /* ignore */
      }
    },
    [section]
  );

  return [mode, update];
}
