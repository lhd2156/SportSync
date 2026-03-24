/**
 * SportSync - SportTabBar Component
 *
 * Horizontal scrollable tab bar for filtering by sport.
 * Includes a "My Teams" shortcut before the standard league tabs.
 */
import { memo } from "react";
import FavoriteIcon from "./FavoriteIcon";
import { SUPPORTED_SPORTS } from "../constants";

type SportTabBarProps = {
  activeSport: string;
  onSelectSport: (sportId: string) => void;
  hasSavedTeams?: boolean;
};

function SportTabBar({ activeSport, onSelectSport, hasSavedTeams }: SportTabBarProps) {
  const tabs = [
    ...(hasSavedTeams ? [{ id: "MY_TEAMS", label: "My Teams" }] : []),
    { id: "ALL", label: "All" },
    ...SUPPORTED_SPORTS,
  ];

  return (
    <div className="flex items-center gap-1.5 py-2 overflow-x-auto scrollbar-hide">
      {tabs.map((tab) => {
        const isActive = activeSport === tab.id;
        const isMyTeams = tab.id === "MY_TEAMS";

        return (
          <button
            key={tab.id}
            onClick={() => onSelectSport(tab.id)}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm whitespace-nowrap transition-all ${
              isActive
                ? "border-accent bg-accent text-white surface-accent-choice-strong"
                : "border-muted/15 bg-surface/60 text-muted hover:border-muted/30 hover:text-foreground"
            }`}
          >
            {isMyTeams && (
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${
                  isActive
                    ? "border-white/20 bg-white/12 text-white"
                    : "border-accent/25 bg-accent/10 text-accent"
                }`}
              >
                <FavoriteIcon className="h-3.5 w-3.5" filled={isActive} />
              </span>
            )}
            <span className={isActive ? "font-semibold" : "font-medium"}>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default memo(SportTabBar);
