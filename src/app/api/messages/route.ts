import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { hubNotify } from "@/lib/hub-client";
import { parsePagination, buildIdCursorWhere, simplePaginatedResponse } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();

    if (!user.branchId) {
      return NextResponse.json({ ok: true, messages: [], pagination: { nextCursor: null, hasMore: false, limit: 50, count: 0 } });
    }

    const { searchParams } = new URL(req.url);
    const pagination = parsePagination(new URL(req.url));
    const dmUserId = searchParams.get("userId");

    const where: any = {
      AND: [
        { status: { not: "DELETED" } },
      ],
    };

    if (dmUserId) {
      where.AND.push({
        OR: [
          { fromUserId: user.id, toUserId: dmUserId },
          { fromUserId: dmUserId, toUserId: user.id },
        ],
      });
    } else {
      where.AND.push({ branchId: user.branchId });
      where.AND.push({ toUserId: null });
    }

    const paginatedWhere = buildIdCursorWhere(where, pagination);

    const messages = await db.message.findMany({
      where: paginatedWhere,
      include: {
        fromUser: { select: { id: true, username: true, displayName: true } },
        toUser: { select: { id: true, username: true, displayName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: pagination.limit + 1,
    });

    const result = simplePaginatedResponse(messages, pagination, undefined, (m) => ({
      id: m.id,
      fromUser: m.fromUser,
      toUser: m.toUser,
      text: m.text,
      status: m.status,
      readAt: m.readAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    }));

    return NextResponse.json({ ok: true, messages: result.data, pagination: result.pagination });
  } catch (err: unknown) {
    const r = authErrorResponse(err);
    if (r) return r;
    console.error("GET /api/messages:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();

    // Only USER and BRANCH_ADMIN can send messages
    if (!["USER", "BRANCH_ADMIN"].includes(user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!user.branchId) {
      return NextResponse.json({ error: "User must be in a branch" }, { status: 400 });
    }

    const body = await req.json();
    const { toUserId, text } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "Message text required" }, { status: 400 });
    }

    if (text.length > 2000) {
      return NextResponse.json({ error: "Message too long (max 2000 chars)" }, { status: 400 });
    }

    // Validate recipient exists if specified
    if (toUserId) {
      const recipient = await db.user.findUnique({
        where: { id: toUserId },
        select: { id: true },
      });
      if (!recipient) {
        return NextResponse.json({ error: "Recipient not found" }, { status: 400 });
      }
    }

    // Save message to database
    const message = await db.message.create({
      data: {
        fromUserId: user.id,
        toUserId: toUserId || undefined,
        branchId: user.branchId,
        text: text.trim(),
        status: "SENT",
      },
      include: {
        fromUser: { select: { id: true, username: true, displayName: true } },
        toUser: { select: { id: true, username: true, displayName: true } },
      },
    });

    const branch = await db.branch.findUnique({
      where: { id: user.branchId },
      select: { code: true },
    });

    // Log to audit trail
    await db.auditLog.create({
      data: {
        action: "MESSAGE_SEND",
        actor: user.username,
        actorId: user.id,
        branchId: user.branchId,
        status: "SUCCESS",
        details: JSON.stringify({
          messageId: message.id,
          toUserId: toUserId || null,
          length: text.length,
        }),
      },
    });

    // Broadcast via Socket.IO to all connected clients
    hubNotify({
      type: "message:send",
      message: {
        id: message.id,
        fromUserId: message.fromUserId,
        fromUser: message.fromUser,
        toUserId: toUserId || undefined,
        branchId: user.branchId,
        branchCode: branch?.code || "UNKNOWN",
        text: message.text,
        createdAt: message.createdAt.toISOString(),
      },
    });

    return NextResponse.json({ message }, { status: 201 });
  } catch (err: unknown) {
    const r = authErrorResponse(err);
    if (r) return r;
    console.error("POST /api/messages:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
