/**
 * SportSync - Game Detail Page
 *
 * Full game view: scores, prediction widget, team matchup visuals.
 */
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import apiClient from "../api/client";

interface GameDetail {
  id: string;
  home_team: { id: string; name: string; short_name?: string; logo_url?: string | null; city?: string };
  away_team: { id: string; name: string; short_name?: string; logo_url?: string | null; city?: string };
  sport: string;
  league: string;
  status: string;
  home_score: number;
  away_score: number;
  scheduled_at: string;
  prediction: { home_win_prob: number; away_win_prob: number; model_version: string } | null;
}

export default function GameDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: game, isLoading } = useQuery<GameDetail>({
    queryKey: ["game", id],
    queryFn: async () => {
      const res = await apiClient.get(`/api/games/${id}`);
      return res.data;
    },
    enabled: !!id,
  });

  if (isLoading || !game) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const isLive = game.status === "live";

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Game header */}
        <div className="bg-surface border border-muted/20 rounded-2xl p-8 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted">{game.league}</span>
            {isLive && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-red-400">
                <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse-live" />
                LIVE
              </span>
            )}
          </div>

          {/* Scores display */}
          <div className="flex items-center justify-center gap-8 py-6">
            <TeamDisplay
              name={game.home_team.name}
              shortName={game.home_team.short_name}
              logoUrl={game.home_team.logo_url}
              city={game.home_team.city}
            />

            <div className="text-center">
              <div className="text-4xl font-bold text-foreground tabular-nums">
                {game.home_score} - {game.away_score}
              </div>
              <p className="text-xs text-muted mt-2">
                {game.status === "final"
                  ? "FINAL"
                  : game.status === "scheduled"
                  ? new Date(game.scheduled_at).toLocaleString()
                  : game.status.toUpperCase()}
              </p>
            </div>

            <TeamDisplay
              name={game.away_team.name}
              shortName={game.away_team.short_name}
              logoUrl={game.away_team.logo_url}
              city={game.away_team.city}
            />
          </div>
        </div>

        {/* Prediction widget */}
        {game.prediction && (
          <div className="bg-surface border border-muted/20 rounded-2xl p-6 mb-6">
            <h3 className="text-foreground font-semibold mb-4">Win Probability</h3>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-foreground-base">
                    {game.home_team.short_name || game.home_team.name}
                  </span>
                  <span className="text-sm font-medium text-accent">
                    {Math.round(game.prediction.home_win_prob * 100)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-muted/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all"
                    style={{ width: `${game.prediction.home_win_prob * 100}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-foreground-base">
                    {game.away_team.short_name || game.away_team.name}
                  </span>
                  <span className="text-sm font-medium text-foreground-base">
                    {Math.round(game.prediction.away_win_prob * 100)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-muted/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-muted/40 rounded-full transition-all"
                    style={{ width: `${game.prediction.away_win_prob * 100}%` }}
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted mt-3">
              Model: {game.prediction.model_version}
            </p>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

function TeamDisplay({
  name,
  shortName,
  logoUrl,
  city,
}: {
  name: string;
  shortName?: string;
  logoUrl?: string | null;
  city?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 min-w-[100px]">
      {logoUrl ? (
        <img src={logoUrl} alt={name} className="w-16 h-16 object-contain" />
      ) : (
        <div className="w-16 h-16 bg-muted/20 rounded-full flex items-center justify-center text-2xl font-bold text-muted">
          {shortName || name.charAt(0)}
        </div>
      )}
      <span className="text-sm font-medium text-foreground text-center">{shortName || name}</span>
      {city && <span className="text-xs text-muted">{city}</span>}
    </div>
  );
}
