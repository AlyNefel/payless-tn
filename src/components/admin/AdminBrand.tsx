"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin, MessageCircle, Phone, Globe } from "lucide-react";

export interface AgencyInfo {
  legalName: string;
  address: string;
  city: string;
  phone: string;
  whatsapp: string;
  website: string;
}

const DEFAULT: AgencyInfo = { legalName: "Houimli Rent a Car SARL", address: "", city: "", phone: "", whatsapp: "", website: "" };
let cache: AgencyInfo | null = null;
let inflight: Promise<AgencyInfo> | null = null;

/** One request per tab, shared by the logo, the sidebar address and the footer. */
function loadAgencyInfo(): Promise<AgencyInfo> {
  if (!inflight) {
    inflight = fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        const s = (d?.settings || {}) as Record<string, unknown>;
        const str = (...k: string[]) => k.map((x) => String(s[x] || "").trim()).find(Boolean) || "";
        cache = {
          legalName: str("legalName", "legal_name") || DEFAULT.legalName,
          address: str("address", "siege_social"),
          city: str("city", "ville"),
          phone: str("phone", "phone_primary"),
          whatsapp: str("whatsapp", "phone_secondary"),
          website: str("website", "site_web"),
        };
        return cache;
      })
      .catch(() => {
        inflight = null;
        return DEFAULT;
      });
  }
  return inflight;
}

/** Agency identity from Paramètres (public settings), loaded once per tab. */
export function useAgencyInfo(): AgencyInfo {
  const [info, setInfo] = useState<AgencyInfo>(cache || DEFAULT);
  useEffect(() => {
    if (cache) return;
    let alive = true;
    loadAgencyInfo().then((v) => alive && setInfo(v));
    return () => {
      alive = false;
    };
  }, []);
  return info;
}

/** "HOUIMLI / RENT A CAR SARL / Votre partenaire de voyage" logo block of the sidebar. */
export function BrandBlock({ compact = false }: { compact?: boolean }) {
  const { legalName } = useAgencyInfo();
  const [first, ...rest] = legalName.split(" ");
  return (
    <Link href="/admin" className="block text-center select-none group" aria-label={`${legalName} — tableau de bord`}>
      <svg viewBox="0 0 120 34" className={`${compact ? "w-16" : "w-24"} mx-auto -mb-1 text-white/90 group-hover:text-white transition-colors`} aria-hidden>
        <path d="M6 26c3-7 12-12 26-14 10-6 22-9 38-7 12 1 22 6 30 12 6 1 11 4 14 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M40 12c10-5 24-6 36-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".7" />
      </svg>
      <div className={`${compact ? "text-lg" : "text-[26px]"} font-black italic tracking-wide text-white leading-none drop-shadow`}>{first.toUpperCase()}</div>
      <div className={`${compact ? "text-[10px]" : "text-[13px]"} font-extrabold italic tracking-[0.12em] text-white leading-tight`}>{rest.join(" ").toUpperCase()}</div>
      <div className="mx-auto mt-1 h-[3px] w-24 rounded-full bg-gradient-to-r from-transparent via-red-500 to-transparent" />
      {!compact && <div className="mt-2 text-[15px] text-white/95 italic font-semibold" style={{ fontFamily: "'Brush Script MT', 'Segoe Script', cursive" }}>Votre partenaire de voyage</div>}
    </Link>
  );
}

/** Decorative Tunisian scene (amphitheatre and palm trees) + agency address at the bottom of the sidebar. */
export function SidebarScene() {
  const info = useAgencyInfo();
  const place = [info.address, info.city].filter(Boolean).join(", ");
  return (
    <div className="relative shrink-0 overflow-hidden">
      <svg viewBox="0 0 280 110" className="w-full h-auto block" aria-hidden>
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0d3488" stopOpacity="0" />
            <stop offset="1" stopColor="#5b8de8" stopOpacity=".55" />
          </linearGradient>
        </defs>
        <rect width="280" height="110" fill="url(#sky)" />
        {/* amphitheatre */}
        <g fill="#c9d8f5" opacity=".9">
          <path d="M40 104V58q70-26 150 0v46z" />
        </g>
        <g fill="#0d3488" opacity=".55">
          {Array.from({ length: 9 }, (_, i) => (
            <path key={`a${i}`} d={`M${50 + i * 15} 74v-6a5 5 0 0 1 10 0v6z`} />
          ))}
          {Array.from({ length: 9 }, (_, i) => (
            <path key={`b${i}`} d={`M${50 + i * 15} 92v-8a5 5 0 0 1 10 0v8z`} />
          ))}
        </g>
        {/* palms */}
        <g stroke="#0b2a6b" strokeLinecap="round" fill="none" opacity=".85">
          <path d="M222 106q4-26 0-46" strokeWidth="4" />
          <path d="M222 60q-14-6-26 2M222 60q14-8 28 0M222 60q-6-12-18-14M222 60q8-12 20-12M222 60q2 10-8 18" strokeWidth="3" />
          <path d="M18 106q-3-20 2-36" strokeWidth="3" />
          <path d="M20 70q-10-4-18 2M20 70q10-6 20 0M20 70q-2-9-10-11" strokeWidth="2.5" />
        </g>
        <path d="M0 104h280v6H0z" fill="#0b2a6b" opacity=".6" />
      </svg>
      {(place || info.phone) && (
        <div className="bg-[#0a2463] px-5 pb-3 pt-1 space-y-1 text-[12px] text-blue-50">
          {place && (
            <p className="flex items-center gap-2 truncate"><MapPin className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{place}</span></p>
          )}
          {info.phone && (
            <a href={`tel:${info.phone.replace(/\s+/g, "")}`} className="flex items-center gap-2 hover:text-white"><Phone className="w-3.5 h-3.5 shrink-0" /> {info.phone}</a>
          )}
        </div>
      )}
    </div>
  );
}

/** Thin footer of every admin page: agency name, city, phone, WhatsApp, website. */
export function AdminFooter() {
  const info = useAgencyInfo();
  const site = info.website.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <footer className="border-t border-slate-200/80 dark:border-neutral-800 bg-white dark:bg-[#0a0a0a] px-4 md:px-8 py-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-[12px] text-slate-600 dark:text-slate-400">
      <p className="font-bold text-[#0b2a6b] dark:text-blue-300">
        {info.legalName.toUpperCase()}
        {info.city && <span className="font-normal text-slate-500"> &nbsp;|&nbsp; {info.city}</span>}
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {info.phone && (
          <a href={`tel:${info.phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1.5 hover:text-blue-600"><Phone className="w-3.5 h-3.5 text-[#0b2a6b] dark:text-blue-300" /> {info.phone}</a>
        )}
        {info.whatsapp && (
          <a href={`https://wa.me/${info.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-emerald-600"><MessageCircle className="w-3.5 h-3.5 text-emerald-600" /> {info.whatsapp}</a>
        )}
        {site && (
          <a href={info.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-blue-600"><Globe className="w-3.5 h-3.5 text-[#0b2a6b] dark:text-blue-300" /> {site}</a>
        )}
      </div>
    </footer>
  );
}
