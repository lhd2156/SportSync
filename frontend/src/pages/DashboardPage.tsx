/**
 * SportSync - Dashboard Page
 *
 * Main page after login. Layout:
 * 1. Featured hero carousel (live/recent/upcoming games, randomized)
 * 2. Sport tabs (My Teams, All, NFL, NBA, ...) + date strip
 * 3. Games sorted: Live Now → Upcoming → Final Results
 * 4. Real ESPN news headlines
 * 5. Live activity feed with play-by-play
 *
 * Scores refresh every 15s for live data.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Navbar from "../components/Navbar";
import FeaturedCarousel from "../components/FeaturedCarousel";
import SportTabBar from "../components/SportTabBar";
import DateStrip from "../components/DateStrip";
import ScoreCard from "../components/ScoreCard";
import LiveBadge from "../components/LiveBadge";
import NewsCard from "../components/NewsCard";
import LiveActivityFeed from "../components/LiveActivityFeed";
import Footer from "../components/Footer";
import apiClient from "../api/client";
import { API } from "../constants";

/* ── SVG Icons (no emojis) ── */
const IconUpcoming = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
);
const IconFinal = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
);
const IconNews = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
);

/* League display order priority */
const DASHBOARD_LEAGUES = ["NFL", "NBA", "MLB", "NHL", "EPL"] as const;
const DASHBOARD_LEAGUE_SET = new Set<string>(DASHBOARD_LEAGUES);
const LEAGUE_PRIORITY: Record<string, number> = {
  NFL: 0, NBA: 1, MLB: 2, NHL: 3, EPL: 4,
};
const ACTIVITY_PAGE_SIZE = 40;
const ACTIVITY_DISPLAY_CACHE_VERSION = "v13";

function isDashboardLeague(league: string): boolean {
  return DASHBOARD_LEAGUE_SET.has(league);
}

/* ESPN game shape from our backend proxy */
interface ESPNGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number;
  awayScore: number;
  homeBadge: string;
  awayBadge: string;
  homeColor?: string;
  awayColor?: string;
  status: string;
  statusDetail: string;
  league: string;
  dateEvent: string;
  strTime: string;
  strEvent: string;
  strVenue: string;
  headline: string;
}

interface GameItem {
  id: string;
  homeTeam: { name: string; shortName?: string; logoUrl?: string | null; color?: string | null };
  awayTeam: { name: string; shortName?: string; logoUrl?: string | null; color?: string | null };
  homeScore: number;
  awayScore: number;
  status: string;
  statusDetail: string;
  league: string;
  leagueKey: string;
  scheduledAt: string;
}

interface PredictionResult {
  gameId: string;
  homeWinProb: number;
  awayWinProb: number;
  modelVersion: string;
}

interface PredictionCacheEntry {
  fetchedAt: number;
  fingerprint: string;
  data: PredictionResult | null;
}

interface NewsItem {
  id: string;
  headline: string;
  source: string;
  imageUrl: string | null;
  publishedAt: string;
  url: string | null;
  league: string;
  description?: string;
}

interface FeaturedItem {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  statusDetail: string;
  league: string;
  homeBadge: string | null;
  awayBadge: string | null;
  thumb: string | null;
  dateEvent: string;
  strTime: string;
  strEvent: string;
  strVenue: string;
}

/* Activity item shape matching new LiveActivityFeed */
interface ActivityItem {
  id: string;
  gameId: string;
  text: string;
  playType: string;
  athleteName: string;
  athleteHeadshot: string;
  athleteStats: string;
  athlete2Name: string;
  athlete2Headshot: string;
  playTeamName: string;
  playTeamAbbr: string;
  playTeamLogo: string;
  league: string;
  statusDetail: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number;
  awayScore: number;
  homeBadge: string;
  awayBadge: string;
  status: string;
  sortWallclock?: string;
  isSavedTeam?: boolean;
}

interface ActivityCacheEntry {
  items: ActivityItem[];
  total: number;
  hasMore: boolean;
  allItems?: ActivityItem[];
}

function mapESPNGame(g: ESPNGame): GameItem {
  return {
    id: g.id,
    homeTeam: {
      name: g.homeTeam,
      shortName: g.homeAbbr || g.homeTeam.split(" ").pop(),
      logoUrl: g.homeBadge || null,
      color: g.homeColor || null,
    },
    awayTeam: {
      name: g.awayTeam,
      shortName: g.awayAbbr || g.awayTeam.split(" ").pop(),
      logoUrl: g.awayBadge || null,
      color: g.awayColor || null,
    },
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    status: g.status,
    statusDetail: g.statusDetail || "",
    league: g.league,
    leagueKey: g.league,
    scheduledAt: g.dateEvent || "",
  };
}

