import { NextResponse } from "next/server";
import { getSessionRole } from "@/lib/apiAuth";
import { ADMIN_SECTIONS, getRolePermissions, type AccessLevel, type StaffRole } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** Current back-office user + the access level of each section (drives the menu and page guards). */
export async function GET() {
  const { session, role } = await getSessionRole();
  if (!session || !role) return NextResponse.json({ success: false }, { status: 401 });
  const perms = await getRolePermissions();
  const r = (role === "agent" ? "staff" : role) as StaffRole;
  const access: Record<string, AccessLevel> = {};
  for (const s of ADMIN_SECTIONS) access[s.key] = role === "superadmin" ? "edit" : perms[r]?.[s.key] || "none";
  return NextResponse.json({
    success: true,
    user: { id: session.user?.id, name: session.user?.name, email: session.user?.email, role },
    access,
  });
}
