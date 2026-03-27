"use client";

import type { CollabUser } from "@/lib/collaboration/types";
import { Wifi, WifiOff } from "lucide-react";

interface PresenceBarProps {
  remoteUsers: CollabUser[];
  localUser?: { name: string; image?: string | null; color: string };
  isConnected: boolean;
}

export function PresenceBar({ remoteUsers, localUser, isConnected }: PresenceBarProps) {
  if (!isConnected && remoteUsers.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-2 py-1.5 shadow-lg">
      {/* Connection status */}
      {!isConnected && (
        <div className="flex items-center gap-1 text-[10px] text-amber-400">
          <WifiOff className="h-3 w-3" />
          <span>Reconectando...</span>
        </div>
      )}

      {isConnected && remoteUsers.length === 0 && !localUser && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Wifi className="h-3 w-3" />
        </div>
      )}

      {/* Local user (Tú) */}
      {isConnected && localUser && (
        <div className="relative group" title="Tú">
          {localUser.image ? (
            <img
              src={localUser.image}
              alt="Tú"
              className="h-6 w-6 rounded-full"
              style={{ outline: `2px solid ${localUser.color}`, outlineOffset: "1px" }}
            />
          ) : (
            <div
              className="h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
              style={{ backgroundColor: localUser.color, outline: `2px solid ${localUser.color}`, outlineOffset: "1px" }}
            >
              {localUser.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="absolute -bottom-1 -right-1 bg-green-500 w-2 h-2 rounded-full border border-background" />
          <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 hidden group-hover:block">
            <div className="px-1.5 py-0.5 rounded text-[9px] text-white whitespace-nowrap shadow bg-foreground/80">
              Tú
            </div>
          </div>
        </div>
      )}

      {/* Separator if both local and remote */}
      {isConnected && localUser && remoteUsers.length > 0 && (
        <div className="w-px h-4 bg-border" />
      )}

      {/* Remote user avatars */}
      {remoteUsers.map((user) => (
        <div
          key={user.userId}
          className="relative group"
          title={user.name}
        >
          {user.image ? (
            <img
              src={user.image}
              alt={user.name}
              className="h-6 w-6 rounded-full"
              style={{ outline: `2px solid ${user.color}`, outlineOffset: "1px" }}
            />
          ) : (
            <div
              className="h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
              style={{ backgroundColor: user.color, outline: `2px solid ${user.color}`, outlineOffset: "1px" }}
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}

          {/* Tooltip */}
          <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 hidden group-hover:block">
            <div
              className="px-1.5 py-0.5 rounded text-[9px] text-white whitespace-nowrap shadow"
              style={{ backgroundColor: user.color }}
            >
              {user.name}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
