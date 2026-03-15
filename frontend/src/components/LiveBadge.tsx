/**
 * SportSync - LiveBadge Component
 *
 * Pulsing accent blue dot shown on all live game cards.
 * Per blueprint: bg-accent animate-pulse.
 */
import { memo } from "react";

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
      <span className="text-xs font-medium text-accent uppercase tracking-wide">Live</span>
    </span>
  );
}

export default memo(LiveBadge);