function formatCompactDate(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function buildActivityCacheKey(dateStr?: string, leagueStr?: string): string {
  return `${ACTIVITY_DISPLAY_CACHE_VERSION}::${(leagueStr || "ALL").toUpperCase()}::${dateStr || "LIVE"}`;
}

function getActivityBoundaryRank(item: ActivityItem): number {
  const combined = `${item.playType} ${item.text}`.toLowerCase();
  if (
    combined.includes("start of") ||
    combined.includes("period start") ||
    combined.includes("quarter start") ||
    combined.includes("half begins")
  ) {
    return 0;
  }
  if (
    combined.includes("end of") ||
    combined.includes("period end") ||
    combined.includes("quarter end") ||
    combined.includes("half ends") ||
    combined.includes("game end") ||
    combined.includes("match ends")
  ) {
    return 2;
  }
  return 1;
}

function getActivitySequence(item: ActivityItem): number {
  const match = item.id.match(/_(\d+)$/);
  return match ? Number(match[1] || 0) : 0;
}

function getActivityRecency(item: ActivityItem): { period: number; progress: number } {
  const detail = (item.statusDetail || "").toUpperCase();
  const combined = `${item.playType || ""} ${item.text || ""}`.toLowerCase();

  if (["NBA", "NFL", "MLB"].includes(item.league)) {
    const otMatch = detail.match(/\bOT(\d+)\s+(\d+):(\d+(?:\.\d+)?)/);
    if (otMatch) {
      const period = 10 + Number(otMatch[1] || 0);
      const seconds = Number(otMatch[2] || 0) * 60 + Number(otMatch[3] || 0);
      return { period, progress: -seconds };
    }

    const otSecondsOnlyMatch = detail.match(/\bOT(\d+)\s+(\d+(?:\.\d+)?)/);
    if (otSecondsOnlyMatch) {
      const period = 10 + Number(otSecondsOnlyMatch[1] || 0);
      const seconds = Number(otSecondsOnlyMatch[2] || 0);
      return { period, progress: -seconds };
    }

    const periodMatch = detail.match(/\b(?:P|Q)(\d+)\s+(\d+):(\d+(?:\.\d+)?)/);
    if (periodMatch) {
      const period = Number(periodMatch[1] || 0);
      const seconds = Number(periodMatch[2] || 0) * 60 + Number(periodMatch[3] || 0);
      return { period, progress: -seconds };
    }

    const periodSecondsOnlyMatch = detail.match(/\b(?:P|Q)(\d+)\s+(\d+(?:\.\d+)?)/);
    if (periodSecondsOnlyMatch) {
      const period = Number(periodSecondsOnlyMatch[1] || 0);
      const seconds = Number(periodSecondsOnlyMatch[2] || 0);
      return { period, progress: -seconds };
    }
  }

  if (item.league === "NHL") {
    const otMatch = detail.match(/\bOT(\d+)\s+(\d+):(\d+(?:\.\d+)?)/);
    if (otMatch) {
      const period = 10 + Number(otMatch[1] || 0);
      const seconds = Number(otMatch[2] || 0) * 60 + Number(otMatch[3] || 0);
      return { period, progress: seconds };
    }

    const otSecondsOnlyMatch = detail.match(/\bOT(\d+)\s+(\d+(?:\.\d+)?)/);
    if (otSecondsOnlyMatch) {
      const period = 10 + Number(otSecondsOnlyMatch[1] || 0);
      const seconds = Number(otSecondsOnlyMatch[2] || 0);
      return { period, progress: seconds };
    }

    const periodMatch = detail.match(/\bP(\d+)\s+(\d+):(\d+(?:\.\d+)?)/);
    if (periodMatch) {
      const period = Number(periodMatch[1] || 0);
      const seconds = Number(periodMatch[2] || 0) * 60 + Number(periodMatch[3] || 0);
      return { period, progress: seconds };
    }

    const periodSecondsOnlyMatch = detail.match(/\bP(\d+)\s+(\d+(?:\.\d+)?)/);
    if (periodSecondsOnlyMatch) {
      const period = Number(periodSecondsOnlyMatch[1] || 0);
      const seconds = Number(periodSecondsOnlyMatch[2] || 0);
      return { period, progress: seconds };
    }
  }

  if (["EPL", "MLS"].includes(item.league)) {
    if (combined.includes("match ends") || combined.includes("game end")) {
      return { period: 99, progress: 999 };
    }
    if (combined.includes("second half ends")) {
      return { period: 2, progress: 999 };
    }
    if (combined.includes("first half ends")) {
      return { period: 1, progress: 999 };
    }
    if (combined.includes("second half begins")) {
      return { period: 2, progress: 45 };
    }
    if (combined.includes("first half begins")) {
      return { period: 1, progress: 0 };
    }
    const soccerMatch = detail.match(/(?:(\d)H\s+)?(\d+)(?:\+(\d+))?'/);
    if (soccerMatch) {
      const half = Number(soccerMatch[1] || 1);
      const minute = Number(soccerMatch[2] || 0);
      const stoppage = Number(soccerMatch[3] || 0);
      return { period: half, progress: minute + stoppage / 100 };
    }
  }

  return { period: 0, progress: 0 };
}

function compareActivitiesWithinGame(a: ActivityItem, b: ActivityItem): number {
  const aRecency = getActivityRecency(a);
  const bRecency = getActivityRecency(b);
  if (aRecency.period !== bRecency.period) return bRecency.period - aRecency.period;

  const aBoundary = getActivityBoundaryRank(a);
  const bBoundary = getActivityBoundaryRank(b);
  if (aBoundary !== bBoundary) return bBoundary - aBoundary;

  if (aRecency.progress !== bRecency.progress) {
    return bRecency.progress - aRecency.progress;
  }

  return getActivitySequence(b) - getActivitySequence(a);
}

function sortActivitiesForDisplay(items: ActivityItem[]): ActivityItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const a = left.item;
      const b = right.item;
      const aWallclock = a.sortWallclock || "";
      const bWallclock = b.sortWallclock || "";
      if (aWallclock && bWallclock && aWallclock !== bWallclock) {
        return bWallclock.localeCompare(aWallclock);
      }

      const sameGame = (a.gameId || a.id) === (b.gameId || b.id);
      if (sameGame) {
        return compareActivitiesWithinGame(a, b);
      }

      return left.index - right.index;
    })
    .map(({ item }) => item);
}

function filterGamesForLeague(games: ESPNGame[], league?: string): ESPNGame[] {
  const requestedLeague = (league || "ALL").toUpperCase();
  const dashboardGames = games.filter((game) => isDashboardLeague(game.league));
  if (requestedLeague === "ALL") return dashboardGames;
  return dashboardGames.filter((game) => game.league === requestedLeague);
}

function getPredictionCacheFingerprint(game: GameItem): string {
  return [
    game.status,
    game.statusDetail || "",
    String(game.awayScore),
    String(game.homeScore),
  ].join("|");
}

function getPredictionCacheTtlMs(game: GameItem): number {
  if (game.status === "live") return 12_000;
  if (game.status === "upcoming") return 3 * 60_000;
  if (game.status === "final") return 60 * 60_000;
  return 60_000;
}

