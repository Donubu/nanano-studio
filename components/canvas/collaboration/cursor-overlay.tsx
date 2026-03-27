"use client";

import { useStore, useReactFlow } from "@xyflow/react";
import type { CollabUser } from "@/lib/collaboration/types";

interface CursorOverlayProps {
  remoteUsers: CollabUser[];
}

export function CursorOverlay({ remoteUsers }: CursorOverlayProps) {
  const { getNode } = useReactFlow();
  // Subscribe to viewport transform so overlay re-renders on pan/zoom
  const transform = useStore((s) => s.transform);
  const [tx, ty, zoom] = transform;

  const usersWithCursor = remoteUsers.filter((u) => u.cursor);
  const usersWithSelection = remoteUsers.filter((u) => u.selectedNodeId);

  if (usersWithCursor.length === 0 && usersWithSelection.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      {/* Selection highlights — positioned in flow-space via viewport transform */}
      {usersWithSelection.map((user) => {
        const node = getNode(user.selectedNodeId!);
        if (!node) return null;
        const w = node.measured?.width || 280;
        const h = node.measured?.height || 80;
        const x = node.position.x * zoom + tx;
        const y = node.position.y * zoom + ty;

        return (
          <div key={`sel-${user.userId}`}>
            <div
              className="absolute rounded-xl"
              style={{
                left: x - 4,
                top: y - 4,
                width: w * zoom + 8,
                height: h * zoom + 8,
                border: `2px solid ${user.color}`,
                opacity: 0.5,
              }}
            />
            <div
              className="absolute px-1.5 py-0.5 rounded text-[9px] font-medium text-white whitespace-nowrap"
              style={{
                left: x,
                top: y - 18,
                backgroundColor: user.color,
              }}
            >
              {user.name}
            </div>
          </div>
        );
      })}

      {/* Remote cursors — also in flow-space converted to screen via viewport */}
      {usersWithCursor.map((user) => {
        if (!user.cursor) return null;
        const sx = user.cursor.x * zoom + tx;
        const sy = user.cursor.y * zoom + ty;

        return (
          <div
            key={user.userId}
            className="absolute"
            style={{
              transform: `translate(${sx}px, ${sy}px)`,
              transition: "transform 80ms linear",
            }}
          >
            <svg width="16" height="20" viewBox="0 0 16 20" fill="none" className="-ml-0.5 -mt-0.5">
              <path
                d="M1 1L1 17L5.5 12.5L10 19L13 17.5L8.5 11L14 10L1 1Z"
                fill={user.color}
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <div
              className="ml-4 -mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white whitespace-nowrap shadow-sm"
              style={{ backgroundColor: user.color }}
            >
              {user.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
