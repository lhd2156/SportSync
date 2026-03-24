/**
 * SportSync - Protected Route Component
 *
 * Wraps routes that require authentication and completed onboarding.
 * - No JWT: redirects to /login
 * - JWT but not onboarded: redirects to /onboarding/step-1
 * - JWT and onboarded: renders children
 */
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROUTES } from "../constants";

type ProtectedRouteProps = {
  children: React.ReactNode;
  requireOnboarding?: boolean;
};

export default function ProtectedRoute({
  children,
  requireOnboarding = true,
}: ProtectedRouteProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  /* Show nothing while checking auth state on first load */
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  /* User not logged in at all */
  if (!isAuthenticated || !user) {
    const requestedPath = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        to={`${ROUTES.LOGIN}?redirect=${encodeURIComponent(requestedPath)}`}
        replace
      />
    );
  }

  /* User is logged in but has not completed onboarding */
  if (requireOnboarding && !user.isOnboarded) {
    return <Navigate to={ROUTES.ONBOARDING_STEP_1} replace />;
  }

  return <>{children}</>;
}
