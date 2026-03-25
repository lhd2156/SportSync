/**
 * SportSync - Application Root
 *
 * Sets up providers (Auth, Cookies, React Query) and the router.
 * All routes defined here with appropriate guards.
 */
import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, matchPath } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./context/AuthContext";
import { CookieProvider } from "./context/CookieContext";
import ProtectedRoute from "./components/ProtectedRoute";
import CookieBanner from "./components/CookieBanner";
import ScrollToTop from "./components/ScrollToTop";
import { APP_NAME, ROUTES } from "./constants";
import { queryClient } from "./lib/queryClient";

/* Pages */
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import OnboardingStep1 from "./pages/OnboardingStep1";
import OnboardingStep2 from "./pages/OnboardingStep2";
import OnboardingStep3 from "./pages/OnboardingStep3";
import DashboardPage from "./pages/DashboardPage";
import HighlightsPage from "./pages/HighlightsPage";
import Teams from "./pages/Teams";
import GameDetailPage from "./pages/GameDetailPage";
import TeamDetail from "./pages/TeamDetail";
import StandingsPage from "./pages/StandingsPage";
import SettingsPage from "./pages/SettingsPage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import CookiePolicyPage from "./pages/CookiePolicyPage";
import AboutPage from "./pages/AboutPage";

const PAGE_TITLES: Array<{ path: string; title: string }> = [
  { path: ROUTES.HOME, title: APP_NAME },
  { path: ROUTES.LOGIN, title: APP_NAME },
  { path: ROUTES.REGISTER, title: APP_NAME },
  { path: ROUTES.FORGOT_PASSWORD, title: APP_NAME },
  { path: ROUTES.RESET_PASSWORD, title: APP_NAME },
  { path: ROUTES.ONBOARDING_STEP_1, title: `${APP_NAME} - Onboarding` },
  { path: ROUTES.ONBOARDING_STEP_2, title: `${APP_NAME} - Onboarding` },
  { path: ROUTES.ONBOARDING_STEP_3, title: `${APP_NAME} - Onboarding` },
  { path: ROUTES.DASHBOARD, title: `${APP_NAME} - Dashboard` },
  { path: ROUTES.HIGHLIGHTS, title: `${APP_NAME} - Highlights` },
  { path: ROUTES.STANDINGS, title: `${APP_NAME} - Standings` },
  { path: ROUTES.TEAMS, title: `${APP_NAME} - Teams` },
  { path: ROUTES.TEAM_DETAIL, title: `${APP_NAME} - Team` },
  { path: ROUTES.GAME_DETAIL, title: `${APP_NAME} - Game` },
  { path: ROUTES.SETTINGS, title: `${APP_NAME} - Settings` },
  { path: ROUTES.TERMS, title: `${APP_NAME} - Terms` },
  { path: ROUTES.PRIVACY, title: `${APP_NAME} - Privacy` },
  { path: ROUTES.COOKIES, title: `${APP_NAME} - Cookies` },
  { path: ROUTES.ABOUT, title: `${APP_NAME} - About` },
];

function resolveDocumentTitle(pathname: string): string {
  const match = PAGE_TITLES.find(({ path }) => matchPath({ path, end: true }, pathname));
  return match?.title ?? APP_NAME;
}

function AppShell() {
  const location = useLocation();

  useEffect(() => {
    document.title = resolveDocumentTitle(location.pathname);
  }, [location.pathname]);

  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* Public routes */}
        <Route path={ROUTES.HOME} element={<LandingPage />} />
        <Route path={ROUTES.LOGIN} element={<LoginPage />} />
        <Route path={ROUTES.REGISTER} element={<RegisterPage />} />
        <Route path={ROUTES.FORGOT_PASSWORD} element={<ForgotPasswordPage />} />
        <Route path={ROUTES.RESET_PASSWORD} element={<ResetPasswordPage />} />
        <Route path={ROUTES.TERMS} element={<TermsPage />} />
        <Route path={ROUTES.PRIVACY} element={<PrivacyPage />} />
        <Route path={ROUTES.COOKIES} element={<CookiePolicyPage />} />
        <Route path={ROUTES.ABOUT} element={<AboutPage />} />

        {/* Onboarding -- auth required but not onboarding completion */}
        <Route
          path={ROUTES.ONBOARDING_STEP_1}
          element={<ProtectedRoute requireOnboarding={false}><OnboardingStep1 /></ProtectedRoute>}
        />
        <Route
          path={ROUTES.ONBOARDING_STEP_2}
          element={<ProtectedRoute requireOnboarding={false}><OnboardingStep2 /></ProtectedRoute>}
        />
        <Route
          path={ROUTES.ONBOARDING_STEP_3}
          element={<ProtectedRoute requireOnboarding={false}><OnboardingStep3 /></ProtectedRoute>}
        />

        {/* Protected -- auth + onboarding required */}
        <Route path={ROUTES.DASHBOARD} element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path={ROUTES.HIGHLIGHTS} element={<ProtectedRoute><HighlightsPage /></ProtectedRoute>} />
        <Route path={ROUTES.SCORES} element={<Navigate to={ROUTES.DASHBOARD} replace />} />
        <Route path={ROUTES.STANDINGS} element={<ProtectedRoute><StandingsPage /></ProtectedRoute>} />
        <Route path={ROUTES.TEAMS} element={<ProtectedRoute><Teams /></ProtectedRoute>} />
        <Route path={ROUTES.TEAM_DETAIL} element={<ProtectedRoute><TeamDetail /></ProtectedRoute>} />
        <Route path={ROUTES.GAME_DETAIL} element={<ProtectedRoute><GameDetailPage /></ProtectedRoute>} />
        <Route path="/games/:id" element={<ProtectedRoute><GameDetailPage /></ProtectedRoute>} />
        <Route path={ROUTES.SETTINGS} element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      </Routes>

      <CookieBanner />
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CookieProvider>
          <BrowserRouter>
            <AppShell />
          </BrowserRouter>
        </CookieProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
