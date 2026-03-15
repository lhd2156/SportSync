/**
 * SportSync - SportTabBar Component
 *
 * Horizontal scrollable tab bar for filtering by sport.
 * Tabs: All, NBA, NHL, MLB, NFL, MLS, EPL
 * Active tab highlighted in accent blue.
 */
import { memo } from "react";
import { SUPPORTED_SPORTS } from "../constants";

interface SportTabBarProps {
  activeSport: string;
  onSelectSport: (sportId: string) => void;
}

function SportTabBar({ activeSport, onSelectSport }: SportTabBarProps) {
  const tabs = [{ id: "ALL", label: "All" }, ...SUPPORTED_SPORTS];

  return (
    <div className="flex items-center gap-1 py-2 overflow-x-auto scrollbar-hide">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelectSport(tab.id)}
          className={`px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
            activeSport === tab.id
              ? "bg-accent text-foreground font-medium"
              : "text-muted hover:text-foreground hover:bg-surface"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default memo(SportTabBar);
