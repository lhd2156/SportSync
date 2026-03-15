/**
 * SportSync - Team Detail Page
 *
 * Displays a team's info, recent game results with a Recharts
 * score trend chart, and upcoming games.
 */
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import ScoreCard from "../components/ScoreCard";
import apiClient from "../api/client";
import { API } from "../constants";
import type { Team } from "../types";

interface GameResult {
  id: string;
  home_team: { id: string; name: string; short_name?: string; logo_url?: string | null };
  away_team: { id: string; name: string; short_name?: string; logo_url?: string | null };
  home_score: number;
  away_score: number;
  status: string;
  league: string;
  sport: string;
  scheduled_at: string;
}

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: team, isLoading: teamLoading } = useQuery<Team>({
    queryKey: ["team", id],
    queryFn: async () => {
      const res = await apiClient.get(`${API.TEAMS}/${id}`);
      return res.data;
    },
    enabled: !!id,
  });

  const { data: games = [] } = useQuery<GameResult[]>({
    queryKey: ["team-games", id],
    queryFn: async () => {
      const res = await apiClient.get(API.GAMES, { params: { sport: team?.sport } });
      // Filter to just this team's games
      return res.data.filter(
        (g: GameResult) => g.home_team.id === id || g.away_team.id === id
      );
    },
    enabled: !!team,
  });

  const { data: savedTeams = [] } = useQuery<Team[]>({
    queryKey: ["savedTeams"],
    queryFn: async () => {
      const res = await apiClient.get(API.USER_TEAMS);
      return res.data;
    },
  });

  const isSaved = savedTeams.some((t) => t.id === id);

  const saveMutation = useMutation({
    mutationFn: () => apiClient.post(`${API.USER_TEAMS}/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["savedTeams"] }),
  });

  const unsaveMutation = useMutation({
    mutationFn: () => apiClient.delete(`${API.USER_TEAMS}/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["savedTeams"] }),
  });

  // Build chart data from completed games
  const chartData = games
    .filter((g) => g.status === "final")
    .slice(-10)
    .map((g) => {
      const isHome = g.home_team.id === id;
      const teamScore = isHome ? g.home_score : g.away_score;
      const oppScore = isHome ? g.away_score : g.home_score;
      const date = new Date(g.scheduled_at);
      return {
        date: `${date.getMonth() + 1}/${date.getDate()}`,
        score: teamScore,
        opponent: oppScore,
        won: teamScore > oppScore,
      };
    });

  const wins = chartData.filter((d) => d.won).length;
  const losses = chartData.length - wins;

  if (teamLoading || !team) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Team header */}
        <div className="bg-surface border border-muted/20 rounded-2xl p-8 mb-6">
          <div className="flex items-center gap-6">
            {team.logoUrl ? (
              <img src={team.logoUrl} alt={team.name} className="w-20 h-20 object-contain" />
            ) : (
              <div className="w-20 h-20 bg-muted/20 rounded-full flex items-center justify-center text-3xl font-bold text-muted">
                {team.shortName || team.name.charAt(0)}
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-foreground">{team.name}</h1>
              <p className="text-muted">{team.league} • {team.city}</p>
              {chartData.length > 0 && (
                <p className="text-sm text-foreground-base mt-1">
                  Recent: <span className="text-green-400">{wins}W</span> - <span className="text-red-400">{losses}L</span>
                </p>
              )}
            </div>
            <button
              onClick={() => isSaved ? unsaveMutation.mutate() : saveMutation.mutate()}
              className={`px-6 py-2.5 rounded-lg font-medium transition-colors ${
                isSaved
                  ? "bg-accent/20 text-accent border border-accent/30"
                  : "bg-accent hover:bg-accent-hover text-foreground"
              }`}
            >
              {isSaved ? "★ Saved" : "☆ Save Team"}
            </button>
          </div>
        </div>

        {/* Score trend chart */}
        {chartData.length > 0 && (
          <div className="bg-surface border border-muted/20 rounded-2xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Score Trend (Last 10 Games)</h2>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1a1a2e",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    color: "#e2e8f0",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#6c63ff"
                  strokeWidth={2}
                  dot={{ fill: "#6c63ff", r: 4 }}
                  name="Team Score"
                />
                <Line
                  type="monotone"
                  dataKey="opponent"
                  stroke="#94a3b8"
                  strokeWidth={1}
                  strokeDasharray="5 5"
                  dot={false}
                  name="Opponent Score"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Recent games */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-4">Recent & Upcoming Games</h2>
          {games.length === 0 ? (
            <div className="bg-surface border border-muted/20 rounded-xl p-8 text-center">
              <p className="text-muted">No games available for this team.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {games.slice(0, 10).map((game) => (
                <ScoreCard
                  key={game.id}
                  id={game.id}
                  homeTeam={{
                    name: game.home_team.name,
                    shortName: game.home_team.short_name,
                    logoUrl: game.home_team.logo_url,
                  }}
                  awayTeam={{
                    name: game.away_team.name,
                    shortName: game.away_team.short_name,
                    logoUrl: game.away_team.logo_url,
                  }}
                  homeScore={game.home_score}
                  awayScore={game.away_score}
                  status={game.status}
                  league={game.league}
                  scheduledAt={game.scheduled_at}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
