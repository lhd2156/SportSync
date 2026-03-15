/**
 * SportSync - Register Page
 *
 * Scrollable layout: form at the top, legal and footer below the fold.
 * Password strength guide, Google OAuth button, consistent branding.
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

  const passwordChecks = useMemo(() => ({
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
  }), [password]);

  const passwordStrong = Object.values(passwordChecks).every(Boolean);

  function validate(): string | null {
    if (!passwordStrong) return "Password does not meet all requirements.";
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
      {/* Scrollable content - not vertically centered so it doesn't feel cramped */}
      <div className="flex-1 px-4 pt-12 pb-8">
        <div className="w-full max-w-md mx-auto">
          {/* Header with logo */}
          <div className="text-center mb-10">
            <Logo size="lg" />
            <p className="text-muted mt-3 text-lg">Create your account</p>
          </div>

          {/* Registration form */}
          <form onSubmit={handleSubmit} className="space-y-5">
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
                className="w-full bg-surface border border-muted/30 text-foreground rounded-lg px-4 py-3 focus:border-accent focus:outline-none transition-colors"
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
                className="w-full bg-surface border border-muted/30 text-foreground rounded-lg px-4 py-3 focus:border-accent focus:outline-none transition-colors"
                placeholder="Create a strong password"
              />
              {/* Password strength guide */}
              {password.length > 0 && (
                <div className="mt-2 space-y-1">
                  <PasswordRule passed={passwordChecks.length} text="At least 8 characters" />
                  <PasswordRule passed={passwordChecks.uppercase} text="One uppercase letter" />
                  <PasswordRule passed={passwordChecks.lowercase} text="One lowercase letter" />
                  <PasswordRule passed={passwordChecks.number} text="One number" />
                </div>
              )}
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
                className="w-full bg-surface border border-muted/30 text-foreground rounded-lg px-4 py-3 focus:border-accent focus:outline-none transition-colors"
                placeholder="Confirm your password"
              />
              {confirmPassword.length > 0 && password !== confirmPassword && (
                <p className="text-red-400 text-xs mt-1">Passwords do not match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !passwordStrong}
              className="w-full py-3.5 bg-accent hover:bg-accent-hover text-foreground font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Creating account..." : "Create Account"}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-muted/20" />
              <span className="text-muted text-xs">or</span>
              <div className="flex-1 h-px bg-muted/20" />
            </div>

            {/* Google OAuth */}
            <button
              type="button"
              className="w-full py-3.5 bg-white text-gray-800 font-semibold rounded-lg flex items-center justify-center gap-3 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>

            <p className="text-center text-sm text-muted">
              Already have an account?{" "}
              <Link to={ROUTES.LOGIN} className="text-accent hover:text-accent-hover font-medium">
                Sign in
              </Link>
            </p>
          </form>

          {/* Legal disclaimer - below the fold, naturally scrollable */}
          <div className="mt-10 pt-6 border-t border-muted/10">
            <p className="text-center text-xs text-muted leading-relaxed">
              By creating an account you agree to our{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-hover underline">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-hover underline">
                Privacy Policy
              </a>.
              You must be 18 years of age or older to use SportSync.
            </p>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}

function PasswordRule({ passed, text }: { passed: boolean; text: string }) {
  return (
    <div className={`flex items-center gap-2 text-xs transition-colors ${passed ? "text-green-400" : "text-muted"}`}>
      <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[9px] ${
        passed ? "border-green-400 bg-green-400/10" : "border-muted/40"
      }`}>
        {passed && "✓"}
      </span>
      {text}
    </div>
  );
}
