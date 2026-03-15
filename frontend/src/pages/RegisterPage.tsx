/**
 * SportSync - Register Page
 *
 * Collects first name, last name, display name (handle), email,
 * date of birth, gender, password. All inside a card. AgeGate if under 18.
 * After registration, navigates to interests/onboarding.
 */
import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROUTES } from "../constants";
import Logo from "../components/Logo";
import AgeGate, { calculateAge } from "../components/AgeGate";
import Footer from "../components/Footer";
import GoogleSignInButton from "../components/GoogleSignInButton";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
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
  const isUnderage = dateOfBirth ? calculateAge(dateOfBirth) < 18 : false;

  function validate(): string | null {
    if (!firstName.trim()) return "First name is required.";
    if (!lastName.trim()) return "Last name is required.";
    if (!displayName.trim()) return "Display name is required.";
    if (!dateOfBirth) return "Date of birth is required.";
    if (isUnderage) return "You must be 18 or older.";
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
      const fullDisplayName = displayName.trim();
      await register(email, password, confirmPassword, firstName, lastName, fullDisplayName, dateOfBirth, gender || null);
      navigate(ROUTES.ONBOARDING_STEP_2);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      setError(apiError.response?.data?.detail || "Registration failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputCls = "w-full bg-background border border-muted/20 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:ring-1 focus:ring-accent/30 focus:outline-none transition-all placeholder:text-muted/40";

  return (
    <div className="bg-background text-foreground">
      {/* Full viewport — centered card */}
      <div className="min-h-screen flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          {/* Logo above card */}
          <div className="text-center mb-6">
            <Logo size="lg" />
            <p className="text-muted mt-2">Create your account</p>
          </div>

          {/* Card */}
          <div className="bg-surface border border-muted/15 rounded-2xl p-6 shadow-lg shadow-black/20">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-4 py-3">
                  {error}
                </div>
              )}

              {/* First + Last Name — side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="reg-first" className="block text-sm text-muted mb-1">First Name</label>
                  <input id="reg-first" type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} placeholder="First" />
                </div>
                <div>
                  <label htmlFor="reg-last" className="block text-sm text-muted mb-1">Last Name</label>
                  <input id="reg-last" type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} placeholder="Last" />
                </div>
              </div>

              {/* Display Name */}
              <div>
                <label htmlFor="reg-display" className="block text-sm text-muted mb-1">Display Name</label>
                <input id="reg-display" type="text" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} placeholder="Your username" />
              </div>

              {/* Email */}
              <div>
                <label htmlFor="reg-email" className="block text-sm text-muted mb-1">Email</label>
                <input id="reg-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@example.com" />
              </div>

              {/* DOB + Gender — side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="reg-dob" className="block text-sm text-muted mb-1">Date of Birth</label>
                  <input id="reg-dob" type="date" required value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label htmlFor="reg-gender" className="block text-sm text-muted mb-1">Gender</label>
                  <select id="reg-gender" value={gender} onChange={(e) => setGender(e.target.value)} className={inputCls}>
                    <option value="">Prefer not to say</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="non-binary">Non-binary</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              {/* Age gate */}
              <AgeGate dateOfBirth={dateOfBirth} />

              {/* Password */}
              <div>
                <label htmlFor="reg-pw" className="block text-sm text-muted mb-1">Password</label>
                <input id="reg-pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="Create a strong password" />
                {password.length > 0 && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1.5">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < passedCount ? (passedCount <= 2 ? "bg-amber-400" : "bg-green-400") : "bg-muted/15"}`} />
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

              {/* Confirm Password */}
              <div>
                <label htmlFor="reg-cpw" className="block text-sm text-muted mb-1">Confirm Password</label>
                <input id="reg-cpw" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} placeholder="Confirm your password" />
                {confirmPassword.length > 0 && password !== confirmPassword && (
                  <p className="text-red-400 text-xs mt-1">Passwords do not match</p>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitting || !strong || isUnderage}
                className="w-full py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Creating account..." : "Create Account"}
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-muted/15" />
                <span className="text-muted/40 text-xs">or</span>
                <div className="flex-1 h-px bg-muted/15" />
              </div>

              {/* Google */}
              <GoogleSignInButton text="continue_with" />
            </form>
          </div>

          {/* Below card */}
          <p className="text-center text-sm text-muted mt-5">
            Already have an account?{" "}
            <Link to={ROUTES.LOGIN} className="text-accent hover:text-accent-hover">Sign in</Link>
          </p>
        </div>
      </div>

      {/* Legal + footer below fold */}
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
      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle ${ok ? "bg-green-400" : "bg-muted/30"}`} />
      {children}
    </span>
  );
}
