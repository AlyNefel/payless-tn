import { NextResponse } from "next/server";
import { getSessionRole } from "@/lib/apiAuth";
import { RESOURCES, getRoles, permissionsFor, sectionAccess, type AccessLevel } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** Current back-office user, granular permissions and section access (menu + page guards + buttons). */
export async function GET() {
  const { session, role } = await getSessionRole();
  if (!session || !role || role === "client") return NextResponse.json({ success: false }, { status: 401 });
  const perms = await permissionsFor(role);
  const roles = await getRoles();
  const access: Record<string, AccessLevel> = {};
  for (const r of RESOURCES) access[r.key] = sectionAccess(perms, r.key);
  return NextResponse.json({
    success: true,
    user: { id: session.user?.id, name: session.user?.name, email: session.user?.email, role, roleName: roles.get(role)?.name || role },
    permissions: [...perms],
    access,
  });
}
