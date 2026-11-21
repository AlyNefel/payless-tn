"use client";

import React, { useState } from "react";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max"> & {
  value: number | null | undefined;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Used when the field is left empty (defaults to `min`, else 0). */
  fallback?: number;
  /** Allow decimals (keypad with a decimal point on phones). */
  decimal?: boolean;
};

/**
 * Number field that can be cleared while typing: on a phone the admin can erase "1" and type "7"
 * without the old value coming back. The value is clamped to [min, max] only when the field is left.
 */
export function NumberInput({ value, onValueChange, min, max, fallback, decimal, onFocus, onBlur, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null); // non-null only while the admin is typing
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const shown = draft ?? (value === null || value === undefined || Number.isNaN(value) ? "" : String(value));

  return (
    <input
      {...rest}
      type="number"
      inputMode={decimal ? "decimal" : "numeric"}
      min={min}
      max={max}
      value={shown}
      onFocus={(e) => {
        setDraft(shown);
        e.currentTarget.select(); // typing replaces the current number
        onFocus?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const n = decimal ? parseFloat(raw) : parseInt(raw, 10);
        if (raw.trim() !== "" && Number.isFinite(n)) onValueChange(n);
      }}
      onBlur={(e) => {
        const raw = (draft ?? "").trim();
        const n = decimal ? parseFloat(raw) : parseInt(raw, 10);
        const final = clamp(raw === "" || !Number.isFinite(n) ? fallback ?? min ?? 0 : n);
        setDraft(null);
        if (final !== value) onValueChange(final);
        onBlur?.(e);
      }}
    />
  );
}
