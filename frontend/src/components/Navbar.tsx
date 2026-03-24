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
import UserAvatarFallback from "./UserAvatarFallback";

function scrollPageToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navItems = [
    {
      label: "Dashboard",
      to: ROUTES.DASHBOARD,
      active:
        location.pathname === ROUTES.DASHBOARD
        || location.pathname.startsWith("/games/"),
    },
    {
      label: "Highlights",
      to: ROUTES.HIGHLIGHTS,
      active: location.pathname === ROUTES.HIGHLIGHTS,
    },
    {
      label: "Standings",
      to: ROUTES.STANDINGS,
      active: location.pathname === ROUTES.STANDINGS,
    },
    {
      label: "Teams",
      to: ROUTES.TEAMS,
      active: location.pathname === ROUTES.TEAMS || location.pathname.startsWith("/teams/"),
    },
  ];

  return (
    <nav className="sticky top-0 z-40 bg-surface/80 backdrop-blur-lg border-b border-muted/20">
      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10">
        <div className="flex h-14 items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-7 lg:gap-8">
            <div className="flex shrink-0 items-center">
              <Logo size="md" linkTo={ROUTES.HOME} />
            </div>

            <div className="hidden min-w-0 md:flex items-center justify-start gap-5 overflow-x-auto scrollbar-hide">
              {navItems.map((item) => (
                <NavLink
                  key={item.label}
                  to={item.to}
                  onClick={item.to === ROUTES.DASHBOARD || item.to === ROUTES.STANDINGS ? scrollPageToTop : undefined}
                  className={`text-sm transition-colors whitespace-nowrap ${
                    item.active ? "text-foreground font-medium" : "text-muted hover:text-foreground"
                  }`}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-4">
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
              className="surface-avatar-ready flex h-8 w-8 items-center justify-center overflow-hidden rounded-full"
              imgClassName="w-full h-full object-cover"
              loadingContent={<div className="h-full w-full animate-pulse bg-accent/10" />}
              fallback={<UserAvatarFallback className="h-4.5 w-4.5 text-accent/90" />}
            />
          </div>
        </div>
      </div>
    </nav>
  );
}
