/**
 * SportSync - Dashboard Page
 *
 * Main page after login. Blueprint Section 9 layout:
 * - Navbar (logo + sport tabs + user)
 * - SportTabBar + DateStrip
 * - Live scores (saved teams first)
 * - Recent news horizontal scroll
 * - Live activity feed (play-by-play stream)
 * - Footer
 */
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import Navbar from "../components/Navbar";
import SportTabBar from "../components/SportTabBar";
import DateStrip from "../components/DateStrip";
import ScoreCard from "../components/ScoreCard";
import LiveBadge from "../components/LiveBadge";
import NewsCard from "../components/NewsCard";
import LiveActivityFeed from "../components/LiveActivityFeed";
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
  const [activeSport, setActiveSport] = useState("ALL");

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
      refetch();
    },
    [refetch]
  );

  useWebSocket({ onMessage: onScoreMessage });

  // Filter by sport tab
  const filteredFeed = activeSport === "ALL"
    ? feed
    : feed.filter((g) => g.sport === activeSport || g.league === activeSport);

  const liveGames = filteredFeed.filter((g) => g.status === "live");
  const otherGames = filteredFeed.filter((g) => g.status !== "live");

  // Placeholder news data for the horizontal scroll row
  const newsItems = [
    { headline: "Season Preview: Top contenders for the championship race", source: "SportSync", publishedAt: "2h ago" },
    { headline: "Trade deadline roundup: Key moves across all leagues", source: "SportSync", publishedAt: "4h ago" },
    { headline: "Injury report: Players to watch on the sidelines this week", source: "SportSync", publishedAt: "6h ago" },
    { headline: "Rising stars: Rookies making an impact this season", source: "SportSync", publishedAt: "8h ago" },
  ];

  // Placeholder activity feed items (will be real-time via WebSocket)
  const activityItems = [
    { id: "1", gameId: "g1", teamName: "Lakers", description: "LeBron James drives to the basket for an easy layup", scoreContext: "LAL 72 - BOS 68, Q4 8:42", timestamp: "Just now", isSavedTeam: true },
    { id: "2", gameId: "g2", teamName: "Warriors", description: "Stephen Curry hits a deep three-pointer from downtown", scoreContext: "GSW 54 - DEN 51, Q3 2:15", timestamp: "1m ago", isSavedTeam: false },
    { id: "3", gameId: "g1", teamName: "Celtics", description: "Jayson Tatum with the steal and fast break dunk", scoreContext: "LAL 74 - BOS 72, Q4 5:30", timestamp: "3m ago", isSavedTeam: false },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-7xl mx-auto">
        {/* Sport filter tabs */}
        <div className="px-4">
          <SportTabBar activeSport={activeSport} onSelectSport={setActiveSport} />
        </div>

        {/* Date picker strip */}
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

        {/* Recent news - horizontal scroll */}
        <section className="px-4 mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-3">Recent News</h2>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
            {newsItems.map((news, i) => (
              <NewsCard
                key={i}
                headline={news.headline}
                source={news.source}
                publishedAt={news.publishedAt}
              />
            ))}
          </div>
        </section>

        {/* Live activity feed */}
        <section className="px-4 mb-8">
          <LiveActivityFeed items={activityItems} />
        </section>
      </main>

      <Footer />
    </div>
  );
}
