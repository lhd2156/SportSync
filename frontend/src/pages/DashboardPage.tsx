/**
 * SportSync - Dashboard Page
 *
 * Main page after login. Shows:
 * - Date strip for filtering
 * - Personalized feed of score cards
 * - Live scores at the top with pulsing indicator
 * - WebSocket connection for real-time updates
 */
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import Navbar from "../components/Navbar";
import DateStrip from "../components/DateStrip";
import ScoreCard from "../components/ScoreCard";
import Footer from "../components/Footer";
import apiClient from "../api/client";
import { API } from "../constants";
import { useWebSocket } from "../hooks/useWebSocket";
import type { ScoreEvent } from "../types";

interface FeedGame {
  id: string;
  home_team_id: string;
  away_team_id: string;
  sport: string;
  league: string;
  status: string;
  home_score: number;
  away_score: number;
  scheduled_at: string;
  priority: number;
  home_team?: { name: string; short_name?: string; logo_url?: string | null };
  away_team?: { name: string; short_name?: string; logo_url?: string | null };
}

export default function DashboardPage() {
  const [selectedDate, setSelectedDate] = useState(new Date());

  const { data: feed = [], refetch } = useQuery<FeedGame[]>({
    queryKey: ["feed"],
    queryFn: async () => {
      const res = await apiClient.get(API.USER_FEED);
      return res.data;
    },
  });

  // Live score updates via WebSocket
  const onScoreMessage = useCallback(
    (_event: ScoreEvent) => {
      // Refetch feed on any score update to refresh the view
      refetch();
    },
    [refetch]
  );

  useWebSocket({ onMessage: onScoreMessage });

  const liveGames = feed.filter((g) => g.status === "live");
  const otherGames = feed.filter((g) => g.status !== "live");

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-7xl mx-auto">
        {/* Date picker strip */}
        <DateStrip selectedDate={selectedDate} onSelectDate={setSelectedDate} />

        {/* Live games section */}
        {liveGames.length > 0 && (
          <section className="px-4 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse-live" />
              Live Now
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {liveGames.map((game) => (
                <ScoreCard
                  key={game.id}
                  id={game.id}
                  homeTeam={{
                    name: game.home_team?.name || "Home",
                    shortName: game.home_team?.short_name,
                    logoUrl: game.home_team?.logo_url,
                  }}
                  awayTeam={{
                    name: game.away_team?.name || "Away",
                    shortName: game.away_team?.short_name,
                    logoUrl: game.away_team?.logo_url,
                  }}
                  homeScore={game.home_score}
                  awayScore={game.away_score}
                  status={game.status}
                  league={game.league}
                  scheduledAt={game.scheduled_at}
                />
              ))}
            </div>
          </section>
        )}

        {/* All other games */}
        <section className="px-4 mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-3">Your Feed</h2>
          {otherGames.length === 0 && liveGames.length === 0 ? (
            <div className="bg-surface border border-muted/20 rounded-xl p-8 text-center">
              <p className="text-muted">No games to show right now.</p>
              <p className="text-muted text-sm mt-1">
                Save more teams to personalize your feed.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {otherGames.map((game) => (
                <ScoreCard
                  key={game.id}
                  id={game.id}
                  homeTeam={{
                    name: game.home_team?.name || "Home",
                    shortName: game.home_team?.short_name,
                    logoUrl: game.home_team?.logo_url,
                  }}
                  awayTeam={{
                    name: game.away_team?.name || "Away",
                    shortName: game.away_team?.short_name,
                    logoUrl: game.away_team?.logo_url,
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
