/**
 * SportSync - Onboarding Step 1
 *
 * Collects personal info: DOB (with 18+ gate), display name,
 * optional gender, optional profile picture URL.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import apiClient from "../api/client";
import { API, ROUTES } from "../constants";
import { isOldEnough } from "../utils/age";

export default function OnboardingStep1() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!dateOfBirth) {
      setError("Date of birth is required");
      return;
    }

    if (!isOldEnough(dateOfBirth)) {
      setError("You must be 18 or older to use SportSync.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post(API.ONBOARDING_STEP_1, {
        date_of_birth: dateOfBirth,
        display_name: displayName,
        gender: gender || null,
      });

      if (user) {
        setUser({ ...user, displayName, dateOfBirth, gender: gender || null });
      }

      navigate(ROUTES.ONBOARDING_STEP_2);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      setError(apiError.response?.data?.detail || "Failed to save. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Progress indicator */}
        <OnboardingProgress currentStep={1} />

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">About You</h1>
          <p className="text-muted text-sm">Tell us a bit about yourself</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-surface border border-muted/20 rounded-xl p-6 space-y-5">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="onb-name" className="block text-sm text-foreground-base mb-1.5">
              Display Name
            </label>
            <input
              id="onb-name"
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-background border border-muted/30 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:outline-none transition-colors"
              placeholder="What should we call you?"
            />
          </div>

          <div>
            <label htmlFor="onb-dob" className="block text-sm text-foreground-base mb-1.5">
              Date of Birth
            </label>
            <input
              id="onb-dob"
              type="date"
              required
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="w-full bg-background border border-muted/30 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:outline-none transition-colors"
            />
            <p className="text-xs text-muted mt-1">You must be 18 or older to use SportSync</p>
          </div>

          <div>
            <label htmlFor="onb-gender" className="block text-sm text-foreground-base mb-1.5">
              Gender <span className="text-muted">(optional)</span>
            </label>
            <select
              id="onb-gender"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="w-full bg-background border border-muted/30 text-foreground rounded-lg px-4 py-2.5 focus:border-accent focus:outline-none transition-colors"
            >
              <option value="">Prefer not to say</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="non-binary">Non-binary</option>
              <option value="other">Other</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 bg-accent hover:bg-accent-hover text-foreground font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

function OnboardingProgress({ currentStep }: { currentStep: number }) {
  const steps = [1, 2, 3];
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((step) => (
        <div
          key={step}
          className={`w-10 h-1.5 rounded-full transition-colors ${
            step <= currentStep ? "bg-accent" : "bg-muted/30"
          }`}
        />
      ))}
    </div>
  );
}
