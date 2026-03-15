/**
 * SportSync - Application Root
 *
 * Sets up providers (Auth, Cookies, React Query) and the router.
 * All routes are defined here with appropriate guards.
 */
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./context/AuthContext";
import { CookieProvider } from "./context/CookieContext";
import ProtectedRoute from "./components/ProtectedRoute";
import CookieBanner from "./components/CookieBanner";
import { ROUTES } from "./constants";

/* React Query client with sensible defaults */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30000,
      refetchOnWindowFocus: false,
    },
  },
});

/* Lazy-loaded pages to reduce initial bundle size */
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";

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
              <Route path={ROUTES.TERMS} element={<div>Terms</div>} />
              <Route path={ROUTES.PRIVACY} element={<div>Privacy</div>} />
              <Route path={ROUTES.COOKIES} element={<div>Cookies</div>} />
              <Route path={ROUTES.ABOUT} element={<div>About</div>} />

              {/* Onboarding routes -- auth required but not onboarding */}
              <Route
                path={ROUTES.ONBOARDING_STEP_1}
                element={
                  <ProtectedRoute requireOnboarding={false}>
                    <div>Step 1</div>
                  </ProtectedRoute>
                }
              />
              <Route
                path={ROUTES.ONBOARDING_STEP_2}
                element={
                  <ProtectedRoute requireOnboarding={false}>
                    <div>Step 2</div>
                  </ProtectedRoute>
                }
              />
              <Route
                path={ROUTES.ONBOARDING_STEP_3}
                element={
                  <ProtectedRoute requireOnboarding={false}>
                    <div>Step 3</div>
                  </ProtectedRoute>
                }
              />

              {/* Protected routes -- auth and onboarding required */}
              <Route
                path={ROUTES.DASHBOARD}
                element={
                  <ProtectedRoute>
                    <div>Dashboard</div>
                  </ProtectedRoute>
                }
              />
              <Route
                path={ROUTES.SCORES}
                element={
                  <ProtectedRoute>
                    <div>Scores</div>
                  </ProtectedRoute>
                }
              />
              <Route
                path={ROUTES.TEAMS}
                element={
                  <ProtectedRoute>
                    <div>Teams</div>
                  </ProtectedRoute>
                }
              />
              <Route
                path={ROUTES.TEAM_DETAIL}
                element={
                  <ProtectedRoute>
                    <div>Team Detail</div>
                  </ProtectedRoute>
                }
              />
              <Route
                path={ROUTES.GAME_DETAIL}
                element={
                  <ProtectedRoute>
                    <div>Game Detail</div>
                  </ProtectedRoute>
                }
              />
              <Route
                path={ROUTES.SETTINGS}
                element={
                  <ProtectedRoute>
                    <div>Settings</div>
                  </ProtectedRoute>
                }
              />
            </Routes>

            {/* Cookie banner shown on every page before consent is given */}
            <CookieBanner />
          </BrowserRouter>
        </CookieProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
