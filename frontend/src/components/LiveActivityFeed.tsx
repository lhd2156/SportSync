/**
 * SportSync - LiveActivityFeed Component
 *
 * Real-time play-by-play feed. Each item shows a play description
 * with score context and timestamp. Filter: All or My Teams.
 * Updates via WebSocket events.
 */
import { useState, memo } from "react";

interface FeedItem {
  id: string;
  gameId: string;
  teamName: string;
  teamLogo?: string | null;
  description: string;
  scoreContext: string;
  timestamp: string;
  isSavedTeam?: boolean;
}

interface LiveActivityFeedProps {
  items: FeedItem[];
}

function LiveActivityFeed({ items }: LiveActivityFeedProps) {
  const [filter, setFilter] = useState<"all" | "my-teams">("all");

  const filtered = filter === "my-teams"
    ? items.filter((item) => item.isSavedTeam)
    : items;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Live Activity</h2>
        <div className="flex gap-1 bg-surface rounded-lg p-0.5">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === "all"
                ? "bg-accent text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            All Games
          </button>
          <button
            onClick={() => setFilter("my-teams")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === "my-teams"
                ? "bg-accent text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            My Teams
          </button>
        </div>
      </div>

      <div className="bg-surface border border-muted/20 rounded-xl divide-y divide-muted/10 max-h-[400px] overflow-y-auto scrollbar-hide">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            {filter === "my-teams"
              ? "No live activity for your saved teams right now."
              : "No live activity right now. Check back during game time."}
          </div>
        ) : (
          filtered.map((item) => (
            <div key={item.id} className="flex items-start gap-3 px-4 py-3 hover:bg-background/50 transition-colors">
              {/* Team logo or placeholder */}
              {item.teamLogo ? (
                <img src={item.teamLogo} alt={item.teamName} className="w-8 h-8 rounded-full mt-0.5 object-contain" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent mt-0.5">
                  {item.teamName.charAt(0)}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground leading-snug">{item.description}</p>
                <p className="text-xs text-muted mt-0.5">{item.scoreContext}</p>
              </div>

              <span className="text-xs text-muted whitespace-nowrap mt-1">{item.timestamp}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default memo(LiveActivityFeed);
