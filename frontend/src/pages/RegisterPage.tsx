/**
 * SportSync - Register Page
 *
 * Email/password registration with confirm password, Google OAuth,
 * and legal disclaimer linking to Terms and Privacy Policy.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROUTES } from "../constants";
import Footer from "../components/Footer";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): string | null {
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (password !== confirmPassword) return "Passwords do not match.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      await register(email, password, confirmPassword);
      navigate(ROUTES.ONBOARDING_STEP_1);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      setError(apiError.response?.data?.detail || "Registration failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <Link to={ROUTES.HOME} className="text-3xl font-bold text-accent">
              SportSync
            </Link>
            <p className="text-muted mt-2">Create your account</p>
          </div>

          {/* Registration form */}
          <form onSubmit={handleSubmit} className="bg-surface border border-muted/20 rounded-xl p-6 space-y-5">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="register-email" className="block text-sm text-foreground-base mb-1.5">
                Email
              </label>
              <input
                id="register-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-background border border-muted/30 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:outline-none transition-colors"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="register-password" className="block text-sm text-foreground-base mb-1.5">
                Password
              </label>
              <input
                id="register-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-background border border-muted/30 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:outline-none transition-colors"
                placeholder="At least 8 characters"
              />
            </div>

            <div>
              <label htmlFor="register-confirm" className="block text-sm text-foreground-base mb-1.5">
                Confirm Password
              </label>
              <input
                id="register-confirm"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-background border border-muted/30 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:outline-none transition-colors"
                placeholder="Confirm your password"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-accent hover:bg-accent-hover text-foreground font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Creating account..." : "Create Account"}
            </button>

            {/* Google OAuth */}
            <button
              type="button"
              className="w-full py-3 bg-foreground text-background-base font-semibold rounded-lg flex items-center justify-center gap-3 hover:bg-foreground-base transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>

            {/* Legal disclaimer */}
            <p className="text-center text-xs text-muted leading-relaxed">
              By creating an account you agree to our{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-hover underline">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-hover underline">
                Privacy Policy
              </a>
            </p>

            <p className="text-center text-sm text-muted">
              Already have an account?{" "}
              <Link to={ROUTES.LOGIN} className="text-accent hover:text-accent-hover">
                Sign in
              </Link>
            </p>
          </form>
        </div>
      </div>

      <Footer />
    </div>
  );
}
