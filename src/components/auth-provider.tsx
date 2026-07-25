"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { ROLE_RANK, type SessionUser as SessionUserType } from "@/lib/types";

/**
 * Auth context — replaces the old ClientMode.
 *
 * The current user is loaded from `/api/auth/me` on mount. If null, the app
 * shows the login screen. Once authenticated, the hub connection is established
 * automatically using the user's branch identity (no manual identity picker).
 *
 * Regular branch users (USER / BRANCH_ADMIN) join the exchange hub as their
 * branch; SECURITY_ADMIN+ observe without joining.
 *
 * Login supports 2FA: if the backend returns `{ ok:false, requiresTwoFactor:true }`,
 * the caller collects a 6-digit TOTP code (or an 8-char backup code) and resubmits.
 */

export type SessionUser = SessionUserType;

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
  kind: "delivered" | "sent" | "decrypted" | "branch" | "presence" | "message";
  title: string;
  description: string;
  createdAt: number;
}

export interface LoginResult {
  ok: boolean;
  requiresTwoFactor?: boolean;
  error?: string;
}

interface AuthValue {
  user: SessionUser | null;
  loading: boolean;
  login: (username: string, password: string, totpCode?: string, backupCode?: string) => Promise<LoginResult>;
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
      setUser((data.user as SessionUser | null) ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initialize session on mount
  useEffect(() => {
    let isMounted = true;
    const initSession = async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        const data = await res.json();
        if (isMounted) setUser((data.user as SessionUser | null) ?? null);
      } catch {
        if (isMounted) setUser(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    initSession();
    return () => { isMounted = false; };
  }, []);

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
    async (
      username: string,
      password: string,
      totpCode?: string,
      backupCode?: string
    ): Promise<LoginResult> => {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, totpCode, backupCode }),
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) {
          // 2FA prompt — backend returns 200 with requiresTwoFactor, but be defensive.
          if (data.requiresTwoFactor) return { ok: false, requiresTwoFactor: true };
          return { ok: false, error: data.error || "Login failed" };
        }
        if (!data.ok) {
          if (data.requiresTwoFactor) return { ok: false, requiresTwoFactor: true };
          return { ok: false, error: data.error || "Login failed" };
        }
        setUser(data.user as SessionUser);
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
  // All authenticated users connect; branch users also join as a branch client.
  useEffect(() => {
    if (!user) return;
    const isBranchUser =
      (user.role === "USER" || user.role === "BRANCH_ADMIN") && !!user.branch;
    const identity = user.branch;
    const sock = io("http://localhost:3003", {
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
      if (isBranchUser && identity) {
        sock.emit("client:join", {
          branchId: identity.id,
          branchCode: identity.code,
          branchName: identity.name,
          branchType: identity.type,
        });
      }
    });
    sock.on("disconnect", () => setConnected(false));
    sock.on("connect_error", () => setConnected(false));

    sock.on("client:joined", () => {
      if (identity) {
        pushNotification({
          kind: "presence",
          title: `Connected as ${identity.code}`,
          description: `${identity.name} is now online on the exchange hub.`,
        });
      }
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

    if (isBranchUser && identity) {
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
    }

    sock.on("message:receive", (msg: any) => {
      pushNotification({
        kind: "message",
        title: `Message from ${msg.fromUser.displayName}`,
        description: msg.text.length > 50 ? msg.text.substring(0, 50) + "..." : msg.text,
      });
    });

    return () => {
      sock.disconnect();
      socketRef.current = null;
      setConnected(false);
      setOnlineClients([]);
    };
  }, [user?.id, pushNotification]);

  // Expose ROLE_RANK indirectly through the context value via `user.role`.
  void ROLE_RANK;

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
