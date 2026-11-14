import type { MetadataRoute } from "next";
import connectDB from "@/lib/db";
import { Vehicle } from "@/models";
import { LOCALES, HTML_LANG, localeUrl } from "@/lib/site";
import { routing } from "@/i18n/routing";

export const revalidate = 3600; // regenerate at most hourly

const STATIC_PAGES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 1, changeFrequency: "weekly" },
  { path: "/vehicles", priority: 0.9, changeFrequency: "daily" },
  { path: "/promotions", priority: 0.7, changeFrequency: "weekly" },
  { path: "/contact", priority: 0.6, changeFrequency: "monthly" },
  { path: "/about", priority: 0.5, changeFrequency: "monthly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
];

function alternates(path: string) {
  const languages: Record<string, string> = {};
  for (const l of LOCALES) languages[HTML_LANG[l]] = localeUrl(l, path);
  languages["x-default"] = localeUrl(routing.defaultLocale, path);
  return { languages };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const page of STATIC_PAGES) {
    for (const l of LOCALES) {
      entries.push({
        url: localeUrl(l, page.path),
        lastModified: now,
        changeFrequency: page.changeFrequency,
        priority: page.priority,
        alternates: alternates(page.path),
      });
    }
  }

  try {
    await connectDB();
    const vehicles = await Vehicle.find({ isActive: true, status: { $nin: ["archived", "unavailable"] } })
      .select("_id updatedAt images")
      .lean();
    for (const v of vehicles) {
      const path = `/vehicles/${String(v._id)}`;
      const images = (v.images || []).map((i) => i.url).filter(Boolean).slice(0, 5);
      for (const l of LOCALES) {
        entries.push({
          url: localeUrl(l, path),
          lastModified: v.updatedAt || now,
          changeFrequency: "weekly",
          priority: 0.8,
          alternates: alternates(path),
          ...(images.length ? { images } : {}),
        });
      }
    }
  } catch (err) {
    console.error("sitemap: vehicles unavailable", err);
  }

  return entries;
}
