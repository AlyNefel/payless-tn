import type { ReactNode } from "react";

/**
 * The <html>/<body> elements are rendered by the two real root layouts:
 * - app/[locale]/layout.tsx (public site: correct lang/dir per locale)
 * - app/admin/layout.tsx (back-office)
 * This pass-through layout only exists so app/page.tsx (redirect) has a parent.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
