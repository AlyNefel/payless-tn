import { ImageResponse } from "next/og";

export const alt = "Payless Car Rental Tunisie";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COPY: Record<string, { title: string; subtitle: string }> = {
  fr: { title: "Location de voiture en Tunisie", subtitle: "Tunis-Carthage · Monastir · Enfidha · Sousse · Sfax" },
  en: { title: "Car rental in Tunisia", subtitle: "Tunis-Carthage · Monastir · Enfidha · Sousse · Sfax" },
  // Default OG font has no Arabic glyphs: use the Latin wording for the Arabic card.
  ar: { title: "Car rental in Tunisia", subtitle: "Tunis-Carthage · Monastir · Enfidha · Sousse · Sfax" },
};

/** Branded social share image (replaces the stock Unsplash supercar photo). */
export default async function OpenGraphImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const c = COPY[locale] || COPY.fr;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px",
          background: "linear-gradient(135deg, #0b1b3f 0%, #10306f 60%, #1d4ed8 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 40, fontWeight: 800, letterSpacing: 2, color: "#fbbf24" }}>PAYLESS CAR RENTAL</div>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 800, marginTop: 24, lineHeight: 1.1 }}>{c.title}</div>
        <div style={{ display: "flex", fontSize: 32, marginTop: 28, color: "#cbd5e1" }}>{c.subtitle}</div>
        <div style={{ display: "flex", fontSize: 28, marginTop: 48, color: "#e2e8f0" }}>payless.tn</div>
      </div>
    ),
    size
  );
}
