import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/apiAuth";
import { getRolePermissions, saveRolePermissions, ADMIN_SECTIONS, DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    success: true,
    permissions: await getRolePermissions(),
    sections: ADMIN_SECTIONS,
    defaults: DEFAULT_ROLE_PERMISSIONS,
  });
}

export async function PUT(request: NextRequest) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const permissions = await saveRolePermissions(body.permissions || {}, guard.session.user?.id);
  return NextResponse.json({ success: true, permissions });
}
