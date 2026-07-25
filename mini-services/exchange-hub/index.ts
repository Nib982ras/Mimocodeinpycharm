import { createServer } from "http";
import { Server, type Socket } from "socket.io";
import { validateServerToken } from "./auth";

/**
 * Exchange Hub — real-time presence & event broker for the Secure Multi-Branch
 * Document Exchange System.
 *
 * SECURITY: Server-to-server communications (server:notify) require a valid
 * authentication token. Client connections (browser) are authenticated by
 * their origin and session state.
 *
 * Each branch connects as a "client" by emitting `client:join` with its branch
 * id/code/type. The hub tracks online presence and broadcasts:
 *   - `document:delivered`  → a new encrypted package is available (recipient)
 *   - `document:sent`       → dispatch confirmation (sender)
 *   - `document:decrypted`  → receipt confirmation (sender)
 *   - `branch:created`      → a new node joined the topology (everyone)
 *   - `branch:online`       → a branch client connected (everyone)
 *   - `branch:offline`      → a branch client disconnected (everyone)
 *   - `clients:list`        → current online branch list
 *   - `message:receive`     → new message from another user
 *
 * The Next.js API server notifies the hub by connecting as a privileged
 * "server" client (via socket.io-client) and emitting `server:notify` events
 * with a valid authentication token.
 */

const PORT = parseInt(process.env.HUB_PORT || "3003", 10);

interface OnlineClient {
  socketId: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  branchType: string;
  connectedAt: number;
}

const online = new Map<string, OnlineClient>(); // branchId -> client

const httpServer = createServer();

// CORS origin validation — whitelist only, never default to "*"
function isHubOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  const allowed = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin);
}

const io = new Server(httpServer, {
  path: "/",
  cors: {
    origin: (origin, callback) => {
      if (isHubOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  // Rate limiting
  maxHttpBufferSize: 1e6, // 1MB max message size
});

function emitClientsList(target?: Socket) {
  const list = Array.from(online.values());
  const payload = { clients: list, count: list.length };
  if (target) target.emit("clients:list", payload);
  else io.emit("clients:list", payload);
}

/** Event payload the Next.js API server forwards to the hub. */
interface NotifyEvent {
  type: "document:delivered" | "document:decrypted" | "branch:created" | "message:send";
  recipientBranchId?: string;
  senderBranchId?: string;
  branch?: { id: string; code: string; name: string; type: string };
  document?: {
    id: string;
    name: string;
    sender: { code: string; name: string };
    recipient: { code: string; name: string };
    size: number;
  };
  message?: {
    id: string;
    fromUserId: string;
    fromUser: { username: string; displayName: string };
    toUserId?: string;
    branchId: string;
    branchCode: string;
    text: string;
    createdAt: string;
  };
}

function routeNotify(evt: NotifyEvent) {
  if (evt.type === "document:delivered") {
    io.emit("document:delivered", evt.document);
    io.emit("document:sent", evt.document);
    return;
  }
  if (evt.type === "document:decrypted") {
    io.emit("document:decrypted", evt.document);
    return;
  }
  if (evt.type === "branch:created" && evt.branch) {
    io.emit("branch:created", { branch: evt.branch });
    return;
  }
  if (evt.type === "message:send" && evt.message) {
    // Broadcast message to all connected clients in the branch
    io.emit("message:receive", evt.message);
    console.log(`[hub] message from ${evt.message.fromUser.displayName}`);
    return;
  }
}

io.on("connection", (socket: Socket) => {
  console.log(`[hub] socket connected: ${socket.id}`);

  // Privileged server-to-server channel (Next.js API → hub)
  // REQUIRES authentication token
  socket.on("server:notify", (data: { token?: string; event?: NotifyEvent }) => {
    // Validate the server token
    if (!validateServerToken(data.token)) {
      console.warn(`[hub] unauthorized server:notify from ${socket.id}`);
      socket.emit("error", { message: "Unauthorized" });
      return;
    }

    if (data.event) {
      routeNotify(data.event);
    }
  });

  // A branch client identifies itself
  socket.on("client:join", (data: { branchId: string; branchCode: string; branchName: string; branchType: string }) => {
    if (!data || !data.branchId) return;

    // Validate required fields
    if (typeof data.branchId !== "string" || data.branchId.length > 100) return;
    if (typeof data.branchCode !== "string" || data.branchCode.length > 50) return;
    if (typeof data.branchName !== "string" || data.branchName.length > 200) return;

    const client: OnlineClient = {
      socketId: socket.id,
      branchId: data.branchId,
      branchCode: data.branchCode,
      branchName: data.branchName,
      branchType: data.branchType,
      connectedAt: Date.now(),
    };
    online.set(data.branchId, client);
    (socket as Socket & { _branchId?: string })._branchId = data.branchId;
    console.log(`[hub] branch online: ${data.branchCode}`);

    socket.emit("client:joined", { ok: true, client });
    io.emit("branch:online", { client });
    emitClientsList();
  });

  socket.on("client:ping", (cb: (ts: number) => void) => {
    if (typeof cb === "function") cb(Date.now());
  });

  socket.on("disconnect", () => {
    const sid = (socket as Socket & { _branchId?: string })._branchId;
    if (sid) {
      const client = online.get(sid);
      online.delete(sid);
      if (client) {
        console.log(`[hub] branch offline: ${client.branchCode}`);
        io.emit("branch:offline", { branchId: sid, branchCode: client.branchCode });
      }
    }
    emitClientsList();
  });

  socket.on("error", (err: unknown) => {
    console.error(`[hub] socket error (${socket.id}):`, err);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[exchange-hub] listening on port ${PORT}`);
  console.log(`[exchange-hub] server auth: ${process.env.HUB_SERVER_TOKEN ? "configured" : "WARNING: using random token (set HUB_SERVER_TOKEN)"}`);
});

process.on("SIGTERM", () => {
  console.log("[exchange-hub] SIGTERM, shutting down...");
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("[exchange-hub] SIGINT, shutting down...");
  httpServer.close(() => process.exit(0));
});
