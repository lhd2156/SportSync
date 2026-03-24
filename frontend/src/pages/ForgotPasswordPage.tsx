import { useState } from "react";
import { Link } from "react-router-dom";
import apiClient from "../api/client";
import { API, ROUTES } from "../constants";
import Logo from "../components/Logo";
import Footer from "../components/Footer";

type PasswordResetRequestResponse = {
  detail?: string;
  dev_reset_url?: string;
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [devResetUrl, setDevResetUrl] = useState("");

  const inputCls =
    "w-full bg-background border border-muted/20 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:ring-1 focus:ring-accent/30 focus:outline-none transition-all placeholder:text-muted/40";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const response = await apiClient.post<PasswordResetRequestResponse>(API.AUTH_PASSWORD_RESET, {
        email,
      });
      setSuccessMessage(
        response.data.detail ||
          "If an account exists for that email, reset instructions will be sent.",
      );
      setDevResetUrl(response.data.dev_reset_url || "");
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      setError(apiError.response?.data?.detail || "We could not start the reset flow.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="bg-background text-foreground">
      <div className="min-h-screen flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <Logo size="lg" linkTo={ROUTES.HOME} />
            <p className="text-muted mt-2">Reset your password</p>
          </div>

          <div className="bg-surface border border-muted/15 rounded-2xl p-6 shadow-lg shadow-black/20">
            {successMessage ? (
              <div className="space-y-5">
                <div className="bg-accent/10 border border-accent/20 text-accent text-sm rounded-lg px-4 py-3">
                  {successMessage}
                </div>

                {devResetUrl ? (
                  <div className="bg-background border border-muted/15 rounded-xl p-4 space-y-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">Development shortcut</p>
                      <p className="text-sm text-muted mt-1">
                        Local development is using a direct reset link instead of email delivery.
                      </p>
                    </div>
                    <a
                      href={devResetUrl}
                      className="inline-flex items-center justify-center w-full py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all"
                    >
                      Continue to reset password
                    </a>
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    Check your email for the reset link, then come back here when you are ready.
                  </p>
                )}

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSuccessMessage("");
                      setDevResetUrl("");
                    }}
                    className="flex-1 py-3 border border-muted/20 text-foreground-base hover:border-accent/40 rounded-lg transition-all"
                  >
                    Try another email
                  </button>
                  <Link
                    to={ROUTES.LOGIN}
                    className="flex-1 py-3 text-center bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all"
                  >
                    Back to sign in
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="surface-error-card surface-status-negative text-sm rounded-lg px-4 py-3">
                    {error}
                  </div>
                )}

                <div>
                  <label htmlFor="forgot-email" className="block text-sm text-muted mb-1">
                    Email
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputCls}
                    placeholder="you@example.com"
                  />
                </div>

                <p className="text-sm text-muted leading-relaxed">
                  We&apos;ll send reset instructions if the account exists. This keeps account ownership private.
                </p>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Sending reset link..." : "Send reset link"}
                </button>
              </form>
            )}
          </div>

          <p className="text-center text-sm text-muted mt-5">
            Remembered it?{" "}
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
