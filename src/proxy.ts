import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);


async function hasStaffSession(request: NextRequest): Promise<boolean> {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) return false;
  const secureCookie = request.nextUrl.protocol === "https:";
  try {
    // Verifies the JWT signature/expiry — a forged or arbitrary cookie value is rejected.
    const token = await getToken({
      req: request,
      secret,
      secureCookie,
      salt: secureCookie ? "__Secure-authjs.session-token" : "authjs.session-token",
    });
    const role = String((token as { role?: string } | null)?.role || "").toLowerCase();
    // Any back-office role (system or custom RBAC role); customers never sign in here.
    return Boolean(role) && role !== "client";
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Bypass API routes, Next.js internals, and static files
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/_vercel") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // 2. Admin route protection (UI). Admin APIs enforce their own server-side guards.
  if (pathname.startsWith("/admin")) {
    if (pathname.startsWith("/admin/login")) {
      return NextResponse.next();
    }

    if (!(await hasStaffSession(request))) {
      const loginUrl = new URL("/admin/login", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }

    const res = NextResponse.next();
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  }

  // 3. Apply i18n middleware for public routes only
  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
