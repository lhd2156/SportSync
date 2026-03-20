/**
 * SportSync - Teams Browse Page
 *
 * Browse all teams, filterable by sport. Save/unsave teams.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import FavoriteIcon from "../components/FavoriteIcon";
import apiClient from "../api/client";
import { API, SUPPORTED_SPORTS } from "../constants";
import type { Team } from "../types";

const LEAGUE_LOGOS: Record<string, string> = {
  NFL: "https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png",
  NBA: "https://a.espncdn.com/i/teamlogos/leagues/500/nba.png",
  MLB: "https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png",
  NHL: "https://a.espncdn.com/i/teamlogos/leagues/500/nhl.png",
  EPL: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png",
};

const LEAGUE_PRIORITY: Record<string, number> = {
  NFL: 0, NBA: 1, MLB: 2, NHL: 3, "English Premier League": 4, EPL: 4,
};

const TEAM_FILTERS: Record<string, string> = {
  NFL: "NFL",
  NBA: "NBA",
  MLB: "MLB",
  NHL: "NHL",
  EPL: "English Premier League",
};

export default function TeamsPage() {
  const queryClient = useQueryClient();
  const [leagueFilter, setLeagueFilter] = useState<string>("");

  const { data: teams = [], isLoading, isFetching } = useQuery<Team[]>({
    queryKey: ["teams", leagueFilter],
    queryFn: async () => {
      const params = leagueFilter ? { league: TEAM_FILTERS[leagueFilter] } : {};
      const res = await apiClient.get(API.TEAMS, { params });
      return res.data;
    },
    staleTime: 120_000,
    placeholderData: (prev) => prev,
    select: (data: Team[]) => {
      if (leagueFilter) return data;
      return [...data].sort((a, b) => {
        const pa = LEAGUE_PRIORITY[a.league] ?? 99;
        const pb = LEAGUE_PRIORITY[b.league] ?? 99;
        return pa - pb;
      });
    },
  });

  const { data: savedTeams = [] } = useQuery<Team[]>({
    queryKey: ["savedTeams"],
    queryFn: async () => {
      const res = await apiClient.get(API.USER_TEAMS);
      return res.data;
    },
  });

  const savedTeamIds = new Set(savedTeams.map((t) => t.id));

  const saveMutation = useMutation({
    mutationFn: (teamId: string) => apiClient.post(`${API.USER_TEAMS}/${teamId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["savedTeams"] }),
  });

  const unsaveMutation = useMutation({
    mutationFn: (teamId: string) => apiClient.delete(`${API.USER_TEAMS}/${teamId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["savedTeams"] }),
  });

  function handleToggleSave(teamId: string) {
    if (savedTeamIds.has(teamId)) {
      unsaveMutation.mutate(teamId);
    } else {
      saveMutation.mutate(teamId);
    }
  }

  /* Show skeleton cards when loading for the first time (no cached data) */
  const showSkeleton = isLoading && teams.length === 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-foreground mb-6">Teams</h1>

        <div className="flex items-center gap-2 mb-6 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setLeagueFilter("")}
            className={`px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
              !leagueFilter ? "bg-accent text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            All
          </button>
          {SUPPORTED_SPORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setLeagueFilter(s.id)}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
                leagueFilter === s.id ? "bg-accent text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {LEAGUE_LOGOS[s.id] && (
                <img src={LEAGUE_LOGOS[s.id]} alt={s.label} className="h-4 w-4 object-contain" />
              )}
              {s.label}
            </button>
          ))}
        </div>

        <div className={`grid grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 transition-opacity duration-200 ${isFetching && !showSkeleton ? "opacity-70" : "opacity-100"}`}>
          {showSkeleton
            ? Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-surface border border-muted/20 rounded-xl p-4 flex flex-col items-center gap-3"
                >
                  <div className="w-16 h-16 rounded-full shimmer-prediction" />
                  <div className="space-y-2 w-full flex flex-col items-center">
                    <div className="h-4 w-24 rounded shimmer-prediction" />
                    <div className="h-3 w-12 rounded shimmer-prediction" />
                  </div>
                  <div className="h-7 w-20 rounded-lg shimmer-prediction" />
                </div>
              ))
            : teams.map((team) => {
                const isSaved = savedTeamIds.has(team.id);

                return (
                  <div
                    key={team.id}
                    className="bg-surface border border-muted/20 rounded-xl p-4 flex flex-col items-center gap-3 hover:border-accent/30 transition-all animate-[fadeIn_0.3s_ease-out]"
                  >
                    {team.logoUrl ? (
                      <img src={team.logoUrl} alt={team.name} className="w-16 h-16 object-contain img-fade-in" />
                    ) : (
                      <div className="w-16 h-16 bg-muted/20 rounded-full flex items-center justify-center text-2xl font-bold text-muted">
                        {team.shortName || team.name.charAt(0)}
                      </div>
                    )}
                    <div className="text-center w-full min-w-0">
                      <p className="text-foreground font-medium text-sm truncate">{team.name}</p>
                      <p className="text-muted text-xs truncate">{team.league}</p>
                    </div>
                    <button
                      onClick={() => handleToggleSave(team.id)}
                      className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg transition-colors ${
                        isSaved
                          ? "bg-accent/20 text-accent border border-accent/30"
                          : "bg-surface border border-muted/30 text-muted hover:border-accent hover:text-accent"
                      }`}
                    >
                      <FavoriteIcon className="w-3.5 h-3.5" filled={isSaved} />
                      <span>{isSaved ? "Saved" : "Save"}</span>
                    </button>
                  </div>
                );
              })}
        </div>
      </main>

      <Footer />
    </div>
  );
}
