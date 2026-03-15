/**
 * SportSync - Onboarding Step 3: Pick Your Teams
 *
 * Fetches real teams from TheSportsDB free API based on sports
 * selected in Step 2. User can filter by league tab.
 * Skip is allowed — user doesn't have to pick any teams.
 */
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import apiClient from "../api/client";
import { API, ROUTES } from "../constants";

/* ─── League → TheSportsDB league name mapping ─── */
const LEAGUE_API_MAP: Record<string, string> = {
  NFL: "NFL",
  NBA: "NBA",
  MLB: "MLB",
  NHL: "NHL",
  MLS: "MLS",
  EPL: "English Premier League",
};

interface SportsDBTeam {
  idTeam: string;
  strTeam: string;
  strTeamShort: string;
  strLeague: string;
  strBadge: string;
  strStadium: string;
}

interface TeamItem {
  id: string;
  name: string;
  shortName: string;
  league: string;
  logo: string;
}

export default function OnboardingStep3() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeLeague, setActiveLeague] = useState<string | null>(null);

  // Fetch teams from TheSportsDB on mount
  useEffect(() => {
    async function fetchTeams() {
      setIsLoading(true);
      const allTeams: TeamItem[] = [];

      const leagueKeys = Object.keys(LEAGUE_API_MAP);
      const fetches = leagueKeys.map(async (key) => {
        try {
          const leagueName = LEAGUE_API_MAP[key];
          const resp = await fetch(
            `https://www.thesportsdb.com/api/v1/json/3/search_all_teams.php?l=${encodeURIComponent(leagueName)}`
          );
          const data = await resp.json();
          if (data.teams) {
            const mapped: TeamItem[] = data.teams.map((t: SportsDBTeam) => ({
              id: t.idTeam,
              name: t.strTeam,
              shortName: t.strTeamShort || t.strTeam.slice(0, 3).toUpperCase(),
              league: key,
              logo: t.strBadge ? `${t.strBadge}/tiny` : "",
            }));
            allTeams.push(...mapped);
          }
        } catch {
          // Silently skip failed league fetches
        }
      });

      await Promise.all(fetches);
      setTeams(allTeams);
      setIsLoading(false);
    }

    fetchTeams();
  }, []);

  const leagues = useMemo(() => {
    const unique = [...new Set(teams.map((t) => t.league))];
    return unique;
  }, [teams]);

  const visibleTeams = useMemo(() => {
    if (!activeLeague) return teams;
    return teams.filter((t) => t.league === activeLeague);
  }, [activeLeague, teams]);

  function toggleTeam(teamId: string) {
    setSelectedTeams((prev) =>
      prev.includes(teamId) ? prev.filter((t) => t !== teamId) : [...prev, teamId]
    );
  }

  async function handleComplete() {
    setIsSubmitting(true);
    try {
      await apiClient.post(API.ONBOARDING_COMPLETE, {
        team_ids: selectedTeams,
      });

      if (user) {
        setUser({ ...user, isOnboarded: true });
      }
      navigate(ROUTES.DASHBOARD);
    } catch {
      // Still navigate — onboarding shouldn't block the user
      if (user) {
        setUser({ ...user, isOnboarded: true });
      }
      navigate(ROUTES.DASHBOARD);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted text-sm">Loading teams...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12 animate-fadeIn">
      <div className="w-full max-w-2xl">
        <OnboardingProgress currentStep={3} />

        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-foreground mb-2">Pick Your Teams</h1>
          <p className="text-muted text-sm">Your saved teams always appear first in the feed</p>
        </div>

        {/* League filter tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2 justify-center flex-wrap">
          <button
            onClick={() => setActiveLeague(null)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
              activeLeague === null
                ? "bg-accent text-white"
                : "bg-surface border border-muted/20 text-muted hover:text-foreground"
            }`}
          >
            All
          </button>
          {leagues.map((league) => (
            <button
              key={league}
              onClick={() => setActiveLeague(league)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                activeLeague === league
                  ? "bg-accent text-white"
                  : "bg-surface border border-muted/20 text-muted hover:text-foreground"
              }`}
            >
              {league}
            </button>
          ))}
        </div>

        {/* Team grid */}
        {visibleTeams.length === 0 ? (
          <div className="text-center text-muted py-12">
            <p>No teams found. You can skip this step.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8 max-h-[420px] overflow-y-auto pr-1">
            {visibleTeams.map((team) => {
              const isSelected = selectedTeams.includes(team.id);
              return (
                <button
                  key={team.id}
                  onClick={() => toggleTeam(team.id)}
                  className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                    isSelected
                      ? "border-accent bg-accent/10 scale-[1.02]"
                      : "border-muted/15 bg-surface hover:border-muted/30"
                  }`}
                >
                  {team.logo ? (
                    <img
                      src={team.logo}
                      alt={team.name}
                      className="w-12 h-12 object-contain"
                      onError={(e) => {
                        const el = e.target as HTMLImageElement;
                        el.style.display = "none";
                        const fallback = el.nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                  ) : null}
                  <div
                    className={`w-12 h-12 bg-muted/20 rounded-full items-center justify-center text-sm font-bold text-muted ${team.logo ? "hidden" : "flex"}`}
                  >
                    {team.shortName}
                  </div>
                  <span className="text-sm text-foreground font-medium text-center leading-tight">
                    {team.name}
                  </span>
                  <span className="text-xs text-muted">{team.league}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Complete */}
        <button
          onClick={handleComplete}
          disabled={isSubmitting}
          className="w-full py-3 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-all disabled:opacity-40"
        >
          {isSubmitting
            ? "Finishing..."
            : selectedTeams.length > 0
              ? `Complete Setup (${selectedTeams.length} ${selectedTeams.length === 1 ? "team" : "teams"})`
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
