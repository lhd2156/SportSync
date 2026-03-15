/**
 * SportSync - Application Root
 *
 * Sets up providers (Auth, Cookies, React Query) and the router.
 * All routes defined here with appropriate guards.
 */
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./context/AuthContext";
import { CookieProvider } from "./context/CookieContext";
import ProtectedRoute from "./components/ProtectedRoute";
import CookieBanner from "./components/CookieBanner";
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
import OnboardingStep1 from "./pages/OnboardingStep1";
import OnboardingStep2 from "./pages/OnboardingStep2";
import OnboardingStep3 from "./pages/OnboardingStep3";
import DashboardPage from "./pages/DashboardPage";
import ScoresPage from "./pages/ScoresPage";
import TeamsPage from "./pages/TeamsPage";
import GameDetailPage from "./pages/GameDetailPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CookieProvider>
          <BrowserRouter>
            <Routes>
              {/* Public routes */}
              <Route path={ROUTES.HOME} element={<LandingPage />} />
              <Route path={ROUTES.LOGIN} element={<LoginPage />} />
              <Route path={ROUTES.REGISTER} element={<RegisterPage />} />
              <Route path={ROUTES.TERMS} element={<div className="min-h-screen bg-background text-foreground p-8"><h1 className="text-2xl font-bold">Terms of Service</h1></div>} />
              <Route path={ROUTES.PRIVACY} element={<div className="min-h-screen bg-background text-foreground p-8"><h1 className="text-2xl font-bold">Privacy Policy</h1></div>} />
              <Route path={ROUTES.COOKIES} element={<div className="min-h-screen bg-background text-foreground p-8"><h1 className="text-2xl font-bold">Cookie Policy</h1></div>} />
              <Route path={ROUTES.ABOUT} element={<div className="min-h-screen bg-background text-foreground p-8"><h1 className="text-2xl font-bold">About SportSync</h1><p className="text-muted mt-4">v0.1</p></div>} />

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
              <Route path={ROUTES.SCORES} element={<ProtectedRoute><ScoresPage /></ProtectedRoute>} />
              <Route path={ROUTES.TEAMS} element={<ProtectedRoute><TeamsPage /></ProtectedRoute>} />
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
