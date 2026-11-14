"use client";

import { OptionIcon } from "@/components/ui/OptionIcon";
import { onlySelected } from "@/lib/extras";
import { cn } from "@/lib/utils";

export interface BookedOption {
  name?: string;
  quantity?: number;
  icon?: string;
  lineTotal?: number;
  price?: number;
}

interface Props {
  options?: BookedOption[] | null;
  title?: string;
  /** Rendered when the booking has no selected option. Pass null to render nothing. */
  emptyLabel?: string | null;
  showAmounts?: boolean;
  className?: string;
  variant?: "light" | "dark";
}

const fmtTnd = (minor: number) => `${(minor / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} TND`;

/**
 * Displays ONLY the options the customer selected (quantity ≥ 1), with their icons.
 * Used by the customer tracking page and the admin reservation views.
 */
export function SelectedOptionsList({
  options,
  title = "Options choisies",
  emptyLabel = "Aucune option",
  showAmounts = true,
  className,
  variant = "light",
}: Props) {
  const selected = onlySelected(options);
  if (selected.length === 0 && emptyLabel === null) return null;

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className={cn(
          "text-[11px] font-bold uppercase tracking-wider",
          variant === "dark" ? "text-slate-400" : "text-slate-500"
        )}
      >
        {title}
      </div>
      {selected.length === 0 ? (
        <p className="text-xs text-slate-400 italic">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1.5">
          {selected.map((opt, i) => (
            <li key={`${opt.name}-${i}`} className="flex items-center gap-2.5 text-xs min-w-0">
              <OptionIcon icon={opt.icon} size="sm" />
              <span className="flex-1 min-w-0 truncate font-medium" title={opt.name}>
                {opt.name}
                {(opt.quantity ?? 1) > 1 && <span className="ml-1 font-mono text-slate-400">×{opt.quantity}</span>}
              </span>
              {showAmounts && typeof opt.lineTotal === "number" && (
                <span className="font-mono font-semibold shrink-0">
                  {opt.lineTotal === 0 ? <span className="text-emerald-600">Offert</span> : `+${fmtTnd(opt.lineTotal)}`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
