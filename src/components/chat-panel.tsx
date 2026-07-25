"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { MessageBubble, type MessageData } from "@/components/ui/message-bubble";
import { useAuth } from "@/components/auth-provider";
import { Send, Loader, MessageCircle, ChevronUp, ChevronDown, X } from "lucide-react";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 320;

interface DmUser {
  id: string;
  displayName: string;
  branchCode: string;
}

export function ChatPanel({ dmUser, onClearDm }: { dmUser?: DmUser | null; onClearDm?: () => void }) {
  const auth = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const isMountedRef = useRef(true);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const user = auth?.user;
  const socket = (auth as any)?.socket;

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load initial messages
  useEffect(() => {
    if (!user) return;

    let isMountedLocal = true;

    const loadMessages = async () => {
      try {
        const qs = dmUser ? `?userId=${dmUser.id}&limit=50` : "?limit=50";
        const res = await fetch(`/api/messages${qs}`, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load messages");
        const data = await res.json();
        if (isMountedLocal) {
          setMessages(data.messages || []);
        }
      } catch (err) {
        console.error("Failed to load messages:", err);
      }
    };

    loadMessages();

    return () => {
      isMountedLocal = false;
    };
  }, [user, dmUser?.id]);

  // Listen for real-time messages
  useEffect(() => {
    if (!socket || !user) return;

    const handleMessage = (msg: MessageData) => {
      if (dmUser) {
        // DM mode: only show messages between me and the target user
        const isFromMe = msg.fromUserId === user.id;
        const isToMe = msg.toUserId === user.id;
        const isFromTarget = msg.fromUserId === dmUser.id;
        const isToTarget = msg.toUserId === dmUser.id;
        if ((isFromMe && isToTarget) || (isFromTarget && isToMe)) {
          setMessages((prev) => [...prev, msg]);
        }
      } else {
        // Branch mode: only broadcast messages (no toUserId) in my branch
        if (msg.branchId === user.branchId && !msg.toUserId) {
          setMessages((prev) => [...prev, msg]);
        }
      }
    };

    socket.on("message:receive", handleMessage);

    return () => {
      socket.off("message:receive", handleMessage);
    };
  }, [socket, user, dmUser?.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Resize drag handlers
  const onDragStart = useCallback((e: React.MouseEvent) => {
    draggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = height;
    e.preventDefault();
  }, [height]);

  useEffect(() => {
    const onDragMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = startYRef.current - e.clientY;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeightRef.current + delta));
      setHeight(newHeight);
    };
    const onDragEnd = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    return () => {
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragEnd);
    };
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading || !user) return;

    const messageText = input.trim();
    setInput("");
    setLoading(true);

    try {
      const body: Record<string, string> = { text: messageText };
      if (dmUser) body.toUserId = dmUser.id;

      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const error = await res.json();
        console.error("Failed to send message:", error);
      }
    } catch (err) {
      console.error("Error sending message:", err);
      setInput(messageText);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return null;
  }

  const headerLabel = dmUser
    ? `Chat with ${dmUser.displayName}`
    : user.branch?.name || "Chat";
  const headerSub = dmUser
    ? `@${dmUser.branchCode} · ${messages.length} messages`
    : `${user.branch?.code || "Branch"} · ${messages.length} messages`;

  return (
    <div
      className="flex flex-col bg-white border border-gray-200 rounded-lg shadow-md overflow-hidden"
      style={{ height: collapsed ? "auto" : height }}
    >
      {/* Header — always visible, acts as toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-4 py-2.5 flex items-center justify-between hover:from-blue-600 hover:to-blue-700 transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <MessageCircle className="h-4 w-4 shrink-0" />
          <span className="font-semibold text-sm truncate">{headerLabel}</span>
          <span className="text-xs text-blue-200 shrink-0">· {messages.length}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {dmUser && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onClearDm?.(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onClearDm?.(); } }}
              className="p-0.5 rounded hover:bg-blue-700 transition-colors"
              title="Back to branch chat"
            >
              <X className="h-3.5 w-3.5 text-blue-200" />
            </span>
          )}
          {collapsed ? (
            <ChevronUp className="h-4 w-4 text-blue-200" />
          ) : (
            <ChevronDown className="h-4 w-4 text-blue-200" />
          )}
        </div>
      </button>

      {/* Resizable handle — only when expanded */}
      {!collapsed && (
        <div
          onMouseDown={onDragStart}
          className="h-1.5 bg-slate-200 hover:bg-slate-300 cursor-ns-resize flex items-center justify-center group shrink-0"
        >
          <div className="w-8 h-0.5 rounded-full bg-slate-400 group-hover:bg-slate-500" />
        </div>
      )}

      {/* Body — hidden when collapsed */}
      {!collapsed && (
        <>
          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50 min-h-0">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                <span className="text-3xl">💬</span>
                <p className="text-sm font-medium text-gray-500">
                  {dmUser
                    ? `Start a conversation with ${dmUser.displayName}`
                    : "No messages yet. Start the conversation!"}
                </p>
                <form onSubmit={handleSend} className="flex gap-2 w-full max-w-xs">
                  <input
                    type="text"
                    placeholder={dmUser ? `Message ${dmUser.displayName}...` : "Type a message..."}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={loading}
                    autoFocus
                    className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white px-3 py-2 rounded flex items-center gap-1.5 transition text-sm font-medium"
                  >
                    {loading ? (
                      <Loader className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </form>
              </div>
            ) : (
              messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isOwn={msg.fromUserId === user.id}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <form
            onSubmit={handleSend}
            className="border-t border-gray-200 bg-white px-4 py-3 flex gap-2 shrink-0"
          >
            <input
              type="text"
              placeholder={dmUser ? `Message ${dmUser.displayName}...` : "Type a message..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white px-4 py-2 rounded flex items-center gap-2 transition text-sm font-medium"
            >
              {loading ? (
                <Loader className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
        </>
      )}
    </div>
  );
}
