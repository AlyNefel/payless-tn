import { Cairo, Inter, Playfair_Display } from "next/font/google";

/**
 * Self-hosted Google fonts (next/font): no render-blocking request to Google,
 * `display: swap` and automatic fallback metrics to limit layout shift (CLS).
 * These define the CSS variables used by globals.css / tailwind.config.ts,
 * which were previously never set (the site fell back to the browser serif font).
 */
export const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
export const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
  weight: ["600", "700", "800"],
});
export const cairo = Cairo({ subsets: ["arabic", "latin"], variable: "--font-cairo", display: "swap" });

export const fontVariables = `${inter.variable} ${playfair.variable} ${cairo.variable}`;
