"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import type { Branch } from "@/lib/types";

/**
 * Client Mode — the user picks which branch they are operating as. This simulates
 * each branch being an independent client connected to the central exchange hub.
 *
 * The hub connection (socket.io) is established whenever a branch identity is
 * chosen. The hub tracks presence and broadcasts real-time events:
 *   - document:delivered  → a new encrypted package arrived for the recipient
 *   - document:sent       → dispatch confirmation for the sender
 *   - document:decrypted  → receipt confirmation for the sender
 *   - branch:created      → a new node joined the topology
 *   - branch:online/offline → presence changes
 *   - clients:list        → current online branch list
 */

export interface OnlineClient {
  socketId: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  branchType: string;
  connectedAt: number;
}

export interface HubDocumentEvent {
  id: string;
  name: string;
  sender: { code: string; name: string };
  recipient: { code: string; name: string };
  size: number;
}

export interface LiveNotification {
  id: string;
  kind: "delivered" | "sent" | "decrypted" | "branch" | "presence";
  title: string;
  description: string;
  createdAt: number;
}

interface ClientModeValue {
  // The branch this browser is acting as (null = admin/observer mode)
  identity: Branch | null;
  setIdentity: (b: Branch | null) => void;
  branches: Branch[];
  setBranches: (b: Branch[]) => void;
  // Hub state
  connected: boolean;
  onlineClients: OnlineClient[];
  notifications: LiveNotification[];
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
}

const ClientModeContext = createContext<ClientModeValue | null>(null);

const STORAGE_KEY = "secure-exchange.identity";

export function ClientModeProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [onlineClients, setOnlineClients] = useState<OnlineClient[]>([]);
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);

  // Load saved identity from localStorage via lazy initializer (no effect needed).
  const [identity, setIdentityState] = useState<Branch | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Branch;
    } catch {
      /* ignore */
    }
    return null;
  });

  // Load branches list (for the identity picker)
  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setBranches(d.branches);
      })
      .catch(() => {});
  }, []);

  const pushNotification = useCallback((n: Omit<LiveNotification, "id" | "createdAt">) => {
    setNotifications((prev) =>
      [{ ...n, id: Math.random().toString(36).slice(2), createdAt: Date.now() }, ...prev].slice(0, 12)
    );
  }, []);

  const setIdentity = useCallback((b: Branch | null) => {
    setIdentityState(b);
    try {
      if (b) localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: b.id, code: b.code, name: b.name, type: b.type, region: b.region, parentId: b.parentId ?? null }));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);
  const clearNotifications = useCallback(() => setNotifications([]), []);

  // Establish the hub connection whenever identity changes. When identity is
  // null we simply don't create a socket (cleanup of the previous one happens
  // in the effect's return function).
  useEffect(() => {
    if (!identity) {
      // No-op: nothing to connect to. Any prior socket is cleaned up by the
      // previous effect run's return function.
      return;
    }

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
      // Refresh branches list
      fetch("/api/branches").then((r) => r.json()).then((d) => { if (d.ok) setBranches(d.branches); }).catch(() => {});
    });

    sock.on("document:delivered", (doc: HubDocumentEvent) => {
      if (doc.recipient.code === identity.code) {
        pushNotification({
          kind: "delivered",
          title: `Encrypted document received`,
          description: `${doc.sender.code} → you · ${doc.name}`,
        });
      }
    });
    sock.on("document:sent", (doc: HubDocumentEvent) => {
      if (doc.sender.code === identity.code) {
        pushNotification({
          kind: "sent",
          title: `Dispatch confirmed`,
          description: `${doc.name} delivered to ${doc.recipient.code}.`,
        });
      }
    });
    sock.on("document:decrypted", (doc: HubDocumentEvent) => {
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
  }, [identity?.id]);

  return (
    <ClientModeContext.Provider
      value={{
        identity,
        setIdentity,
        branches,
        setBranches,
        connected,
        onlineClients,
        notifications,
        dismissNotification,
        clearNotifications,
      }}
    >
      {children}
    </ClientModeContext.Provider>
  );
}

export function useClientMode(): ClientModeValue {
  const ctx = useContext(ClientModeContext);
  if (!ctx) throw new Error("useClientMode must be used within ClientModeProvider");
  return ctx;
}
