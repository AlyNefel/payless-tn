import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { fontVariables } from "@/lib/fonts";
import "../globals.css";

export const metadata: Metadata = {
  title: { default: "Administration", template: "%s | Payless Admin" },
  robots: { index: false, follow: false, nocache: true },
};

/** Root layout of the back-office (separate <html> from the public, localized site). */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={`${fontVariables} font-sans min-h-screen bg-background text-foreground antialiased`} suppressHydrationWarning>
        <AdminShell>{children}</AdminShell>
      </body>
    </html>
  );
}
