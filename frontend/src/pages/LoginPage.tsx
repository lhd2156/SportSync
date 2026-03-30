/**
 * SportSync - Login Page
 *
 * Clean auth page with form inside a card container.
 * Footer and legal text below the fold.
 */
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROUTES } from "../constants";
import Logo from "../components/Logo";
import Footer from "../components/Footer";
import GoogleSignInButton, { GOOGLE_SIGN_IN_AVAILABLE } from "../components/GoogleSignInButton";
import { getSafeRedirectTarget } from "../utils/redirect";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await login(email, password, rememberMe);
      const redirectTarget = getSafeRedirectTarget(
        searchParams.get("redirect"),
        ROUTES.DASHBOARD,
      );
      navigate(redirectTarget);
    } catch (err: unknown) {
      const apiError = err as { code?: string; response?: { data?: { detail?: string } } };
      setError(
        apiError.response?.data?.detail
        || (apiError.code === "ECONNABORTED" ? "Login timed out. Please try again." : "")
        || "Login failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputCls = "w-full bg-background border border-muted/20 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:ring-1 focus:ring-accent/30 focus:outline-none transition-all placeholder:text-muted/40";

  return (
    <div className="bg-background text-foreground">
      {/* Full viewport — centered card */}
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          {/* Logo above card */}
          <div className="text-center mb-6">
            <Logo size="lg" />
            <p className="text-muted mt-2">Welcome back</p>
          </div>

          {/* Card */}
          <div className="bg-surface border border-muted/15 rounded-2xl p-6 shadow-lg shadow-black/20">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="surface-error-card surface-status-negative text-sm rounded-lg px-4 py-3">
                  {error}
                </div>
              )}

              {/* Email */}
              <div>
                <label htmlFor="login-email" className="block text-sm text-muted mb-1">Email</label>
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>

              {/* Password */}
              <div>
                <label htmlFor="login-password" className="block text-sm text-muted mb-1">Password</label>
                <input
                  id="login-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
              </div>

              {/* Remember me */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-muted/30 accent-accent"
                  />
                  <span className="text-sm text-foreground-base select-none">Remember me</span>
                </label>
                <Link
                  to={ROUTES.FORGOT_PASSWORD}
                  className="text-sm text-accent hover:text-accent-hover transition-colors"
                >
                  Forgot password?
                </Link>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Signing in..." : "Sign In"}
              </button>

              {GOOGLE_SIGN_IN_AVAILABLE ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-muted/15" />
                    <span className="text-muted/40 text-xs">or</span>
                    <div className="flex-1 h-px bg-muted/15" />
                  </div>

                  <GoogleSignInButton text="signin_with" />
                </>
              ) : null}
            </form>
          </div>

          {/* Below card */}
          <p className="text-center text-sm text-muted mt-5">
            No account?{" "}
            <Link to={ROUTES.REGISTER} className="text-accent hover:text-accent-hover">Create one</Link>
          </p>
        </div>
      </div>

      {/* Footer only visible on scroll */}
      <Footer />
    </div>
  );
}
