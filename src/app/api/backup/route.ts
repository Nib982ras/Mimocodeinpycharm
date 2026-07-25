import { NextResponse } from "next/server";
import { requireOwner, authErrorResponse } from "@/lib/auth";
import { createBackup, listBackups, cleanupBackups } from "@/lib/backup";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/backup — List available backups (OWNER only).
 */
export async function GET() {
  try {
    const owner = await requireOwner();
    const backups = await listBackups();

    return NextResponse.json({
      ok: true,
      backups: backups.map((b) => ({
        id: b.id,
        timestamp: b.timestamp,
        databaseChecksum: b.databaseChecksum,
        fileCount: b.vaultFiles.length,
        totalSize: b.totalSize,
      })),
    });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Failed to list backups" }, { status: 500 });
  }
}

/**
 * POST /api/backup — Create a new backup (OWNER only).
 */
export async function POST(req: Request) {
  try {
    const owner = await requireOwner();
    const body = await req.json().catch(() => ({}));
    const action = (body as { action?: string })?.action || "create";

    if (action === "create") {
      const manifest = await createBackup();

      await recordAudit({
        action: "BACKUP_CREATE",
        actor: owner.username,
        actorId: owner.id,
        status: "SUCCESS",
        details: {
          backupId: manifest.id,
          fileCount: manifest.vaultFiles.length,
          totalSize: manifest.totalSize,
        },
      });

      return NextResponse.json({
        ok: true,
        backup: {
          id: manifest.id,
          timestamp: manifest.timestamp,
          fileCount: manifest.vaultFiles.length,
          totalSize: manifest.totalSize,
        },
      });
    }

    if (action === "cleanup") {
      const removed = await cleanupBackups(7);

      await recordAudit({
        action: "BACKUP_CLEANUP",
        actor: owner.username,
        actorId: owner.id,
        status: "SUCCESS",
        details: { removed },
      });

      return NextResponse.json({ ok: true, removed });
    }

    return NextResponse.json(
      { ok: false, error: "Invalid action. Use 'create' or 'cleanup'." },
      { status: 400 }
    );
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ ok: false, error: "Backup operation failed" }, { status: 500 });
  }
}
