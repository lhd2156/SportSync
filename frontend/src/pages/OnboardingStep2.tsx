/**
 * SportSync - Onboarding Step 2: Pick Your Sports
 *
 * Fetches real league logos from TheSportsDB API.
 * Selection is optional — user can skip.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import apiClient from "../api/client";
import { API, ROUTES } from "../constants";

/* TheSportsDB league IDs */
const LEAGUE_IDS: { key: string; dbId: number; fallbackLabel: string; sport: string }[] = [
  { key: "NFL", dbId: 4391, fallbackLabel: "NFL", sport: "Football" },
  { key: "NBA", dbId: 4387, fallbackLabel: "NBA", sport: "Basketball" },
  { key: "MLB", dbId: 4424, fallbackLabel: "MLB", sport: "Baseball" },
  { key: "NHL", dbId: 4380, fallbackLabel: "NHL", sport: "Hockey" },
  { key: "EPL", dbId: 4328, fallbackLabel: "Premier League", sport: "Soccer" },
];

type LeagueData = {
  id: string;
  label: string;
  sport: string;
  logo: string;
};

type SportsDbLeagueResponse = {
  leagues?: Array<{
    strLeague?: string;
    strBadge?: string;
  }>;
};

export default function OnboardingStep2() {
  const navigate = useNavigate();
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: leagues = [], isLoading } = useQuery<LeagueData[]>({
    queryKey: ["onboarding-leagues"],
    queryFn: async () => {
      const results = await Promise.all(
        LEAGUE_IDS.map(async (league): Promise<LeagueData> => {
          try {
            const response = await apiClient.get<SportsDbLeagueResponse>(API.SPORTS_LEAGUE, {
              params: { league_id: league.dbId },
            });
            const resolvedLeague = response.data?.leagues?.[0];
            return {
              id: league.key,
              label: resolvedLeague?.strLeague || league.fallbackLabel,
              sport: league.sport,
              logo: resolvedLeague?.strBadge ? `${resolvedLeague.strBadge}/small` : "",
            };
          } catch {
            return {
              id: league.key,
              label: league.fallbackLabel,
              sport: league.sport,
              logo: "",
            };
          }
        }),
      );

      const order = LEAGUE_IDS.map((league) => league.key);
      return results.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    },
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });

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
      navigate(ROUTES.ONBOARDING_STEP_3);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted text-sm">Loading leagues...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12 animate-fadeIn">
      <div className="w-full max-w-lg">
        <OnboardingProgress currentStep={2} />

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">Pick Your Sports</h1>
          <p className="text-muted text-sm">Select the sports you want to follow</p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-8">
          {leagues.map((league) => {
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
                {league.logo ? (
                  <img
                    src={league.logo}
                    alt={league.label}
                    className="w-14 h-14 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="w-14 h-14 bg-muted/20 rounded-full flex items-center justify-center text-xs font-bold text-muted">
                    {league.id}
                  </div>
                )}
                <div className="text-center">
                  <span className="text-base font-bold block text-foreground">{league.id}</span>
                  <span className="text-xs text-muted">{league.sport}</span>
                </div>
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
