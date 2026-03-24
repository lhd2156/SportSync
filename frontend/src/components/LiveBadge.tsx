/**
 * SportSync - LiveBadge Component
 *
 * Pulsing red live indicator shown on all live game cards.
 */
import { memo } from "react";

function LiveBadge() {
  return (
    <span className="surface-live-badge inline-flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-[color:var(--danger-strong)] animate-pulse" />
      <span className="text-xs font-medium uppercase tracking-wide">Live</span>
    </span>
  );
}

export default memo(LiveBadge);
