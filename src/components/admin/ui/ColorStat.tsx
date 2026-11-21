import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

const TONES = {
  blue: "from-[#2f7cf6] to-[#1557d6]",
  green: "from-[#2fbf6a] to-[#169a4b]",
  orange: "from-[#ffa62b] to-[#f07800]",
  purple: "from-[#8357ea] to-[#5a35c8]",
  navy: "from-[#123a8f] to-[#0a2463]",
  red: "from-[#f05a5a] to-[#d42f2f]",
} as const;

/** Coloured indicator card (mock-up style): icon, big white figure, label, large faded icon. */
export function ColorStat({
  tone,
  icon: Icon,
  value,
  label,
  sub,
  onClick,
}: {
  tone: keyof typeof TONES;
  icon: LucideIcon;
  value: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${TONES[tone]} p-4 sm:p-5 text-left text-white shadow-lg shadow-black/10 min-w-0 ${onClick ? "transition-transform hover:-translate-y-0.5" : ""}`}
    >
      <Icon className="absolute -right-3 -bottom-3 w-24 h-24 opacity-20" aria-hidden />
      <Icon className="w-8 h-8 drop-shadow" aria-hidden />
      <div className="mt-2 text-2xl sm:text-3xl font-black tracking-tight leading-none truncate">{value}</div>
      <div className="mt-1 text-sm font-semibold text-white/95 leading-snug line-clamp-2">{label}</div>
      {sub && <div className="mt-1 text-[11px] text-white/80 truncate">{sub}</div>}
    </Tag>
  );
}
