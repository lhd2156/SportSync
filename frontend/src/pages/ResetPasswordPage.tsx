import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import apiClient from "../api/client";
import { API, ROUTES } from "../constants";
import Logo from "../components/Logo";
import Footer from "../components/Footer";

function Rule({ ok, children }: { ok: boolean; children: string }) {
  return <span className={ok ? "surface-status-positive" : "text-muted/60"}>{children}</span>;
}

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = (searchParams.get("token") || "").trim();
  const emailFromQuery = (searchParams.get("email") || "").trim();
  const usingTokenFlow = Boolean(token);

  const [email, setEmail] = useState(emailFromQuery);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isValidating, setIsValidating] = useState(usingTokenFlow);
  const [isValidToken, setIsValidToken] = useState(!usingTokenFlow);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const checks = useMemo(
    () => ({
      length: password.length >= 8,
      upper: /[A-Z]/.test(password),
      lower: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
    }),
    [password],
  );

  const strong = Object.values(checks).every(Boolean);
  const passedCount = Object.values(checks).filter(Boolean).length;

  useEffect(() => {
    if (!usingTokenFlow) {
      setIsValidating(false);
      setIsValidToken(true);
      return undefined;
    }

    let cancelled = false;

    async function validateToken() {
      if (!token) {
        setIsValidToken(false);
        setIsValidating(false);
        return;
      }

      setIsValidating(true);
      setError("");

      try {
        await apiClient.get(API.AUTH_PASSWORD_RESET_VALIDATE, {
          params: { token },
        });
        if (!cancelled) {
          setIsValidToken(true);
        }
      } catch (err: unknown) {
        const apiError = err as { response?: { data?: { detail?: string } } };
        if (!cancelled) {
          setIsValidToken(false);
          setError(
            apiError.response?.data?.detail ||
              "This reset link is invalid or expired. Request a new one.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsValidating(false);
        }
      }
    }

    void validateToken();

    return () => {
      cancelled = true;
    };
  }, [token, usingTokenFlow]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!strong) {
      setError("Password does not meet all requirements.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = usingTokenFlow
        ? await apiClient.post(API.AUTH_PASSWORD_RESET_CONFIRM, {
            token,
            password,
            confirm_password: confirmPassword,
          })
        : await apiClient.post(API.AUTH_PASSWORD_RESET_CODE_CONFIRM, {
            email,
            code,
            password,
            confirm_password: confirmPassword,
          });
      setSuccessMessage(
        response.data?.detail ||
          "Password reset successfully. Please sign in with your new password.",
      );
      window.setTimeout(() => navigate(ROUTES.LOGIN), 1500);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      setError(apiError.response?.data?.detail || "We could not reset your password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputCls =
    "w-full bg-background border border-muted/20 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:ring-1 focus:ring-accent/30 focus:outline-none transition-all placeholder:text-muted/40";

  return (
    <div className="bg-background text-foreground">
      <div className="min-h-screen flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <Logo size="lg" linkTo={ROUTES.HOME} />
            <p className="text-muted mt-2">{usingTokenFlow ? "Create a new password" : "Enter your reset code"}</p>
          </div>

          <div className="bg-surface border border-muted/15 rounded-2xl p-6 shadow-lg shadow-black/20">
            {isValidating ? (
              <div className="py-8 text-center text-muted">Checking your reset link...</div>
            ) : successMessage ? (
              <div className="space-y-4">
            <div className="surface-success-card text-sm rounded-lg px-4 py-3">
                  {successMessage}
                </div>
                <Link
                  to={ROUTES.LOGIN}
                  className="inline-flex items-center justify-center w-full py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all"
                >
                  Continue to sign in
                </Link>
              </div>
            ) : !isValidToken ? (
                <div className="space-y-4">
            <div className="surface-error-card text-sm rounded-lg px-4 py-3">
                  {error || (usingTokenFlow ? "This reset link is invalid or expired." : "That reset code is invalid or expired.")}
                </div>
                <Link
                  to={ROUTES.FORGOT_PASSWORD}
                  className="inline-flex items-center justify-center w-full py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all"
                >
                  Request a new reset code
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
            <div className="surface-error-card text-sm rounded-lg px-4 py-3">
                    {error}
                  </div>
                )}

                {!usingTokenFlow && (
                  <>
                    <div>
                      <label htmlFor="reset-email" className="block text-sm text-muted mb-1">
                        Email
                      </label>
                      <input
                        id="reset-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={inputCls}
                        placeholder="you@onsportsync.com"
                      />
                    </div>

                    <div>
                      <label htmlFor="reset-code" className="block text-sm text-muted mb-1">
                        One-time code
                      </label>
                      <input
                        id="reset-code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        required
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\s+/g, ""))}
                        className={inputCls}
                        placeholder="Enter the 6-digit code"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label htmlFor="reset-password" className="block text-sm text-muted mb-1">
                    New password
                  </label>
                  <input
                    id="reset-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputCls}
                    placeholder="Create a new password"
                  />
                  {password.length > 0 && (
                    <div className="mt-2">
                      <div className="flex gap-1 mb-1.5">
                        {[0, 1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className={`h-1 flex-1 rounded-full transition-colors ${
                              i < passedCount
                                ? passedCount <= 2
                        ? "bg-[color:var(--warning)]"
                        : "bg-[color:var(--success)]"
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
                  <label htmlFor="reset-confirm-password" className="block text-sm text-muted mb-1">
                    Confirm password
                  </label>
                  <input
                    id="reset-confirm-password"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={inputCls}
                    placeholder="Confirm your new password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Updating password..." : usingTokenFlow ? "Reset password" : "Verify code and reset"}
                </button>
              </form>
            )}
          </div>

          <p className="text-center text-sm text-muted mt-5">
            <Link to={ROUTES.LOGIN} className="text-accent hover:text-accent-hover">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>

      <Footer />
    </div>
  );
}
