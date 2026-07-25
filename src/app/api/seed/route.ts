import { NextResponse } from "next/server";
import { seedDatabase } from "@/lib/seed";
import { requireOwner, authErrorResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/seed — seed the initial branch hierarchy + key pairs.
 * GET  /api/seed — seed if not already seeded, then report status.
 *
 * Both endpoints are gated behind:
 *   1. OWNER-only authentication
 *   2. SEED_SECRET environment variable (must match the request header)
 *
 * In production, SEED_SECRET must be set and the owner must authenticate.
 * This prevents anyone from seeding or reseeding the database.
 */
export async function POST(req: Request) {
  try {
    // Gate behind environment check
    if (process.env.NODE_ENV === "production" && !process.env.SEED_SECRET) {
      return NextResponse.json(
        { ok: false, error: "Seeding is disabled in production" },
        { status: 403 }
      );
    }

    // Require OWNER authentication
    await requireOwner();

    // In production, also require SEED_SECRET header
    if (process.env.SEED_SECRET) {
      const seedHeader = req.headers.get("x-seed-secret");
      if (seedHeader !== process.env.SEED_SECRET) {
        return NextResponse.json(
          { ok: false, error: "Invalid seed secret" },
          { status: 403 }
        );
      }
    }

    const result = await seedDatabase();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Seed failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  try {
    if (process.env.NODE_ENV === "production" && !process.env.SEED_SECRET) {
      return NextResponse.json(
        { ok: false, error: "Seeding is disabled in production" },
        { status: 403 }
      );
    }

    await requireOwner();

    if (process.env.SEED_SECRET) {
      const seedHeader = req.headers.get("x-seed-secret");
      if (seedHeader !== process.env.SEED_SECRET) {
        return NextResponse.json(
          { ok: false, error: "Invalid seed secret" },
          { status: 403 }
        );
      }
    }

    const result = await seedDatabase();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Seed check failed" },
      { status: 500 }
    );
  }
}
