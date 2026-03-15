/**
 * SportSync - Onboarding Step 3
 *
 * Team selection — pick favorite teams from the sports chosen in step 2.
 * Fetches teams from the API filtered by selected sports.
 * At least one team required. Marks onboarding as complete.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import apiClient from "../api/client";
import { API, ROUTES } from "../constants";
import type { Team } from "../types";

export default function OnboardingStep3() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function loadTeams() {
      try {
        const response = await apiClient.get(API.TEAMS);
        setTeams(response.data);
      } catch {
        setError("Failed to load teams. Please try again.");
      } finally {
        setIsLoading(false);
      }
    }
    loadTeams();
  }, []);

  function toggleTeam(teamId: string) {
    setSelectedTeams((prev) =>
      prev.includes(teamId)
        ? prev.filter((t) => t !== teamId)
        : [...prev, teamId]
    );
  }

  async function handleComplete() {
    setError("");

    if (selectedTeams.length === 0) {
      setError("Select at least one team to continue.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post(API.ONBOARDING_COMPLETE, {
        team_ids: selectedTeams,
      });

      if (user) {
        setUser({ ...user, isOnboarded: true });
      }

      navigate(ROUTES.DASHBOARD);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      setError(apiError.response?.data?.detail || "Failed to save. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        {/* Progress indicator */}
        <OnboardingProgress currentStep={3} />

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">Pick Your Teams</h1>
          <p className="text-muted text-sm">Your saved teams always appear first in the feed</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3 mb-6">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8 max-h-96 overflow-y-auto pr-2">
          {teams.map((team) => {
            const isSelected = selectedTeams.includes(team.id);
            return (
              <button
                key={team.id}
                onClick={() => toggleTeam(team.id)}
                className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                  isSelected
                    ? "border-accent bg-accent/10"
                    : "border-muted/20 bg-surface hover:border-muted/40"
                }`}
              >
                {team.logoUrl ? (
                  <img
                    src={team.logoUrl}
                    alt={team.name}
                    className="w-12 h-12 object-contain"
                  />
                ) : (
                  <div className="w-12 h-12 bg-muted/20 rounded-full flex items-center justify-center text-lg font-bold text-muted">
                    {team.shortName || team.name.charAt(0)}
                  </div>
                )}
                <span className="text-sm text-foreground font-medium text-center leading-tight">
                  {team.name}
                </span>
                <span className="text-xs text-muted">{team.league}</span>
              </button>
            );
          })}
        </div>

        <button
          onClick={handleComplete}
          disabled={isSubmitting || selectedTeams.length === 0}
          className="w-full py-3 bg-accent hover:bg-accent-hover text-foreground font-semibold rounded-lg transition-colors disabled:opacity-50"
        >
          {isSubmitting ? "Finishing..." : `Complete Setup (${selectedTeams.length} teams)`}
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
