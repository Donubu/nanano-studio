"use client";

import type { CollabUser } from "@/lib/collaboration/types";
import { useReactFlow } from "@xyflow/react";

interface ConnectorGhostProps {
  remoteUsers: CollabUser[];
}

export function ConnectorGhost({ remoteUsers }: ConnectorGhostProps) {
  const { getNode, flowToScreenPosition } = useReactFlow();

  const draggingUsers = remoteUsers.filter((u) => u.connectorDrag?.endPoint);

  if (draggingUsers.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
      <svg className="absolute inset-0 w-full h-full">
        {draggingUsers.map((user) => {
          const drag = user.connectorDrag!;
          const node = getNode(drag.nodeId);
          if (!node || !drag.endPoint) return null;

          // Approximate handle position from node position
          const isSource = drag.handleType === "source";
          const startFlow = {
            x: node.position.x + (isSource ? (node.measured?.width || 280) : 0),
            y: node.position.y + (node.measured?.height || 60) / 2,
          };

          const startScreen = flowToScreenPosition(startFlow);
          const endScreen = flowToScreenPosition(drag.endPoint);

          return (
            <line
              key={user.userId}
              x1={startScreen.x}
              y1={startScreen.y}
              x2={endScreen.x}
              y2={endScreen.y}
              stroke={user.color}
              strokeWidth={2}
              strokeDasharray="6 3"
              opacity={0.6}
            />
          );
        })}
      </svg>
    </div>
  );
}
