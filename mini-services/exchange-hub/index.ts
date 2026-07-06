import { createServer } from "http";
import { Server, type Socket } from "socket.io";

/**
 * Exchange Hub — real-time presence & event broker for the Secure Multi-Branch
 * Document Exchange System.
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
 *
 * The Next.js API server notifies the hub by connecting as a privileged
 * "server" client (via socket.io-client) and emitting `server:notify` events.
 * This keeps everything on the socket channel — no competing HTTP routes.
 */

const PORT = 3003;

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

const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

function emitClientsList(target?: Socket) {
  const list = Array.from(online.values());
  const payload = { clients: list, count: list.length };
  if (target) target.emit("clients:list", payload);
  else io.emit("clients:list", payload);
}

/** Event payload the Next.js API server forwards to the hub. */
interface NotifyEvent {
  type: "document:delivered" | "document:decrypted" | "branch:created";
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
}

io.on("connection", (socket: Socket) => {
  console.log(`[hub] socket connected: ${socket.id}`);

  // Privileged server-to-server channel (Next.js API → hub)
  socket.on("server:notify", (evt: NotifyEvent) => {
    routeNotify(evt);
  });

  // A branch client identifies itself
  socket.on("client:join", (data: { branchId: string; branchCode: string; branchName: string; branchType: string }) => {
    if (!data || !data.branchId) return;
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
    console.log(`[hub] branch online: ${data.branchCode} (${data.branchName})`);

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
});

process.on("SIGTERM", () => {
  console.log("[exchange-hub] SIGTERM, shutting down...");
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("[exchange-hub] SIGINT, shutting down...");
  httpServer.close(() => process.exit(0));
});
