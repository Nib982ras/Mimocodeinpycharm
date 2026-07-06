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
 * The connection is created lazily and reused across requests.
 */

const HUB_URL = "http://localhost:3003";

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
      timeout: 3000,
      autoConnect: true,
    });
    _socket.on("connect", () => {
      // server client — no client:join needed
    });
    _socket.on("connect_error", () => {
      // Hub may be down; silently degrade. Real-time is best-effort.
    });
    return _socket;
  } catch {
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

/** Forward a server-side event to the hub (best-effort, non-blocking). */
export function hubNotify(evt: {
  type: "document:delivered" | "document:decrypted" | "branch:created";
  recipientBranchId?: string;
  senderBranchId?: string;
  branch?: { id: string; code: string; name: string; type: string };
  document?: NotifyDocument;
}): void {
  const sock = getSocket();
  if (!sock) return;
  if (!sock.connected) {
    // Buffer briefly: try to emit on next tick (best-effort).
    sock.once("connect", () => sock.emit("server:notify", evt));
    return;
  }
  sock.emit("server:notify", evt);
}