export default function DashboardPage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeSport, setActiveSport] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"all" | "live" | "upcoming" | "final">("all");
  const [games, setGames] = useState<GameItem[]>([]);
  const [predictionsByGame, setPredictionsByGame] = useState<Record<string, PredictionResult | null>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [gamesError, setGamesError] = useState("");
  const [newsByLeague, setNewsByLeague] = useState<Record<string, NewsItem[]>>({ ALL: [] });
  const [featuredItems, setFeaturedItems] = useState<FeaturedItem[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [activityDate, setActivityDate] = useState<string>("");  // "" = today
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityLeague, setActivityLeague] = useState<string>("ALL");
  const [activityError, setActivityError] = useState("");
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const predictionCacheRef = useRef<Record<string, PredictionCacheEntry>>({});
  const [predictionRefreshTick, setPredictionRefreshTick] = useState(0);
  const [predictionsLoadingIds, setPredictionsLoadingIds] = useState<Set<string>>(new Set());

  const [savedTeamNames] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("sportsync_saved_teams");
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const hasSavedTeams = savedTeamNames.length > 0;

  /* Fetch featured carousel data */
  useEffect(() => {
    setFeaturedLoading(true);
    apiClient.get(API.ESPN_FEATURED)
      .then((resp) => {
        const items = (resp.data.featured || [])
          .map((f: ESPNGame) => ({
            ...f,
            thumb: null,
            strTime: f.statusDetail,
          }))
          .filter((item: FeaturedItem) => isDashboardLeague(item.league));
        setFeaturedItems(items);
      })
      .catch(() => setFeaturedItems([]))
      .finally(() => setFeaturedLoading(false));
  }, []);

  const mapNewsItems = useCallback((rawItems: NewsItem[]) => {
    return (rawItems || [])
      .filter((n: NewsItem) => isDashboardLeague(n.league))
      .map((n: NewsItem) => ({
        ...n,
        publishedAt: n.publishedAt ? formatTimeAgo(n.publishedAt) : "Today",
      }));
  }, []);

  /* Fetch dashboard-wide headlines */
  useEffect(() => {
    apiClient.get(API.ESPN_NEWS)
      .then((resp) => {
        const items = mapNewsItems(resp.data.news || []);
        setNewsByLeague((prev) => ({ ...prev, ALL: items }));
      })
      .catch(() => setNewsByLeague((prev) => ({ ...prev, ALL: [] })));
  }, [mapNewsItems]);

  /* Fetch league-specific headlines on demand so NHL/EPL don't get hidden by the combined slice */
  useEffect(() => {
    if (activeSport === "ALL" || activeSport === "MY_TEAMS") {
      return;
    }
    if (newsByLeague[activeSport]) {
      return;
    }

    let cancelled = false;
    apiClient.get(API.ESPN_NEWS, { params: { league: activeSport } })
      .then((resp) => {
        if (cancelled) return;
        const items = mapNewsItems(resp.data.news || []);
        setNewsByLeague((prev) => ({ ...prev, [activeSport]: items }));
      })
      .catch(() => {
        if (cancelled) return;
        setNewsByLeague((prev) => ({ ...prev, [activeSport]: [] }));
      });

    return () => {
      cancelled = true;
    };
  }, [activeSport, mapNewsItems, newsByLeague]);

  /* Parse activity response into ActivityItem[] */
  const parseActivities = useCallback((data: Record<string, unknown>[]) => {
    const items = data.map((a: Record<string, unknown>) => ({
      id: a.id as string,
      gameId: (a.gameId as string) || (a.id as string),
      text: a.text as string,
      playType: (a.playType as string) || "",
      athleteName: (a.athleteName as string) || "",
      athleteHeadshot: (a.athleteHeadshot as string) || "",
      athleteStats: (a.athleteStats as string) || "",
      athlete2Name: (a.athlete2Name as string) || "",
      athlete2Headshot: (a.athlete2Headshot as string) || "",
      playTeamName: (a.playTeamName as string) || "",
      playTeamAbbr: (a.playTeamAbbr as string) || "",
      playTeamLogo: (a.playTeamLogo as string) || "",
      league: a.league as string,
      statusDetail: a.statusDetail as string,
      homeTeam: a.homeTeam as string,
      awayTeam: a.awayTeam as string,
      homeAbbr: (a.homeAbbr as string) || "",
      awayAbbr: (a.awayAbbr as string) || "",
      homeScore: a.homeScore as number,
      awayScore: a.awayScore as number,
      homeBadge: a.homeBadge as string,
      awayBadge: a.awayBadge as string,
      gameMatchup: (a.gameMatchup as string) || "",
      status: a.status as string,
      sortWallclock: (a.sortWallclock as string) || (a._wallclock as string) || "",
      isSavedTeam: savedTeamNames.some((t) =>
        String(a.homeTeam).toLowerCase().includes(t.toLowerCase()) ||
        String(a.awayTeam).toLowerCase().includes(t.toLowerCase())
      ),
    })) as ActivityItem[];

    return sortActivitiesForDisplay(items);
  }, [savedTeamNames]);

  const buildGameSummaryActivities = useCallback((games: ESPNGame[]) => {
    return games.map((game) => {
      const summaryText = game.headline
        ? `${game.headline} - ${game.awayTeam} ${game.awayScore}, ${game.homeTeam} ${game.homeScore}`
        : `${game.awayTeam} ${game.awayScore}, ${game.homeTeam} ${game.homeScore}`;

      return {
        id: `summary_${game.league}_${game.id}`,
        gameId: game.id,
        text: summaryText,
        playType: game.status === "live" ? "Game Update" : "End of Game",
        athleteName: "",
        athleteHeadshot: "",
        athleteStats: "",
        athlete2Name: "",
        athlete2Headshot: "",
        playTeamName: "",
        playTeamAbbr: "",
        playTeamLogo: "",
        league: game.league,
        statusDetail: game.statusDetail || game.strTime || "",
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        homeAbbr: game.homeAbbr || "",
        awayAbbr: game.awayAbbr || "",
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        homeBadge: game.homeBadge || "",
        awayBadge: game.awayBadge || "",
        gameMatchup: `${game.awayAbbr || game.awayTeam} vs ${game.homeAbbr || game.homeTeam}`,
        status: game.status,
        isSavedTeam: savedTeamNames.some((teamName) =>
          game.homeTeam.toLowerCase().includes(teamName.toLowerCase()) ||
          game.awayTeam.toLowerCase().includes(teamName.toLowerCase()),
        ),
      };
    }) as ActivityItem[];
  }, [savedTeamNames]);

  const fetchLiveActivityDirect = useCallback(async (leagueStr?: string) => {
    const todayStr = formatCompactDate(new Date());
    const scoreboardResp = await apiClient.get(API.ESPN_ALL, {
      params: { d: todayStr },
    });

    const liveGames = filterGamesForLeague(scoreboardResp.data.games || [], leagueStr).filter(
      (game) => game.status === "live",
    );

    if (!liveGames.length) {
      return null;
    }

    const liveGameSummaries = buildGameSummaryActivities(liveGames);

    const gamePayloads = await Promise.all(
      liveGames.map(async (game) => {
        try {
          const response = await apiClient.get(`${API.ESPN_GAME}/${game.id}`);
          return Array.isArray(response.data?.plays) ? response.data.plays : [];
        } catch {
          return [];
        }
      }),
    );

    const combined = gamePayloads.flat();
    if (!combined.length) {
      if (!liveGameSummaries.length) {
        return null;
      }
      return {
        items: liveGameSummaries.slice(0, ACTIVITY_PAGE_SIZE),
        total: liveGameSummaries.length,
        hasMore: liveGameSummaries.length > ACTIVITY_PAGE_SIZE,
        allItems: liveGameSummaries,
      } as ActivityCacheEntry;
    }

    const parsed = parseActivities(combined);
    if (!parsed.length && liveGameSummaries.length) {
      return {
        items: liveGameSummaries.slice(0, ACTIVITY_PAGE_SIZE),
        total: liveGameSummaries.length,
        hasMore: liveGameSummaries.length > ACTIVITY_PAGE_SIZE,
        allItems: liveGameSummaries,
      } as ActivityCacheEntry;
    }
    const visible = parsed.slice(0, ACTIVITY_PAGE_SIZE);
    return {
      items: visible,
      total: parsed.length,
      hasMore: parsed.length > ACTIVITY_PAGE_SIZE,
      allItems: parsed,
    } as ActivityCacheEntry;
  }, [buildGameSummaryActivities, parseActivities]);

  /* Use a ref for the current offset so fetchActivity stays stable */
  const offsetRef = useRef(0);
  const activityRequestIdRef = useRef(0);
  const activityActiveRequestsRef = useRef(0);
  const eventsActiveRequestsRef = useRef(0);
  const latestActivityDateCacheRef = useRef<Record<string, string | null>>({});
  const activityResponseCacheRef = useRef<Record<string, ActivityCacheEntry>>({});

  /* Stable fetch function — no dependency on items length */
  const fallbackTriedRef = useRef(false);
  const activityAutoFallbackRef = useRef(false);
  const findLatestMatchingDate = useCallback(async (matcher: (dateStr: string) => Promise<boolean>, maxDaysBack = 400) => {
    for (let offset = 1; offset <= maxDaysBack; offset += 1) {
      const candidateDate = new Date();
      candidateDate.setDate(candidateDate.getDate() - offset);
      const candidateDateStr = formatCompactDate(candidateDate);
      if (await matcher(candidateDateStr)) {
        return candidateDateStr;
      }
    }
    return null;
  }, []);

  const findLatestGameDate = useCallback(async (leagueStr?: string) => {
    const requestedLeague = (leagueStr || "ALL").toUpperCase();
    const hasGamesForDate = async (dateStr: string) => {
      try {
        const resp = await apiClient.get(API.ESPN_ALL, {
          params: { d: dateStr },
        });
        const games = filterGamesForLeague(resp.data.games || [], requestedLeague);
        return games.length > 0;
      } catch {
        return false;
      }
    };

    return findLatestMatchingDate(hasGamesForDate);
  }, [findLatestMatchingDate]);

  const findLatestActivityDate = useCallback(async (leagueStr?: string) => {
    const requestedLeague = (leagueStr || "ALL").toUpperCase();
    if (requestedLeague in latestActivityDateCacheRef.current) {
      return latestActivityDateCacheRef.current[requestedLeague];
    }

    const hasActivityForDate = async (dateStr: string) => {
      try {
        const params: Record<string, string | number> = { date: dateStr, limit: 1 };
        if (requestedLeague !== "ALL") {
          params.league = requestedLeague;
        }
        const resp = await apiClient.get(API.ESPN_ACTIVITY, {
          params,
        });
        return Number(resp.data.total || 0) > 0 || (Array.isArray(resp.data.activities) && resp.data.activities.length > 0);
      } catch {
        return false;
      }
    };

    let latestGameDate: string | null | undefined;

    try {
      const params: Record<string, string | number> = {};
      if (requestedLeague !== "ALL") {
        params.league = requestedLeague;
      }
      const resp = await apiClient.get(API.ESPN_ACTIVITY_LATEST_DATE, { params });
      const latestDate = typeof resp.data?.date === "string" && resp.data.date ? resp.data.date : null;
      if (latestDate) {
        latestGameDate = await findLatestGameDate(requestedLeague);
        if (!latestGameDate || latestDate >= latestGameDate) {
          latestActivityDateCacheRef.current[requestedLeague] = latestDate;
          return latestDate;
        }
      }
    } catch {
      /* Fall back to the slower client-side scan if the helper endpoint is unavailable. */
    }

    const latestActivityDate = await findLatestMatchingDate(hasActivityForDate);
    if (latestActivityDate) {
      latestActivityDateCacheRef.current[requestedLeague] = latestActivityDate;
      return latestActivityDate;
    }

    if (latestGameDate === undefined) {
      latestGameDate = await findLatestGameDate(requestedLeague);
    }
    latestActivityDateCacheRef.current[requestedLeague] = latestGameDate;
    return latestGameDate;
  }, [findLatestGameDate, findLatestMatchingDate]);

  const fetchGameSummaryFallback = useCallback(async (dateStr: string, leagueStr?: string) => {
    try {
      const resp = await apiClient.get(API.ESPN_ALL, {
        params: { d: dateStr },
      });
      const games = filterGamesForLeague(resp.data.games || [], leagueStr);
      return buildGameSummaryActivities(games);
    } catch {
      return [] as ActivityItem[];
    }
  }, [buildGameSummaryActivities]);

  const fetchActivity = useCallback(async (dateStr?: string, append = false, leagueStr?: string, background = false) => {
    if (background && activityActiveRequestsRef.current > 0) {
      return;
    }

    const requestId = ++activityRequestIdRef.current;
    const params: Record<string, string | number> = { limit: ACTIVITY_PAGE_SIZE };
    if (dateStr) params.date = dateStr;
    if (leagueStr && leagueStr !== "ALL") params.league = leagueStr;
    if (append) params.offset = offsetRef.current;
    const cacheKey = buildActivityCacheKey(dateStr, leagueStr);
    if (!append && !background) setActivityLoading(true);
    let handoffToFallback = false;

    const cached = activityResponseCacheRef.current[cacheKey];
    if (append && cached?.allItems) {
      const nextCount = Math.min(cached.allItems.length, offsetRef.current + ACTIVITY_PAGE_SIZE);
      const nextItems = cached.allItems.slice(0, nextCount);
      activityResponseCacheRef.current[cacheKey] = {
        ...cached,
        items: nextItems,
        hasMore: nextCount < cached.allItems.length,
      };
      setActivityItems(nextItems);
      offsetRef.current = nextItems.length;
      setActivityTotal(cached.total);
      setActivityHasMore(nextCount < cached.allItems.length);
      setActivityError("");
      return;
    }

    if (!append) {
      if (cached) {
        setActivityItems(cached.items);
        offsetRef.current = cached.items.length;
        setActivityTotal(cached.total);
        setActivityHasMore(cached.hasMore);
        setActivityError("");
        if (dateStr) {
          setActivityLoading(false);
          return;
        }
        if (!background) {
          setActivityLoading(false);
        }
      }
    }

    activityActiveRequestsRef.current += 1;
    try {
      if (!dateStr) {
        const liveEntry = await fetchLiveActivityDirect(leagueStr);
        if (requestId !== activityRequestIdRef.current) return;
        if (liveEntry) {
          activityResponseCacheRef.current[cacheKey] = liveEntry;
          setActivityError("");
          setActivityItems(liveEntry.items);
          offsetRef.current = liveEntry.items.length;
          setActivityTotal(liveEntry.total);
          setActivityHasMore(liveEntry.hasMore);
          fallbackTriedRef.current = false;
          activityAutoFallbackRef.current = false;
          return;
        }
      }

      const resp = await apiClient.get(API.ESPN_ACTIVITY, { params });
      if (requestId !== activityRequestIdRef.current) return;

      setActivityError("");

      const parsed = parseActivities(resp.data.activities || []);
      if (append) {
        setActivityItems((prev) => {
          const merged = [...prev, ...parsed];
          activityResponseCacheRef.current[cacheKey] = {
            items: merged,
            total: resp.data.total || merged.length,
            hasMore: resp.data.hasMore || false,
          };
          offsetRef.current = merged.length;
          return merged;
        });
      } else {
        if (parsed.length === 0) {
          if (dateStr) {
            const fallbackGames = await fetchGameSummaryFallback(dateStr, leagueStr);
            if (requestId !== activityRequestIdRef.current) return;
            if (fallbackGames.length > 0) {
              activityResponseCacheRef.current[cacheKey] = {
                items: fallbackGames,
                total: fallbackGames.length,
                hasMore: false,
              };
              setActivityItems(fallbackGames);
              offsetRef.current = fallbackGames.length;
              setActivityTotal(fallbackGames.length);
              setActivityHasMore(false);
              return;
            }
          }

          const shouldFindFallbackDate =
            (!dateStr && !fallbackTriedRef.current) ||
            (!!dateStr && activityAutoFallbackRef.current);
          const isAutoFallbackCycle = !!dateStr && activityAutoFallbackRef.current;

          if (shouldFindFallbackDate) {
            const latestDate = await findLatestActivityDate(leagueStr);
            if (requestId !== activityRequestIdRef.current) return;
            fallbackTriedRef.current = true;
            if (latestDate && latestDate !== dateStr) {
              handoffToFallback = true;
              activityAutoFallbackRef.current = true;
              setActivityDate(latestDate);
              return;
            }

            if (isAutoFallbackCycle) {
              handoffToFallback = true;
              activityAutoFallbackRef.current = false;
              setActivityDate("");
              return;
            }
          }
        }

        if (!dateStr && parsed.length > 0) {
          fallbackTriedRef.current = false;
          activityAutoFallbackRef.current = false;
        }
        activityResponseCacheRef.current[cacheKey] = {
          items: parsed,
          total: resp.data.total || parsed.length,
          hasMore: resp.data.hasMore || false,
        };
        setActivityItems(parsed);
        offsetRef.current = parsed.length;
      }

      setActivityTotal(resp.data.total || parsed.length);
      setActivityHasMore(resp.data.hasMore || false);
    } catch (error) {
      if (requestId !== activityRequestIdRef.current) return;
      const message = error instanceof Error && /network|timeout|fetch/i.test(error.message)
        ? "Live activity is temporarily unavailable because the API server is not responding."
        : "Live activity is temporarily unavailable right now.";
      if (!background) {
        setActivityError(message);
      }
    } finally {
      activityActiveRequestsRef.current = Math.max(0, activityActiveRequestsRef.current - 1);
      if (requestId === activityRequestIdRef.current && !handoffToFallback && !background) {
        setActivityLoading(false);
      }
    }
  }, [fetchGameSummaryFallback, fetchLiveActivityDirect, findLatestActivityDate, parseActivities]);

  /* Load more plays (pagination) */
  const loadMoreActivity = useCallback(() => {
    fetchActivity(activityDate || undefined, true, activityLeague);
  }, [fetchActivity, activityDate, activityLeague]);

  /* Handle activity date change — just set the date, useEffect drives the fetch */
  const handleActivityDateChange = useCallback((dateStr: string) => {
    activityRequestIdRef.current += 1;
    activityAutoFallbackRef.current = false;
    fallbackTriedRef.current = false;
    // Always set the explicit date — never clear to "" which fetches latest cached instead of today
    setActivityDate(dateStr);
    offsetRef.current = 0;
    setActivityError("");
    setActivityLoading(true);
    setActivityHasMore(false);
  }, []);

  /* Single fetch driver — fires on date/league change and handles polling */
  useEffect(() => {
    fetchActivity(activityDate || undefined, false, activityLeague);
    // Only auto-refresh if viewing today (activityDate is empty)
    let interval: ReturnType<typeof setInterval> | null = null;
    if (!activityDate) {
      interval = setInterval(() => {
        if (document.hidden) return;
        fetchActivity(undefined, false, activityLeague, true);
      }, 15000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [activityDate, activityLeague, fetchActivity]);

  /* Fetch ESPN events for the selected date + auto-refresh every 15s */
  const fetchEvents = useCallback(async (silent = false) => {
    if (silent && eventsActiveRequestsRef.current > 0) {
      return;
    }

    eventsActiveRequestsRef.current += 1;
    if (!silent) setIsLoading(true);

    const year = selectedDate.getFullYear();
    const month = String(selectedDate.getMonth() + 1).padStart(2, "0");
    const day = String(selectedDate.getDate()).padStart(2, "0");
    const dateStr = `${year}${month}${day}`;

    try {
      const resp = await apiClient.get(API.ESPN_ALL, {
        params: { d: dateStr },
      });
      const espnGames: ESPNGame[] = resp.data.games || [];
      const mapped = espnGames
        .map(mapESPNGame)
        .filter((game) => isDashboardLeague(game.leagueKey));
      const unique = Array.from(new Map(mapped.map((g) => [g.id, g])).values());

      const statusOrder: Record<string, number> = { live: 0, upcoming: 1, final: 2 };
      unique.sort((a, b) => {
        const sa = statusOrder[a.status] ?? 1;
        const sb = statusOrder[b.status] ?? 1;
        if (sa !== sb) return sa - sb;
        const pa = LEAGUE_PRIORITY[a.leagueKey] ?? 99;
        const pb = LEAGUE_PRIORITY[b.leagueKey] ?? 99;
        if (pa !== pb) return pa - pb;
        return 0;
      });

      setGames(unique);
      setGamesError("");
    } catch (error) {
      setGames([]);
      const message = error instanceof Error && /network|timeout|fetch/i.test(error.message)
        ? "Scores are temporarily unavailable because the API server is not responding."
        : "Scores are temporarily unavailable right now.";
      setGamesError(message);
    } finally {
      eventsActiveRequestsRef.current = Math.max(0, eventsActiveRequestsRef.current - 1);
      setIsLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchEvents();
    // Auto-refresh every 15s silently — also bump prediction tick
    refreshRef.current = setInterval(() => {
      fetchEvents(true);
      setPredictionRefreshTick((t) => t + 1);
    }, 15000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [fetchEvents]);

  useEffect(() => {
    if (!games.length) {
      return;
    }

    const now = Date.now();
    const nextState: Record<string, PredictionResult | null> = {};
    const gamesToFetch = games.filter((game) => {
      const cached = predictionCacheRef.current[game.id];
      // Never cache failures — always retry games that returned null
      if (cached && cached.data === null) {
        return true;
      }
      const fingerprint = getPredictionCacheFingerprint(game);
      if (
        cached
        && cached.fingerprint === fingerprint
        && now - cached.fetchedAt < getPredictionCacheTtlMs(game)
      ) {
        nextState[game.id] = cached.data;
        return false;
      }
      return true;
    });

    if (Object.keys(nextState).length > 0) {
      setPredictionsByGame((prev) => ({ ...prev, ...nextState }));
    }

    if (!gamesToFetch.length) {
      return;
    }

    let cancelled = false;

    /* Fetch with a per-request timeout and concurrency limit so the
       dashboard doesn't hang when ML predictions are slow (first signup). */
    const PREDICTION_TIMEOUT_MS = 8_000;

    /* Mark all games we're about to fetch as "loading" for the shimmer UI */
    setPredictionsLoadingIds((prev) => {
      const next = new Set(prev);
      gamesToFetch.forEach((g) => next.add(g.id));
      return next;
    });

    async function fetchWithTimeout(game: GameItem) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PREDICTION_TIMEOUT_MS);
      try {
        const response = await apiClient.get(`${API.PREDICT}/${game.id}`, {
          params: { league: game.leagueKey },
          signal: controller.signal,
        });
        const prediction: PredictionResult = {
          gameId: String(response.data.game_id),
          homeWinProb: Number(response.data.home_win_prob || 0),
          awayWinProb: Number(response.data.away_win_prob || 0),
          modelVersion: String(response.data.model_version || ""),
        };
        return { gameId: game.id, prediction, ok: true as const };
      } catch {
        return { gameId: game.id, prediction: null, ok: false as const };
      } finally {
        clearTimeout(timer);
      }
    }

    /* Try the batch endpoint first — all predictions in one request.
       Falls back to per-game fetching if the batch endpoint fails. */
    (async () => {
      let batchSucceeded = false;
      try {
        const leagueMap: Record<string, string> = {};
        gamesToFetch.forEach((g) => { leagueMap[g.id] = g.leagueKey; });
        const batchResp = await apiClient.post(API.PREDICT_BATCH, {
          game_ids: gamesToFetch.map((g) => g.id),
          leagues: leagueMap,
        }, { timeout: 20_000 });
        if (cancelled) return;
        const predictions = batchResp.data?.predictions || {};
        if (Object.keys(predictions).length > 0) {
          batchSucceeded = true;
          const updates: Record<string, PredictionResult | null> = {};
          for (const [gameId, data] of Object.entries(predictions)) {
            if (!data) continue;
            const d = data as { game_id: string; home_win_prob: number; away_win_prob: number; model_version: string };
            const game = gamesToFetch.find((g) => g.id === gameId);
            const fingerprint = game ? getPredictionCacheFingerprint(game) : "";
            const prediction: PredictionResult = {
              gameId: String(d.game_id),
              homeWinProb: Number(d.home_win_prob || 0),
              awayWinProb: Number(d.away_win_prob || 0),
              modelVersion: String(d.model_version || ""),
            };
            predictionCacheRef.current[gameId] = {
              fetchedAt: Date.now(),
              fingerprint,
              data: prediction,
            };
            updates[gameId] = prediction;
          }
          if (Object.keys(updates).length > 0) {
            setPredictionsByGame((prev) => ({ ...prev, ...updates }));
          }
        }
      } catch {
        // Batch endpoint failed — fall back to per-game
      }

      /* Clear loading for batch-resolved games */
      if (batchSucceeded) {
        setPredictionsLoadingIds((prev) => {
          const next = new Set(prev);
          gamesToFetch.forEach((g) => next.delete(g.id));
          return next;
        });
        return;
      }

      /* Fallback: per-game fetching with Promise.allSettled so one slow
         game doesn't block the rest */
      if (cancelled) return;
      const results = await Promise.allSettled(gamesToFetch.map(fetchWithTimeout));
      if (cancelled) return;

      const updates: Record<string, PredictionResult | null> = {};
      results.forEach((result) => {
        if (result.status !== "fulfilled") return;
        const { gameId, prediction, ok } = result.value;
        const game = gamesToFetch.find((g) => g.id === gameId);
        if (!game) return;
        const fingerprint = getPredictionCacheFingerprint(game);
        if (ok) {
          predictionCacheRef.current[gameId] = {
            fetchedAt: Date.now(),
            fingerprint,
            data: prediction,
          };
          updates[gameId] = prediction;
        }
      });

      if (Object.keys(updates).length > 0) {
        setPredictionsByGame((prev) => ({ ...prev, ...updates }));
      }

      /* Clear all loading states */
      setPredictionsLoadingIds((prev) => {
        const next = new Set(prev);
        gamesToFetch.forEach((g) => next.delete(g.id));
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
    // predictionRefreshTick drives periodic re-evaluation even when games array
    // reference hasn't changed (e.g. same scores on consecutive polls).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, predictionRefreshTick]);

  /* Filter by sport tab */
  const filteredGames = useMemo(() => {
    if (activeSport === "ALL") return games;
    if (activeSport === "MY_TEAMS") {
      return games.filter((g) =>
        savedTeamNames.some((t) =>
          g.homeTeam.name.toLowerCase().includes(t.toLowerCase()) ||
          g.awayTeam.name.toLowerCase().includes(t.toLowerCase())
        )
      );
    }
    return games.filter((g) => g.leagueKey === activeSport);
  }, [games, activeSport, savedTeamNames]);

  /** Check if either team in a game is one of the user's saved teams */
  const isMyTeamGame = useCallback((game: { homeTeam: { name: string }; awayTeam: { name: string } }) => {
    if (!savedTeamNames.length) return false;
    return savedTeamNames.some((t) =>
      game.homeTeam.name.toLowerCase().includes(t.toLowerCase()) ||
      game.awayTeam.name.toLowerCase().includes(t.toLowerCase())
    );
  }, [savedTeamNames]);

  const visibleNewsItems = useMemo(() => {
    const allNews = newsByLeague.ALL || [];
    if (activeSport === "ALL" || activeSport === "MY_TEAMS") {
      return allNews;
    }

    if (newsByLeague[activeSport]) {
      return newsByLeague[activeSport];
    }

    return allNews.filter((item) => item.league === activeSport);
  }, [activeSport, newsByLeague]);

  /* Split games into sections — respecting statusFilter */
  const liveGames = statusFilter === "all" || statusFilter === "live" ? filteredGames.filter((g) => g.status === "live") : [];
  const upcomingGames = statusFilter === "all" || statusFilter === "upcoming" ? filteredGames.filter((g) => g.status === "upcoming") : [];
  const finalGames = statusFilter === "all" || statusFilter === "final" ? filteredGames.filter((g) => g.status === "final") : [];
  const noGames = liveGames.length === 0 && upcomingGames.length === 0 && finalGames.length === 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-7xl mx-auto">
        {/* Featured carousel */}
        <section className="px-4 pt-4">
          {featuredLoading ? (
            <div className="w-full h-[280px] rounded-2xl shimmer-loading" />
          ) : (
            <FeaturedCarousel items={featuredItems} />
          )}
        </section>

        {/* Sport filter tabs */}
        <div className="px-4 mt-4">
          <SportTabBar
            activeSport={activeSport}
            onSelectSport={setActiveSport}
            hasSavedTeams={hasSavedTeams}
          />
        </div>

        {/* Status filter chips */}
        <div className="px-4 mt-2 flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {(["all", "live", "upcoming", "final"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                statusFilter === status
                  ? status === "live"
                    ? "bg-red-500/15 text-red-400 border border-red-500/30"
                    : "bg-accent/15 text-accent border border-accent/30"
                  : "bg-surface border border-muted/15 text-muted hover:text-foreground"
              }`}
            >
              {status === "all" ? "All" : status === "live" ? "Live" : status === "upcoming" ? "Upcoming" : "Final"}
            </button>
          ))}
        </div>

        {/* Date picker strip */}
        <DateStrip selectedDate={selectedDate} onSelectDate={setSelectedDate} />

        {/* Loading state — skeleton grid instead of spinner */}
        {isLoading && (
          <div className="px-4">
            <div className="h-5 w-24 skeleton-pulse rounded mb-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {[1,2,3,4,5,6,7,8].map(i => (
                <div key={i} className="bg-surface border border-muted/20 rounded-xl p-4 box-row-enter" style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-3 w-10 skeleton-pulse rounded" />
                    <div className="h-3 w-20 skeleton-pulse rounded" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 skeleton-pulse rounded-full" />
                        <div className="h-3.5 w-28 skeleton-pulse rounded" />
                      </div>
                      <div className="h-5 w-6 skeleton-pulse rounded" />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 skeleton-pulse rounded-full" />
                        <div className="h-3.5 w-24 skeleton-pulse rounded" />
                      </div>
                      <div className="h-5 w-6 skeleton-pulse rounded" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="h-1.5 w-full skeleton-pulse rounded-full" />
                    <div className="mt-2 flex justify-between">
                      <div className="h-3 w-14 skeleton-pulse rounded" />
                      <div className="h-3 w-14 skeleton-pulse rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Live Games Section ── */}
        {!isLoading && liveGames.length > 0 && (
          <section className="px-4 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <LiveBadge /> Live Now
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {liveGames.map((game, i) => (
                <div key={game.id} className="box-row-enter" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <ScoreCard
                  id={game.id}
                  homeTeam={game.homeTeam}
                  awayTeam={game.awayTeam}
                  homeScore={game.homeScore}
                  awayScore={game.awayScore}
                  status={game.status}
                  statusDetail={game.statusDetail}
                  league={game.league}
                  scheduledAt={game.scheduledAt}
                  prediction={predictionsByGame[game.id] || null}
                  predictionLoading={predictionsLoadingIds.has(game.id)}
                  isMyTeam={isMyTeamGame(game)}
                />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Upcoming Games Section ── */}
        {!isLoading && upcomingGames.length > 0 && (
          <section className="px-4 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <IconUpcoming /> Upcoming
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {upcomingGames.map((game, i) => (
                <div key={game.id} className="box-row-enter" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <ScoreCard
                  id={game.id}
                  homeTeam={game.homeTeam}
                  awayTeam={game.awayTeam}
                  homeScore={game.homeScore}
                  awayScore={game.awayScore}
                  status={game.status}
                  statusDetail={game.statusDetail}
                  league={game.league}
                  scheduledAt={game.scheduledAt}
                  prediction={predictionsByGame[game.id] || null}
                  predictionLoading={predictionsLoadingIds.has(game.id)}
                  isMyTeam={isMyTeamGame(game)}
                />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Final Results Section ── */}
        {!isLoading && finalGames.length > 0 && (
          <section className="px-4 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <IconFinal /> Final Results
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {finalGames.map((game, i) => (
                <div key={game.id} className="box-row-enter" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <ScoreCard
                  id={game.id}
                  homeTeam={game.homeTeam}
                  awayTeam={game.awayTeam}
                  homeScore={game.homeScore}
                  awayScore={game.awayScore}
                  status={game.status}
                  statusDetail={game.statusDetail}
                  league={game.league}
                  scheduledAt={game.scheduledAt}
                  prediction={predictionsByGame[game.id] || null}
                  predictionLoading={predictionsLoadingIds.has(game.id)}
                  isMyTeam={isMyTeamGame(game)}
                />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* No games */}
        {!isLoading && gamesError && (
          <section className="px-4 mb-8">
            <div className="bg-surface border border-amber-500/20 rounded-xl p-8 text-center">
              <p className="text-amber-200">{gamesError}</p>
              <p className="text-muted text-sm mt-1">
                The dashboard could not reach `http://localhost:8000`, so this is a connection issue rather than a real no-games slate.
              </p>
            </div>
          </section>
        )}

        {!isLoading && !gamesError && noGames && (
          <section className="px-4 mb-8">
            <div className="bg-surface border border-muted/20 rounded-xl p-8 text-center">
              <p className="text-muted">No games found for this date.</p>
              <p className="text-muted text-sm mt-1">
                Try selecting a different date or use the calendar to jump to another day.
              </p>
            </div>
          </section>
        )}

        {/* ── Sports Headlines ── */}
        {visibleNewsItems.length > 0 && (
          <section className="px-4 mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <IconNews /> Sports Headlines
            </h2>
            <div className="flex gap-4 overflow-x-auto pb-2 custom-scrollbar">
              {visibleNewsItems.map((news) => (
                <NewsCard
                  key={news.id}
                  headline={news.headline}
                  source={news.source}
                  imageUrl={news.imageUrl}
                  publishedAt={news.publishedAt}
                  url={news.url || undefined}
                  league={news.league}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Live Activity Feed ── */}
        <section className="px-4 mb-8">
          <LiveActivityFeed
            items={activityItems}
            activityDate={activityDate}
            onDateChange={handleActivityDateChange}
            hasMore={activityHasMore}
            onLoadMore={loadMoreActivity}
            total={activityTotal}
            loading={activityLoading}
            error={activityError}
            activeLeague={activityLeague}
            onLeagueChange={(league) => {
              activityRequestIdRef.current += 1;
              fallbackTriedRef.current = false;
              const shouldResetToLive = activityAutoFallbackRef.current;
              activityAutoFallbackRef.current = false;
              setActivityLeague(league);
              if (shouldResetToLive) {
                setActivityDate("");
              }
              offsetRef.current = 0;
              setActivityError("");
              setActivityLoading(true);
              setActivityHasMore(false);
            }}
          />
        </section>
      </main>

      <Footer />
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  if (!dateStr) return "Recently";
  try {
    const date = new Date(dateStr + (dateStr.includes("T") ? "" : "T12:00:00"));
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.abs(Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return "Recently"; }
}
