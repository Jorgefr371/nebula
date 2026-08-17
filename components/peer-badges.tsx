"use client";

import { useEbook } from "@/lib/store/ebook";
import { cn } from "@/lib/utils";

/** Color estable por persona, derivado del id: el mismo siempre para cada una. */
function hueFor(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) % 360;
  }
  return hash;
}

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function PeerBadges() {
  const peers = useEbook((state) => state.peers);
  if (peers.length === 0) return null;

  return (
    <div className="flex items-center -space-x-1.5">
      {peers.slice(0, 4).map((peer) => {
        const busy = peer.phase === "working" || peer.phase === "thinking";
        return (
          <span
            key={peer.userId}
            title={`${peer.name}${busy ? " está escribiendo" : ""}`}
            className={cn(
              "relative grid size-6 place-items-center rounded-full border-2 border-background text-[10px] font-medium text-primary-foreground",
              busy && "ring-2 ring-primary/70",
            )}
            style={{ backgroundColor: `hsl(${hueFor(peer.userId)} 60% 45%)` }}
          >
            {initials(peer.name)}
            {busy ? (
              <span className="absolute -right-0.5 -bottom-0.5 size-2 animate-pulse rounded-full bg-primary ring-2 ring-background" />
            ) : null}
          </span>
        );
      })}

      {peers.length > 4 ? (
        <span className="grid size-6 place-items-center rounded-full border-2 border-background bg-surface-raised text-[10px] text-muted-foreground">
          +{peers.length - 4}
        </span>
      ) : null}
    </div>
  );
}
