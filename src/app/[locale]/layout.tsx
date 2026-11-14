import React from "react";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { Toaster } from "sonner";
import Script from "next/script";
import { routing } from "@/i18n/routing";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { WhatsAppWidget } from "@/components/layout/WhatsAppWidget";
import { AIAgentChat } from "@/components/layout/AIAgentChat";
import { CompanySettingsProvider } from "@/contexts/CompanySettingsContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { JsonLd } from "@/components/seo/JsonLd";
import { fontVariables } from "@/lib/fonts";
import { getPublicSettings } from "@/lib/publicSettings";
import { buildBusinessGraph } from "@/lib/structuredData";
import { pageMetadata } from "@/lib/seo";
import { HTML_LANG, SITE_NAME, SITE_URL, type SiteLocale } from "@/lib/site";
import "../globals.css";

// Agency settings & branches are read at render time: refresh the static HTML every 5 minutes.
export const revalidate = 300;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0B" },
  ],
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const base = pageMetadata("home", locale, "");
  return {
    ...base,
    // Child pages provide their own title; the template appends the brand.
    title: { default: String(base.title), template: `%s | ${SITE_NAME}` },
    applicationName: SITE_NAME,
    metadataBase: new URL(SITE_URL),
    icons: { icon: [{ url: "/favicon.ico" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
    formatDetection: { telephone: true, email: true, address: false },
    other: { "darkreader-lock": "true" },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as SiteLocale)) {
    notFound();
  }

  setRequestLocale(locale);
  const [messages, settings] = await Promise.all([getMessages(), getPublicSettings()]);
  const isRtl = locale === "ar";
  const businessGraph = await buildBusinessGraph(locale as SiteLocale, settings);

  return (
    <html lang={HTML_LANG[locale as SiteLocale]} dir={isRtl ? "rtl" : "ltr"} suppressHydrationWarning>
      <body
        className={`${fontVariables} min-h-screen bg-background text-foreground antialiased ${isRtl ? "font-arabic" : "font-sans"}`}
        suppressHydrationWarning
      >
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var s=localStorage.getItem("theme")||"system";var t=s==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):s;if(t!=="light"&&t!=="dark")t="light";var r=document.documentElement;r.classList.remove("light","dark");r.classList.add(t);r.style.colorScheme=t;}catch(e){}})();`}
        </Script>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-blue-600 focus:text-white"
        >
          {locale === "ar" ? "انتقل إلى المحتوى" : locale === "en" ? "Skip to content" : "Aller au contenu"}
        </a>
        <JsonLd data={businessGraph} />
        <ThemeProvider defaultTheme="system" enableSystem>
          <div className="min-h-screen flex flex-col overflow-x-clip">
            <NextIntlClientProvider messages={messages} locale={locale}>
              <CompanySettingsProvider initialSettings={settings}>
                <Header />
                <main id="main-content" className="flex-1 w-full overflow-x-clip">
                  {children}
                </main>
                <Footer />
                <WhatsAppWidget />
                <AIAgentChat />
                <Toaster richColors position="top-right" />
              </CompanySettingsProvider>
            </NextIntlClientProvider>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
