/**
 * SportSync - Scores Page
 *
 * Full scores view with sport filtering and date selection.
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Navbar from "../components/Navbar";
import DateStrip from "../components/DateStrip";
import ScoreCard from "../components/ScoreCard";
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
  const [searchParams] = useSearchParams();
  const sport = searchParams.get("sport") || undefined;
  const [selectedDate, setSelectedDate] = useState(new Date());

  const { data: scores = [], isLoading } = useQuery<ScoreGame[]>({
    queryKey: ["scores", sport],
    queryFn: async () => {
      const params = sport ? { sport } : {};
      const res = await apiClient.get("/api/scores", { params });
      return res.data;
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-7xl mx-auto">
        <DateStrip selectedDate={selectedDate} onSelectDate={setSelectedDate} />

        <section className="px-4 mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-4">
            {sport ? `${sport} Scores` : "All Scores"}
          </h1>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : scores.length === 0 ? (
            <div className="bg-surface border border-muted/20 rounded-xl p-8 text-center">
              <p className="text-muted">No scores available right now.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {scores.map((game) => (
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
