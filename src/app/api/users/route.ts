import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSecurityAdmin, authErrorResponse, hashPassword, type Role } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const VALID_ROLES: Role[] = ["OWNER", "SECURITY_ADMIN", "BRANCH_ADMIN", "USER", "READONLY"];
/** Roles that must be tied to a specific branch. */
const BRANCH_REQUIRED_ROLES: Role[] = ["BRANCH_ADMIN", "USER", "READONLY"];

/** GET /api/users — list all users (SECURITY_ADMIN+). */
export async function GET() {
  try {
    const admin = await requireSecurityAdmin();
    const users = await db.user.findMany({
      orderBy: [{ role: "asc" }, { username: "asc" }],
      include: {
        branch: { select: { id: true, code: true, name: true, type: true } },
        twoFactor: { select: { enabled: true, enforced: true } },
      },
    });
    return NextResponse.json({
      ok: true,
      actor: admin.username,
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        status: u.status,
        branchId: u.branchId,
        branch: u.branch,
        twoFactorEnabled: u.twoFactor?.enabled ?? false,
        twoFactorEnforced: u.twoFactor?.enforced ?? false,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to list users" }, { status: 500 });
  }
}

/** POST /api/users — create a new user (SECURITY_ADMIN+).
 *  Any role EXCEPT "OWNER" may be created (there can only ever be one owner).
 */
export async function POST(req: Request) {
  try {
    const admin = await requireSecurityAdmin();
    const body = await req.json().catch(() => ({}));
    const { username, displayName, password, role, branchId } = body as {
      username?: string;
      displayName?: string;
      password?: string;
      role?: string;
      branchId?: string | null;
    };

    if (!username || !password || !role) {
      return NextResponse.json(
        { ok: false, error: "username, password and role are required" },
        { status: 400 }
      );
    }
    if (role === "OWNER") {
      return NextResponse.json(
        { ok: false, error: "Owner role cannot be created" },
        { status: 400 }
      );
    }
    if (!VALID_ROLES.includes(role as Role)) {
      return NextResponse.json({ ok: false, error: "Invalid role" }, { status: 400 });
    }
    const branchRequired = BRANCH_REQUIRED_ROLES.includes(role as Role);
    if (branchRequired && !branchId) {
      return NextResponse.json(
        { ok: false, error: `${role} accounts must be assigned to a branch` },
        { status: 400 }
      );
    }

    const uname = username.toLowerCase();
    const existing = await db.user.findUnique({ where: { username: uname } });
    if (existing) {
      return NextResponse.json({ ok: false, error: "Username already exists" }, { status: 409 });
    }

    const user = await db.user.create({
      data: {
        username: uname,
        displayName: displayName || uname,
        passwordHash: hashPassword(password),
        role,
        status: "ACTIVE",
        branchId: branchRequired ? branchId : (branchId ?? null),
      },
      include: {
        branch: { select: { id: true, code: true, name: true, type: true } },
        twoFactor: { select: { enabled: true, enforced: true } },
      },
    });

    await recordAudit({
      action: "SYSTEM",
      actor: admin.username,
      status: "SUCCESS",
      details: {
        event: "USER_CREATE",
        username: user.username,
        role: user.role,
        branch: user.branch?.code ?? null,
      },
      ipAddress: req.headers.get("x-forwarded-for") || undefined,
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        branchId: user.branchId,
        branch: user.branch,
        twoFactorEnabled: user.twoFactor?.enabled ?? false,
        twoFactorEnforced: user.twoFactor?.enforced ?? false,
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to create user" }, { status: 500 });
  }
}
