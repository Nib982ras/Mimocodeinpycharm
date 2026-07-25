import { NextResponse } from "next/server";
import { resetDatabase, seedDatabase } from "@/lib/seed";
import { requireOwner, authErrorResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/reset — reset the database and reseed with demo data.
 *
 * This is an extremely destructive operation. It is gated behind:
 *   1. OWNER-only authentication
 *   2. SEED_SECRET environment variable (must match the request header)
 *   3. Explicit confirmation in the request body: { confirm: true }
 *
 * In production, this endpoint should be disabled entirely or require
 * a two-step confirmation process.
 */
export async function POST(req: Request) {
  try {
    // In production, disable reset entirely unless explicitly enabled
    if (process.env.NODE_ENV === "production" && !process.env.ALLOW_RESET) {
      return NextResponse.json(
        { ok: false, error: "Database reset is disabled in production" },
        { status: 403 }
      );
    }

    // Require OWNER authentication
    await requireOwner();

    // Require SEED_SECRET in production
    if (process.env.SEED_SECRET) {
      const seedHeader = req.headers.get("x-seed-secret");
      if (seedHeader !== process.env.SEED_SECRET) {
        return NextResponse.json(
          { ok: false, error: "Invalid seed secret" },
          { status: 403 }
        );
      }
    }

    // Require explicit confirmation
    const body = await req.json().catch(() => ({}));
    if (!(body as { confirm?: boolean })?.confirm) {
      return NextResponse.json(
        { ok: false, error: "Send { confirm: true } to reset the database" },
        { status: 400 }
      );
    }

    await resetDatabase();
    const result = await seedDatabase();
    return NextResponse.json({ ok: true, message: "Database reset and reseeded", ...result });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Reset failed" },
      { status: 500 }
    );
  }
}
