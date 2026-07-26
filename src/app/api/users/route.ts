import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSecurityAdmin, authErrorResponse, hashPassword, type Role } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parsePagination, buildIdCursorWhere, simplePaginatedResponse } from "@/lib/pagination";

export const dynamic = "force-dynamic";

const VALID_ROLES: Role[] = ["OWNER", "SECURITY_ADMIN", "BRANCH_ADMIN", "USER", "READONLY"];
const BRANCH_REQUIRED_ROLES: Role[] = ["BRANCH_ADMIN", "USER", "READONLY"];

/**
 * Validate password against security policy.
 * Returns null if valid, error message if invalid.
 */
function validatePassword(password: string): string | null {
  const errors: string[] = [];
  if (password.length < 12) errors.push("at least 12 characters");
  if (!/[A-Z]/.test(password)) errors.push("at least one uppercase letter");
  if (!/[a-z]/.test(password)) errors.push("at least one lowercase letter");
  if (!/[0-9]/.test(password)) errors.push("at least one digit");
  if (!/[!@#$%^&*]/.test(password)) errors.push("at least one special character (!@#$%^&*)");

  if (errors.length > 0) {
    return `Password must contain ${errors.join(", ")}`;
  }
  return null;
}

/** GET /api/users — paginated list of users (SECURITY_ADMIN+).
 *  Query params: cursor, limit (default 50, max 200), role, status, branchId
 */
export async function GET(req: Request) {
  try {
    const admin = await requireSecurityAdmin();
    const url = new URL(req.url);
    const pagination = parsePagination(url, "asc");
    const roleFilter = url.searchParams.get("role");
    const statusFilter = url.searchParams.get("status");
    const branchFilter = url.searchParams.get("branchId");

    const where: Record<string, unknown> = {};
    if (roleFilter) where.role = roleFilter;
    if (statusFilter) where.status = statusFilter;
    if (branchFilter) where.branchId = branchFilter;

    const paginatedWhere = buildIdCursorWhere(where, pagination);

    const users = await db.user.findMany({
      where: paginatedWhere,
      orderBy: [{ role: pagination.sort }, { username: "asc" }],
      take: pagination.limit + 1,
      include: {
        branch: { select: { id: true, code: true, name: true, type: true } },
        twoFactor: { select: { enabled: true, enforced: true } },
      },
    });

    const result = simplePaginatedResponse(users, pagination, undefined, (u) => ({
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
    }));

    return NextResponse.json({ ok: true, actor: admin.username, users: result.data, pagination: result.pagination });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to list users" }, { status: 500 });
  }
}

/** POST /api/users — create a new user (SECURITY_ADMIN+). */
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

    // Enforce password policy
    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ ok: false, error: passwordError }, { status: 400 });
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
      action: "USER_CREATE",
      actor: admin.username,
      actorId: admin.id,
      status: "SUCCESS",
      details: {
        username: user.username,
        role: user.role,
        branch: user.branch?.code ?? null,
      },
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
