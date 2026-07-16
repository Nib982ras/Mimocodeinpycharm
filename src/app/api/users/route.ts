import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, authErrorResponse, hashPassword } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET /api/users — list all users (admin only). */
export async function GET() {
  try {
    const admin = await requireAdmin();
    const users = await db.user.findMany({
      orderBy: [{ role: "asc" }, { username: "asc" }],
      include: { branch: { select: { id: true, code: true, name: true, type: true } } },
    });
    return NextResponse.json({
      ok: true,
      actor: admin.username,
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        branchId: u.branchId,
        branch: u.branch,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to list users" }, { status: 500 });
  }
}

/** POST /api/users — create a new user (admin only). */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
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
    if (role !== "ADMIN" && role !== "USER") {
      return NextResponse.json({ ok: false, error: "Invalid role" }, { status: 400 });
    }
    if (role === "USER" && !branchId) {
      return NextResponse.json(
        { ok: false, error: "USER accounts must be assigned to a branch" },
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
        branchId: role === "ADMIN" ? null : branchId,
      },
      include: { branch: { select: { id: true, code: true, name: true, type: true } } },
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
        branchId: user.branchId,
        branch: user.branch,
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to create user" }, { status: 500 });
  }
}
