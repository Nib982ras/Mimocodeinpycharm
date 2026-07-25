import { io, type Socket } from "socket.io-client";

/**
 * Server-side client for the Exchange Hub.
 *
 * The Next.js API routes call `hubNotify(...)` to forward server-side events
 * (document delivered, branch created, etc.) to the real-time hub, which then
 * broadcasts them to all connected branch clients. This is a privileged
 * server-to-server socket.io connection — it does NOT go through Caddy (direct
 * localhost). Branch *clients* (browsers) connect via Caddy with
 * `io("/?XTransformPort=3003")`.
 *
 * SECURITY: All server:notify events include an authentication token.
 * The hub validates this token before processing any events.
 *
 * The connection is created lazily and reused across requests.
 */

const HUB_URL = process.env.HUB_URL || "http://localhost:3003";
const SERVER_TOKEN = process.env.HUB_SERVER_TOKEN || "";

let _socket: Socket | null = null;

function getSocket(): Socket | null {
  if (typeof window !== "undefined") return null; // server-only
  if (_socket) return _socket;
  try {
    _socket = io(HUB_URL, {
      path: "/",
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 5000,
      autoConnect: true,
    });
    _socket.on("connect", () => {
      // server client — no client:join needed
    });
    _socket.on("connect_error", (err) => {
      console.warn("[hub-client] connection error:", err.message);
    });
    return _socket;
  } catch (err) {
    console.error("[hub-client] socket creation error:", err);
    return null;
  }
}

export interface NotifyDocument {
  id: string;
  name: string;
  sender: { code: string; name: string };
  recipient: { code: string; name: string };
  size: number;
}

export interface NotifyMessage {
  id: string;
  fromUserId: string;
  fromUser: { username: string; displayName: string };
  toUserId?: string;
  branchId: string;
  branchCode: string;
  text: string;
  createdAt: string;
}

/** Forward a server-side event to the hub (best-effort, non-blocking). */
export function hubNotify(evt: {
  type: "document:delivered" | "document:decrypted" | "branch:created" | "message:send";
  recipientBranchId?: string;
  senderBranchId?: string;
  branch?: { id: string; code: string; name: string; type: string };
  document?: NotifyDocument;
  message?: NotifyMessage;
}): void {
  if (!SERVER_TOKEN) {
    console.warn("[hub-client] HUB_SERVER_TOKEN not configured, skipping notification");
    return;
  }

  const sock = getSocket();
  if (!sock) return;
  if (!sock.connected) {
    // Replace any pending connect listener — avoid unbounded accumulation.
    sock.off("connect");
    sock.once("connect", () => sock.emit("server:notify", { token: SERVER_TOKEN, event: evt }));
    return;
  }
  sock.emit("server:notify", { token: SERVER_TOKEN, event: evt });
}
