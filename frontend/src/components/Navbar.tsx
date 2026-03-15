/**
 * SportSync - Navbar Component
 *
 * Sticky top navigation bar shown on all authenticated pages.
 * Contains logo, sport tab bar, and user actions.
 */
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROUTES, SUPPORTED_SPORTS } from "../constants";

export default function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <nav className="sticky top-0 z-40 bg-surface/80 backdrop-blur-lg border-b border-muted/20">
      <div className="max-w-7xl mx-auto px-4">
        {/* Top row: logo + user actions */}
        <div className="flex items-center justify-between h-14">
          <Link to={ROUTES.DASHBOARD} className="text-xl font-bold text-accent">
            SportSync
          </Link>

          <div className="flex items-center gap-4">
            <Link
              to={ROUTES.SETTINGS}
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Settings
            </Link>
            <button
              onClick={logout}
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Sign Out
            </button>
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-bold">
              {user?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || "?"}
            </div>
          </div>
        </div>

        {/* Bottom row: sport tab bar */}
        <div className="flex items-center gap-1 pb-2 overflow-x-auto scrollbar-hide">
          <NavTab to={ROUTES.DASHBOARD} label="All" currentPath={location.pathname} />
          {SUPPORTED_SPORTS.map((sport) => (
            <NavTab
              key={sport.id}
              to={`${ROUTES.SCORES}?sport=${sport.id}`}
              label={sport.label}
              currentPath={location.pathname}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}

function NavTab({
  to,
  label,
  currentPath,
}: {
  to: string;
  label: string;
  currentPath: string;
}) {
  const isActive = currentPath === to.split("?")[0];
  return (
    <Link
      to={to}
      className={`px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
        isActive
          ? "bg-accent text-foreground font-medium"
          : "text-muted hover:text-foreground hover:bg-surface"
      }`}
    >
      {label}
    </Link>
  );
}
