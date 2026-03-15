/**
 * SportSync - Dashboard Page
 *
 * Main page after login. Shows real game data from TheSportsDB.
 * - Sport tabs + date strip
 * - Live/recent scores from TheSportsDB events API
 * - Recent news horizontal scroll
 * - Live activity feed
 */
import { useState, useEffect, useMemo } from "react";
import Navbar from "../components/Navbar";
import SportTabBar from "../components/SportTabBar";
import DateStrip from "../components/DateStrip";
import ScoreCard from "../components/ScoreCard";
import LiveBadge from "../components/LiveBadge";
import NewsCard from "../components/NewsCard";
import LiveActivityFeed from "../components/LiveActivityFeed";
import Footer from "../components/Footer";

/* ─── TheSportsDB league IDs ─── */
const LEAGUE_MAP: Record<string, number> = {
  NFL: 4391,
  NBA: 4387,
  MLB: 4424,
  NHL: 4380,
  MLS: 4346,
  EPL: 4328,
};

interface SportsDBEvent {
  idEvent: string;
  strEvent: string;
  strLeague: string;
  strHomeTeam: string;
  strAwayTeam: string;
  intHomeScore: string | null;
  intAwayScore: string | null;
  strTimestamp: string;
  dateEvent: string;
  strTime: string;
  strStatus: string | null;
  strHomeTeamBadge?: string;
  strAwayTeamBadge?: string;
  strThumb?: string;
}

interface GameItem {
  id: string;
  homeTeam: { name: string; shortName?: string; logoUrl?: string | null };
  awayTeam: { name: string; shortName?: string; logoUrl?: string | null };
  homeScore: number;
  awayScore: number;
  status: string;
  league: string;
  scheduledAt: string;
}

function mapEvent(e: SportsDBEvent, leagueKey: string): GameItem {
  const homeScore = e.intHomeScore != null ? Number(e.intHomeScore) : 0;
  const awayScore = e.intAwayScore != null ? Number(e.intAwayScore) : 0;

  let status = "scheduled";
  if (e.strStatus === "Match Finished" || e.strStatus === "FT" || (e.intHomeScore != null && e.intAwayScore != null)) {
    status = "final";
  }
  if (e.strStatus && (e.strStatus.includes("HT") || e.strStatus.includes("Q") || e.strStatus.includes("P") || e.strStatus === "NS" || e.strStatus.includes("'"))) {
    status = "live";
  }

  return {
    id: e.idEvent,
    homeTeam: {
      name: e.strHomeTeam,
      shortName: e.strHomeTeam.split(" ").pop() || e.strHomeTeam.slice(0, 3),
      logoUrl: e.strHomeTeamBadge ? `${e.strHomeTeamBadge}/tiny` : null,
    },
    awayTeam: {
      name: e.strAwayTeam,
      shortName: e.strAwayTeam.split(" ").pop() || e.strAwayTeam.slice(0, 3),
      logoUrl: e.strAwayTeamBadge ? `${e.strAwayTeamBadge}/tiny` : null,
    },
    homeScore,
    awayScore,
    status,
    league: leagueKey,
    scheduledAt: e.strTimestamp || `${e.dateEvent}T${e.strTime || "00:00:00"}`,
  };
}

