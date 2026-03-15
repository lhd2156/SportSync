/**
 * SportSync - Footer Component
 *
 * Present on every page. Contains logo, nav links, legal links,
 * 18+ notice, copyright, and version number.
 */
import { Link } from "react-router-dom";
import { APP_NAME, APP_VERSION, ROUTES } from "../constants";
import Logo from "./Logo";

export default function Footer() {
  return (
    <footer className="bg-surface border-t border-muted/20 py-8 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-8">
          {/* Brand */}
          <div>
            <Logo size="sm" linkTo={ROUTES.HOME} />
            <p className="text-muted text-sm mt-2">
              Your personalized sports command center.
            </p>
          </div>

          {/* Navigation links */}
          <div>
            <h4 className="text-foreground-base font-medium text-sm mb-3">Navigate</h4>
            <nav className="flex flex-col gap-2">
              <Link to={ROUTES.HOME} className="text-muted text-sm hover:text-accent transition-colors">Home</Link>
              <Link to={ROUTES.SCORES} className="text-muted text-sm hover:text-accent transition-colors">Scores</Link>
              <Link to={ROUTES.TEAMS} className="text-muted text-sm hover:text-accent transition-colors">Teams</Link>
              <Link to={ROUTES.ABOUT} className="text-muted text-sm hover:text-accent transition-colors">About</Link>
            </nav>
          </div>

          {/* Legal links */}
          <div>
            <h4 className="text-foreground-base font-medium text-sm mb-3">Legal</h4>
            <nav className="flex flex-col gap-2">
              <Link to={ROUTES.TERMS} className="text-muted text-sm hover:text-accent transition-colors">Terms of Service</Link>
              <Link to={ROUTES.PRIVACY} className="text-muted text-sm hover:text-accent transition-colors">Privacy Policy</Link>
              <Link to={ROUTES.COOKIES} className="text-muted text-sm hover:text-accent transition-colors">Cookie Policy</Link>
            </nav>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-muted/20 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-center gap-4 text-xs text-muted">
            <span>2026 {APP_NAME}. All rights reserved.</span>
            <span className="hidden sm:inline">|</span>
            <span>{APP_NAME} is intended for users 18 years of age and older.</span>
          </div>
          <span className="text-xs text-muted">v{APP_VERSION}</span>
        </div>
      </div>
    </footer>
  );
}
