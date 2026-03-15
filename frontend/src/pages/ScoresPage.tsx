/**
 * SportSync - Scores Page
 *
 * Full scores view with sport tab filtering, date strip, and live badge
 * on live games. Paginated backend.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Navbar from "../components/Navbar";
import SportTabBar from "../components/SportTabBar";
import DateStrip from "../components/DateStrip";
import ScoreCard from "../components/ScoreCard";
import LiveBadge from "../components/LiveBadge";
import Footer from "../components/Footer";
import apiClient from "../api/client";

interface ScoreGame {
  id: string;
  home_team: { id: string; name: string; short_name?: string; logo_url?: string | null };
  away_team: { id: string; name: string; short_name?: string; logo_url?: string | null };
  sport: string;
  league: string;
  status: string;
  home_score: number;
  away_score: number;
  scheduled_at: string;
}

export default function ScoresPage() {
  const [activeSport, setActiveSport] = useState("ALL");
  const [selectedDate, setSelectedDate] = useState(new Date());

  const sport = activeSport === "ALL" ? undefined : activeSport;

  const { data: scores = [], isLoading } = useQuery<ScoreGame[]>({
    queryKey: ["scores", sport],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (sport) params.sport = sport;
      const res = await apiClient.get("/api/scores", { params });
      return res.data;
    },
  });

  const liveGames = scores.filter((g) => g.status === "live");
  const finalGames = scores.filter((g) => g.status !== "live");

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-7xl mx-auto">
        <div className="px-4">
          <SportTabBar activeSport={activeSport} onSelectSport={setActiveSport} />
        </div>
        <DateStrip selectedDate={selectedDate} onSelectDate={setSelectedDate} />

        {/* Live games section */}
        {liveGames.length > 0 && (
          <section className="px-4 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <LiveBadge />
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {liveGames.map((game) => (
                <ScoreCard
                  key={game.id}
                  id={game.id}
                  homeTeam={{ name: game.home_team.name, shortName: game.home_team.short_name, logoUrl: game.home_team.logo_url }}
                  awayTeam={{ name: game.away_team.name, shortName: game.away_team.short_name, logoUrl: game.away_team.logo_url }}
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

        {/* All scores */}
        <section className="px-4 mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-4">
            {sport ? `${sport} Scores` : "All Scores"}
          </h1>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : finalGames.length === 0 && liveGames.length === 0 ? (
            <div className="bg-surface border border-muted/15 rounded-xl p-8 text-center">
              <p className="text-muted">No scores available right now.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {finalGames.map((game) => (
                <ScoreCard
                  key={game.id}
                  id={game.id}
                  homeTeam={{ name: game.home_team.name, shortName: game.home_team.short_name, logoUrl: game.home_team.logo_url }}
                  awayTeam={{ name: game.away_team.name, shortName: game.away_team.short_name, logoUrl: game.away_team.logo_url }}
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
