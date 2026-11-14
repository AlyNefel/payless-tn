"use client";

import { useState } from "react";
import {
  Accessibility, Armchair, Baby, Briefcase, Car, Clock, Compass, CreditCard, Fuel, Gauge, Gift,
  Heart, Key, Luggage, Map, MapPin, Moon, Navigation, Package, Phone, Plane, Shield, ShieldCheck,
  Smartphone, Snowflake, Sparkles, Star, Sun, Umbrella, User, UserPlus, Users, Wifi, Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Curated registry of icons available for rental options.
 * Kept explicit (instead of `import * as Icons`) so the whole Lucide set is not bundled.
 * Keys are normalized: lowercase, no dashes/underscores/spaces.
 */
export const OPTION_ICON_REGISTRY: Record<string, LucideIcon> = {
  accessibility: Accessibility,
  armchair: Armchair,
  baby: Baby,
  briefcase: Briefcase,
  car: Car,
  clock: Clock,
  compass: Compass,
  creditcard: CreditCard,
  fuel: Fuel,
  gauge: Gauge,
  gift: Gift,
  heart: Heart,
  key: Key,
  luggage: Luggage,
  map: Map,
  mappin: MapPin,
  moon: Moon,
  navigation: Navigation,
  gps: Navigation,
  package: Package,
  phone: Phone,
  plane: Plane,
  shield: Shield,
  shieldcheck: ShieldCheck,
  smartphone: Smartphone,
  snowflake: Snowflake,
  sparkles: Sparkles,
  star: Star,
  sun: Sun,
  umbrella: Umbrella,
  user: User,
  userplus: UserPlus,
  users: Users,
  wifi: Wifi,
  wrench: Wrench,
};

/** Icon names offered in the admin option editor. */
export const OPTION_ICON_CHOICES = [
  "Users", "UserPlus", "Baby", "Armchair", "Fuel", "Compass", "Navigation", "Map", "Plane", "Moon",
  "ShieldCheck", "Shield", "Wifi", "Smartphone", "Luggage", "Snowflake", "Clock", "Key", "Car",
  "Accessibility", "Gift", "Star", "Package",
] as const;

const normalize = (v: string) => v.toLowerCase().replace(/[-_\s]/g, "").replace(/icon$/, "");
const isImageSource = (v: string) => /^(https?:\/\/|\/(?!\/)|data:image\/)/i.test(v);
// Emoji / pictographs (also accepts short non-latin symbols such as "⛽").
const isEmoji = (v: string) => /\p{Extended_Pictographic}/u.test(v);

export function resolveOptionIcon(icon?: string | null):
  | { kind: "image"; src: string }
  | { kind: "lucide"; Icon: LucideIcon }
  | { kind: "emoji"; value: string }
  | { kind: "fallback" } {
  const value = (icon || "").trim();
  if (!value) return { kind: "fallback" };
  if (isImageSource(value)) return { kind: "image", src: value };
  const key = normalize(value);
  if (Object.prototype.hasOwnProperty.call(OPTION_ICON_REGISTRY, key)) {
    return { kind: "lucide", Icon: OPTION_ICON_REGISTRY[key] };
  }
  if (isEmoji(value) && value.length <= 8) return { kind: "emoji", value };
  return { kind: "fallback" };
}

interface OptionIconProps {
  icon?: string | null;
  /** Accessible label; omit when the option name is already rendered next to the icon. */
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: { box: "w-7 h-7 rounded-lg", glyph: "w-4 h-4", emoji: "text-base" },
  md: { box: "w-10 h-10 rounded-xl", glyph: "w-5 h-5", emoji: "text-xl" },
  lg: { box: "w-12 h-12 rounded-xl", glyph: "w-6 h-6", emoji: "text-2xl" },
} as const;

/**
 * Renders a rental option's icon. The DB stores a Lucide icon name ("Baby"), an emoji ("⛽")
 * or an image URL (Cloudinary). Unknown values fall back to a neutral icon instead of
 * printing the raw string (the original "Users / Fuel / Compass" text bug).
 */
export function OptionIcon({ icon, label, size = "md", className }: OptionIconProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const s = SIZES[size];
  const resolved = resolveOptionIcon(icon);
  const a11y = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };

  let content: React.ReactNode;
  if (resolved.kind === "image" && !imageFailed) {
    content = (
      // eslint-disable-next-line @next/next/no-img-element -- tiny admin-provided icon, any host
      <img
        src={resolved.src}
        alt=""
        loading="lazy"
        decoding="async"
        className="w-full h-full object-contain p-1"
        onError={() => setImageFailed(true)}
      />
    );
  } else if (resolved.kind === "lucide") {
    const Icon = resolved.Icon;
    content = <Icon className={s.glyph} strokeWidth={2} />;
  } else if (resolved.kind === "emoji") {
    content = <span className={cn(s.emoji, "leading-none")}>{resolved.value}</span>;
  } else {
    content = <Sparkles className={s.glyph} strokeWidth={2} />;
  }

  return (
    <span
      {...a11y}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300",
        s.box,
        className
      )}
    >
      {content}
    </span>
  );
}
