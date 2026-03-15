/**
 * SportSync - Teams Browse Page
 *
 * Browse all teams, filterable by sport. Save/unsave teams.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import apiClient from "../api/client";
import { API, SUPPORTED_SPORTS } from "../constants";
import { useState } from "react";
import type { Team } from "../types";

export default function TeamsPage() {
  const queryClient = useQueryClient();
  const [sportFilter, setSportFilter] = useState<string>("");

  const { data: teams = [], isLoading } = useQuery<Team[]>({
    queryKey: ["teams", sportFilter],
    queryFn: async () => {
      const params = sportFilter ? { sport: sportFilter } : {};
      const res = await apiClient.get(API.TEAMS, { params });
      return res.data;
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

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-foreground mb-6">Teams</h1>

        {/* Sport filter tabs */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setSportFilter("")}
            className={`px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
              !sportFilter ? "bg-accent text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            All
          </button>
          {SUPPORTED_SPORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSportFilter(s.sport)}
              className={`px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
                sportFilter === s.sport ? "bg-accent text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {teams.map((team) => {
              const isSaved = savedTeamIds.has(team.id);
              return (
                <div
                  key={team.id}
                  className="bg-surface border border-muted/20 rounded-xl p-4 flex flex-col items-center gap-3 hover:border-accent/30 transition-all"
                >
                  {team.logoUrl ? (
                    <img src={team.logoUrl} alt={team.name} className="w-16 h-16 object-contain" />
                  ) : (
                    <div className="w-16 h-16 bg-muted/20 rounded-full flex items-center justify-center text-2xl font-bold text-muted">
                      {team.shortName || team.name.charAt(0)}
                    </div>
                  )}
                  <div className="text-center">
                    <p className="text-foreground font-medium text-sm">{team.name}</p>
                    <p className="text-muted text-xs">{team.league}</p>
                  </div>
                  <button
                    onClick={() => handleToggleSave(team.id)}
                    className={`px-4 py-1.5 text-xs rounded-lg transition-colors ${
                      isSaved
                        ? "bg-accent/20 text-accent border border-accent/30"
                        : "bg-surface border border-muted/30 text-muted hover:border-accent hover:text-accent"
                    }`}
                  >
                    {isSaved ? "★ Saved" : "☆ Save"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
