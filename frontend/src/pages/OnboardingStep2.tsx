/**
 * SportSync - Onboarding Step 2
 *
 * Sport selection — choose which sports you follow.
 * Large selectable cards with sport names. At least one required.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import apiClient from "../api/client";
import { API, ROUTES, SUPPORTED_SPORTS } from "../constants";

export default function OnboardingStep2() {
  const navigate = useNavigate();
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleSport(sportId: string) {
    setSelectedSports((prev) =>
      prev.includes(sportId)
        ? prev.filter((s) => s !== sportId)
        : [...prev, sportId]
    );
  }

  async function handleContinue() {
    setError("");

    if (selectedSports.length === 0) {
      setError("Select at least one sport to continue.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post(API.ONBOARDING_STEP_2, {
        sports: selectedSports,
      });
      navigate(ROUTES.ONBOARDING_STEP_3);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      setError(apiError.response?.data?.detail || "Failed to save. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Progress indicator */}
        <OnboardingProgress currentStep={2} />

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">Pick Your Sports</h1>
          <p className="text-muted text-sm">Select the sports you want to follow</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3 mb-6">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 mb-8">
          {SUPPORTED_SPORTS.map((sport) => {
            const isSelected = selectedSports.includes(sport.id);
            return (
              <button
                key={sport.id}
                onClick={() => toggleSport(sport.id)}
                className={`p-6 rounded-xl border-2 transition-all text-center ${
                  isSelected
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-muted/20 bg-surface text-foreground-base hover:border-muted/40"
                }`}
              >
                <span className="text-lg font-bold block">{sport.label}</span>
                <span className="text-sm text-muted">{sport.sport}</span>
              </button>
            );
          })}
        </div>

        <button
          onClick={handleContinue}
          disabled={isSubmitting || selectedSports.length === 0}
          className="w-full py-3 bg-accent hover:bg-accent-hover text-foreground font-semibold rounded-lg transition-colors disabled:opacity-50"
        >
          {isSubmitting ? "Saving..." : `Continue (${selectedSports.length} selected)`}
        </button>
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
