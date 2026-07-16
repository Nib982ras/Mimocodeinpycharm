"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * Auth context — replaces the old ClientMode.
 *
 * The current user is loaded from `/api/auth/me` on mount. If null, the app
 * shows the login screen. Once authenticated, the hub connection is established
 * automatically using the user's branch identity (no manual identity picker).
 *
 * Admin users (role=ADMIN) have no branch and therefore don't join the hub as a
 * branch client — they observe. Regular users (role=USER) join as their branch.
 */

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "USER";
  branchId: string | null;
  branch: { id: string; code: string; name: string; type: string } | null;
}

export interface OnlineClient {
  socketId: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  branchType: string;
  connectedAt: number;
}

export interface LiveNotification {
  id: string;
  kind: "delivered" | "sent" | "decrypted" | "branch" | "presence";
  title: string;
  description: string;
  createdAt: number;
}

interface AuthValue {
  user: SessionUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  // Hub state
  connected: boolean;
  onlineClients: OnlineClient[];
  notifications: LiveNotification[];
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [onlineClients, setOnlineClients] = useState<OnlineClient[]>([]);
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      const data = await res.json();
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // If any API call returns 401 (session expired / invalidated), re-check the
  // session. getSession will return null → user becomes null → login screen.
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setNotifications([]);
      setOnlineClients([]);
      setConnected(false);
      // Re-check in case it was a transient issue; if the session is truly gone
      // /api/auth/me returns { user: null } and we stay on the login screen.
      refresh();
    };
    window.addEventListener("auth:unauthorized", onUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", onUnauthorized);
  }, [refresh]);

  const pushNotification = useCallback((n: Omit<LiveNotification, "id" | "createdAt">) => {
    setNotifications((prev) =>
      [{ ...n, id: Math.random().toString(36).slice(2), createdAt: Date.now() }, ...prev].slice(0, 12)
    );
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          return { ok: false, error: data.error || "Login failed" };
        }
        setUser(data.user);
        return { ok: true };
      } catch {
        return { ok: false, error: "Network error" };
      }
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* ignore */
    }
    setUser(null);
    setNotifications([]);
    setOnlineClients([]);
    setConnected(false);
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);
  const clearNotifications = useCallback(() => setNotifications([]), []);

  // Establish the hub connection whenever the user changes.
  // Only USER accounts (with a branch) join as a branch client.
  useEffect(() => {
    if (!user || user.role !== "USER" || !user.branch) {
      return;
    }
    const identity = user.branch;
    const sock = io("/?XTransformPort=3003", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      timeout: 8000,
    });
    socketRef.current = sock;

    sock.on("connect", () => {
      setConnected(true);
      sock.emit("client:join", {
        branchId: identity.id,
        branchCode: identity.code,
        branchName: identity.name,
        branchType: identity.type,
      });
    });
    sock.on("disconnect", () => setConnected(false));
    sock.on("connect_error", () => setConnected(false));

    sock.on("client:joined", () => {
      pushNotification({
        kind: "presence",
        title: `Connected as ${identity.code}`,
        description: `${identity.name} is now online on the exchange hub.`,
      });
    });

    sock.on("clients:list", (data: { clients: OnlineClient[]; count: number }) => {
      setOnlineClients(data.clients);
    });

    sock.on("branch:online", (data: { client: OnlineClient }) => {
      pushNotification({
        kind: "presence",
        title: `${data.client.branchCode} came online`,
        description: `${data.client.branchName} joined the exchange network.`,
      });
    });
    sock.on("branch:offline", (data: { branchId: string; branchCode: string }) => {
      pushNotification({
        kind: "presence",
        title: `${data.branchCode} went offline`,
        description: `${data.branchCode} disconnected from the hub.`,
      });
    });

    sock.on("branch:created", (data: { branch: { id: string; code: string; name: string; type: string } }) => {
      pushNotification({
        kind: "branch",
        title: `New node joined: ${data.branch.code}`,
        description: `${data.branch.name} (${data.branch.type}) provisioned with ECC P-521 keys.`,
      });
    });

    sock.on("document:delivered", (doc: { id: string; name: string; sender: { code: string }; recipient: { code: string } }) => {
      if (doc.recipient.code === identity.code) {
        pushNotification({
          kind: "delivered",
          title: `Encrypted document received`,
          description: `${doc.sender.code} → you · ${doc.name}`,
        });
      }
    });
    sock.on("document:sent", (doc: { id: string; name: string; sender: { code: string }; recipient: { code: string } }) => {
      if (doc.sender.code === identity.code) {
        pushNotification({
          kind: "sent",
          title: `Dispatch confirmed`,
          description: `${doc.name} delivered to ${doc.recipient.code}.`,
        });
      }
    });
    sock.on("document:decrypted", (doc: { id: string; name: string; sender: { code: string }; recipient: { code: string } }) => {
      if (doc.sender.code === identity.code) {
        pushNotification({
          kind: "decrypted",
          title: `Receipt: ${doc.recipient.code} opened your document`,
          description: `${doc.name} was decrypted by the recipient.`,
        });
      }
    });

    return () => {
      sock.disconnect();
      socketRef.current = null;
      setConnected(false);
      setOnlineClients([]);
    };
  }, [user?.id, pushNotification]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        refresh,
        connected,
        onlineClients,
        notifications,
        dismissNotification,
        clearNotifications,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
