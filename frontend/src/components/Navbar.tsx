/**
 * SportSync - Navbar Component
 *
 * Sticky top navigation bar shown on all authenticated pages.
 * Contains primary navigation and user actions.
 */
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROUTES } from "../constants";
import Logo from "./Logo";
import SafeAvatar from "./SafeAvatar";

export default function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const initials =
    user?.displayName?.charAt(0).toUpperCase() ||
    user?.firstName?.charAt(0).toUpperCase() ||
    user?.email?.charAt(0).toUpperCase() ||
    "?";

  const navItems = [
    {
      label: "Dashboard",
      to: ROUTES.DASHBOARD,
      active: location.pathname === ROUTES.DASHBOARD || location.pathname.startsWith("/games/"),
    },
    {
      label: "Teams",
      to: ROUTES.TEAMS,
      active: location.pathname === ROUTES.TEAMS || location.pathname.startsWith("/teams/"),
    },
    {
      label: "Standings",
      to: ROUTES.STANDINGS,
      active: location.pathname === ROUTES.STANDINGS,
    },
  ];

  return (
    <nav className="sticky top-0 z-40 bg-surface/80 backdrop-blur-lg border-b border-muted/20">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between gap-4 h-14">
          <div className="flex min-w-0 items-center gap-8">
            <Logo size="md" linkTo={ROUTES.HOME} />

            <div className="hidden md:flex items-center gap-5 overflow-x-auto scrollbar-hide">
              {navItems.map((item) => (
                <NavLink
                  key={item.label}
                  to={item.to}
                  className={`text-sm transition-colors whitespace-nowrap ${
                    item.active ? "text-foreground font-medium" : "text-muted hover:text-foreground"
                  }`}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>

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
            <SafeAvatar
              src={user?.profilePictureUrl}
              alt="Profile"
              className="w-8 h-8 rounded-full overflow-hidden bg-accent/20 border border-accent/20 flex items-center justify-center text-accent text-sm font-bold"
              imgClassName="w-full h-full object-cover"
              loadingContent={<div className="h-full w-full animate-pulse bg-accent/10" />}
              fallback={initials}
            />
          </div>
        </div>
      </div>
    </nav>
  );
}
