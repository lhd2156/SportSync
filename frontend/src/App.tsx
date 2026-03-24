/**
 * SportSync - Application Root
 *
 * Sets up providers (Auth, Cookies, React Query) and the router.
 * All routes defined here with appropriate guards.
 */
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./context/AuthContext";
import { CookieProvider } from "./context/CookieContext";
import ProtectedRoute from "./components/ProtectedRoute";
import CookieBanner from "./components/CookieBanner";
import ScrollToTop from "./components/ScrollToTop";
import { ROUTES } from "./constants";

/* React Query client */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30000,
      refetchOnWindowFocus: false,
    },
  },
});

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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CookieProvider>
          <BrowserRouter>
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
              <Route path={ROUTES.SETTINGS} element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
            </Routes>

            <CookieBanner />
          </BrowserRouter>
        </CookieProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
