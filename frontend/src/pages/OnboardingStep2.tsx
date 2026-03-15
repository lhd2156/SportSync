/**
 * SportSync - Onboarding Step 2: Pick Your Sports
 *
 * Large cards with league logos + names. Selection is optional — user
 * can skip if they want. Smooth fade-in from step 1.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import apiClient from "../api/client";
import { API, ROUTES } from "../constants";

/* League data with logo URLs from free CDN */
const LEAGUES = [
  {
    id: "NFL",
    label: "NFL",
    sport: "Football",
    logo: "https://www.thesportsdb.com/images/media/league/badge/pdd02o1610466932.png",
  },
  {
    id: "NBA",
    label: "NBA",
    sport: "Basketball",
    logo: "https://www.thesportsdb.com/images/media/league/badge/gkv4dg1689019974.png",
  },
  {
    id: "MLB",
    label: "MLB",
    sport: "Baseball",
    logo: "https://www.thesportsdb.com/images/media/league/badge/bflwhs1737932027.png",
  },
  {
    id: "NHL",
    label: "NHL",
    sport: "Hockey",
    logo: "https://www.thesportsdb.com/images/media/league/badge/w2pz651634918738.png",
  },
  {
    id: "MLS",
    label: "MLS",
    sport: "Soccer",
    logo: "https://www.thesportsdb.com/images/media/league/badge/dqo6r91549878326.png",
  },
  {
    id: "EPL",
    label: "Premier League",
    sport: "Soccer",
    logo: "https://www.thesportsdb.com/images/media/league/badge/i6o0kh1549879062.png",
  },
];

export default function OnboardingStep2() {
  const navigate = useNavigate();
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleSport(sportId: string) {
    setSelectedSports((prev) =>
      prev.includes(sportId)
        ? prev.filter((s) => s !== sportId)
        : [...prev, sportId]
    );
  }

  async function handleContinue() {
    setIsSubmitting(true);
    try {
      if (selectedSports.length > 0) {
        await apiClient.post(API.ONBOARDING_STEP_2, {
          sports: selectedSports,
        });
      }
      navigate(ROUTES.ONBOARDING_STEP_3);
    } catch {
      // If the API call fails, still navigate — sports are optional
      navigate(ROUTES.ONBOARDING_STEP_3);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12 animate-fadeIn">
      <div className="w-full max-w-lg">
        {/* Progress indicator */}
        <OnboardingProgress currentStep={2} />

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">Pick Your Sports</h1>
          <p className="text-muted text-sm">Select the sports you want to follow</p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-8">
          {LEAGUES.map((league) => {
            const isSelected = selectedSports.includes(league.id);
            return (
              <button
                key={league.id}
                onClick={() => toggleSport(league.id)}
                className={`p-5 rounded-xl border-2 transition-all flex flex-col items-center gap-3 ${
                  isSelected
                    ? "border-accent bg-accent/10 scale-[1.02] shadow-lg shadow-accent/10"
                    : "border-muted/20 bg-surface hover:border-muted/40 hover:bg-surface/80"
                }`}
              >
                <img
                  src={league.logo}
                  alt={league.label}
                  className="w-14 h-14 object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                <div className="text-center">
                  <span className="text-base font-bold block text-foreground">{league.label}</span>
                  <span className="text-xs text-muted">{league.sport}</span>
                </div>
                {isSelected && (
                  <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={handleContinue}
          disabled={isSubmitting}
          className="w-full py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all disabled:opacity-40"
        >
          {isSubmitting
            ? "Saving..."
            : selectedSports.length > 0
              ? `Continue (${selectedSports.length} selected)`
              : "Skip for now"
          }
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