export default function DashboardPage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeSport, setActiveSport] = useState("ALL");
  const [games, setGames] = useState<GameItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch events from TheSportsDB for selected date
  useEffect(() => {
    async function fetchEvents() {
      setIsLoading(true);
      const dateStr = selectedDate.toISOString().split("T")[0]; // YYYY-MM-DD

      const allGames: GameItem[] = [];
      const leagueEntries = Object.entries(LEAGUE_MAP);

      const fetches = leagueEntries.map(async ([key, id]) => {
        try {
          // Try events by day first
          const resp = await fetch(
            `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${dateStr}&l=${id}`
          );
          const data = await resp.json();
          if (data.events && Array.isArray(data.events)) {
            allGames.push(...data.events.map((e: SportsDBEvent) => mapEvent(e, key)));
          }
        } catch {
          // Silently skip
        }
      });

      await Promise.all(fetches);

      // If no games for today, fetch recent past events from popular leagues
      if (allGames.length === 0) {
        const fallbackLeagues = [["NBA", 4387], ["NFL", 4391], ["EPL", 4328], ["NHL", 4380]] as const;
        const fallbackFetches = fallbackLeagues.map(async ([key, id]) => {
          try {
            const resp = await fetch(
              `https://www.thesportsdb.com/api/v1/json/3/eventspastleague.php?id=${id}`
            );
            const data = await resp.json();
            if (data.events && Array.isArray(data.events)) {
              // Take first 5 from each league
              allGames.push(...data.events.slice(0, 5).map((e: SportsDBEvent) => mapEvent(e, key as string)));
            }
          } catch {
            // Skip
          }
        });
        await Promise.all(fallbackFetches);
      }

      // Sort: live first, then by date
      allGames.sort((a, b) => {
        if (a.status === "live" && b.status !== "live") return -1;
        if (b.status === "live" && a.status !== "live") return 1;
        return new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime();
      });

      setGames(allGames);
      setIsLoading(false);
    }

    fetchEvents();
  }, [selectedDate]);

  // Filter by sport tab
  const filteredGames = useMemo(() => {
    if (activeSport === "ALL") return games;
    return games.filter((g) => g.league === activeSport);
  }, [games, activeSport]);

  const liveGames = filteredGames.filter((g) => g.status === "live");
  const otherGames = filteredGames.filter((g) => g.status !== "live");

  // Placeholder news
  const newsItems = [
    { headline: "Season Preview: Top contenders for the championship race", source: "SportSync", publishedAt: "2h ago" },
    { headline: "Trade deadline roundup: Key moves across all leagues", source: "SportSync", publishedAt: "4h ago" },
    { headline: "Injury report: Players to watch on the sidelines this week", source: "SportSync", publishedAt: "6h ago" },
    { headline: "Rising stars: Rookies making an impact this season", source: "SportSync", publishedAt: "8h ago" },
  ];

  // Build activity from recent games
  const activityItems = useMemo(() => {
    return games
      .filter((g) => g.status === "final" || g.status === "live")
      .slice(0, 5)
      .map((g) => ({
        id: g.id,
        gameId: g.id,
        teamName: g.homeTeam.name,
        description: `${g.homeTeam.name} ${g.homeScore} - ${g.awayTeam.name} ${g.awayScore}`,
        scoreContext: `${g.league} · ${g.status === "live" ? "LIVE" : "Final"}`,
        timestamp: g.status === "live" ? "LIVE" : "Recent",
        isSavedTeam: false,
      }));
  }, [games]);

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

        {/* Loading state */}
        {isLoading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Live games section */}
        {!isLoading && liveGames.length > 0 && (
          <section className="px-4 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <LiveBadge />
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {liveGames.map((game) => (
                <ScoreCard
                  key={game.id}
                  id={game.id}
                  homeTeam={game.homeTeam}
                  awayTeam={game.awayTeam}
                  homeScore={game.homeScore}
                  awayScore={game.awayScore}
                  status={game.status}
                  league={game.league}
                  scheduledAt={game.scheduledAt}
                />
              ))}
            </div>
          </section>
        )}

        {/* All games */}
        {!isLoading && (
          <section className="px-4 mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-3">Your Feed</h2>
            {otherGames.length === 0 && liveGames.length === 0 ? (
              <div className="bg-surface border border-muted/20 rounded-xl p-8 text-center">
                <p className="text-muted">No games found for this date.</p>
                <p className="text-muted text-sm mt-1">
                  Try selecting a different date or sport.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {otherGames.map((game) => (
                  <ScoreCard
                    key={game.id}
                    id={game.id}
                    homeTeam={game.homeTeam}
                    awayTeam={game.awayTeam}
                    homeScore={game.homeScore}
                    awayScore={game.awayScore}
                    status={game.status}
                    league={game.league}
                    scheduledAt={game.scheduledAt}
                  />
                ))}
              </div>
            )}
          </section>
        )}

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
