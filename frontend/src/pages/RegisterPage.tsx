/**
 * SportSync - Register Page
 *
 * Clean, professional auth page. Form fills the viewport.
 * Password strength indicators, legal text, and footer below fold.
 */
import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROUTES } from "../constants";
import Logo from "../components/Logo";
import Footer from "../components/Footer";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const checks = useMemo(() => ({
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
  }), [password]);

  const strong = Object.values(checks).every(Boolean);
  const passedCount = Object.values(checks).filter(Boolean).length;

  function validate(): string | null {
    if (!strong) return "Password does not meet all requirements.";
    if (password !== confirmPassword) return "Passwords do not match.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const err = validate();
    if (err) { setError(err); return; }
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
    <div className="bg-background text-foreground">
      {/* Full viewport section — form only */}
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-10">
            <Logo size="lg" />
            <p className="text-muted mt-2">Create your account</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="register-email" className="block text-sm text-foreground-base mb-1">Email</label>
              <input
                id="register-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-surface border border-muted/20 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:ring-1 focus:ring-accent/30 focus:outline-none transition-all placeholder:text-muted/50"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="register-password" className="block text-sm text-foreground-base mb-1">Password</label>
              <input
                id="register-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-surface border border-muted/20 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:ring-1 focus:ring-accent/30 focus:outline-none transition-all placeholder:text-muted/50"
                placeholder="Create a strong password"
              />
              {/* Strength bar — compact, professional */}
              {password.length > 0 && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1.5">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          i < passedCount
                            ? passedCount <= 2 ? "bg-amber-400" : "bg-green-400"
                            : "bg-muted/15"
                        }`}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                    <Rule ok={checks.length}>8+ chars</Rule>
                    <Rule ok={checks.upper}>Uppercase</Rule>
                    <Rule ok={checks.lower}>Lowercase</Rule>
                    <Rule ok={checks.number}>Number</Rule>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="register-confirm" className="block text-sm text-foreground-base mb-1">Confirm Password</label>
              <input
                id="register-confirm"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-surface border border-muted/20 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:ring-1 focus:ring-accent/30 focus:outline-none transition-all placeholder:text-muted/50"
                placeholder="Confirm your password"
              />
              {confirmPassword.length > 0 && password !== confirmPassword && (
                <p className="text-red-400 text-xs mt-1">Passwords do not match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !strong}
              className="w-full py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed mt-1"
            >
              {isSubmitting ? "Creating account..." : "Create Account"}
            </button>

            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-muted/15" />
              <span className="text-muted/40 text-xs">or</span>
              <div className="flex-1 h-px bg-muted/15" />
            </div>

            <button
              type="button"
              className="w-full py-3 bg-white text-gray-800 font-medium rounded-lg flex items-center justify-center gap-3 hover:bg-gray-50 transition-all shadow-sm"
            >
              <svg className="w-4.5 h-4.5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>

            <p className="text-center text-sm text-muted pt-2">
              Already have an account?{" "}
              <Link to={ROUTES.LOGIN} className="text-accent hover:text-accent-hover">Sign in</Link>
            </p>
          </form>
        </div>
      </div>

      {/* Below the fold — legal + footer */}
      <div className="border-t border-muted/10 py-8 px-4">
        <p className="text-center text-xs text-muted/60 max-w-sm mx-auto leading-relaxed">
          By creating an account you agree to our{" "}
          <Link to={ROUTES.TERMS} className="text-accent/70 hover:text-accent underline">Terms of Service</Link> and{" "}
          <Link to={ROUTES.PRIVACY} className="text-accent/70 hover:text-accent underline">Privacy Policy</Link>.
          You must be 18 years of age or older to use SportSync.
        </p>
      </div>
      <Footer />
    </div>
  );
}

function Rule({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`transition-colors ${ok ? "text-green-400" : "text-muted/40"}`}>
      {ok ? "✓" : "○"} {children}
    </span>
  );
}
