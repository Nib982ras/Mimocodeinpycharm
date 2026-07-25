import React from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, CheckCheck } from "lucide-react";

export interface MessageData {
  id: string;
  fromUserId: string;
  branchId: string;
  fromUser: { username: string; displayName: string };
  toUserId?: string;
  toUser?: { username: string; displayName: string };
  text: string;
  status: "SENT" | "READ" | "DELETED";
  createdAt: string;
  readAt?: string;
}

interface MessageBubbleProps {
  message: MessageData;
  isOwn: boolean;
  showName?: boolean;
}

export function MessageBubble({ message, isOwn, showName = true }: MessageBubbleProps) {
  const timestamp = new Date(message.createdAt);
  const timeAgo = formatDistanceToNow(timestamp, { addSuffix: true });

  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"} mb-3`}>
      <div className={`max-w-xs lg:max-w-md ${isOwn ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-900"} rounded-lg px-4 py-2 shadow`}>
        {showName && !isOwn && (
          <div className="text-xs font-semibold text-gray-700 mb-1">
            {message.fromUser.displayName}
          </div>
        )}
        <div className="text-sm break-words">{message.text}</div>
        <div className={`flex items-center justify-end gap-1 mt-1 text-xs ${isOwn ? "text-blue-100" : "text-gray-500"}`}>
          <span>{timeAgo}</span>
          {isOwn && (
            <>
              {message.status === "READ" ? (
                <CheckCheck className="w-4 h-4 text-blue-300" />
              ) : (
                <Check className="w-4 h-4" />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
