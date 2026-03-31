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
 * Scores refresh every 12s for live data.
 */
import { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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
import type {
  ActivityCacheEntry,
  ActivityDisplayOrder,
  ActivityItem,
  CachedFeaturedEntry,
  CachedNewsEntry,
  ESPNGame,
  FeaturedItem,
  GameItem,
  GameSlateCacheEntry,
  NewsItem,
  PredictionCacheEntry,
  PredictionResult,
  SavedTeamSummary,
} from "../types/dashboard";
import { buildFallbackPrediction } from "../utils/predictions";

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
const ACTIVITY_FETCH_BATCH_SIZE = 500;
const ACTIVITY_DISPLAY_CACHE_VERSION = "v19";
const ACTIVITY_CACHE_STORAGE_KEY = `sportsync_activity_cache_${ACTIVITY_DISPLAY_CACHE_VERSION}`;
const PREDICTION_CACHE_STORAGE_KEY = "sportsync_prediction_cache_v2";
const GAME_SLATE_CACHE_STORAGE_KEY = "sportsync_game_slate_cache_v3";
const DASHBOARD_NEWS_CACHE_STORAGE_KEY = "sportsync_dashboard_news_cache_v1";
const DASHBOARD_FEATURED_CACHE_STORAGE_KEY = "sportsync_dashboard_featured_cache_v1";
const LIVE_DASHBOARD_REFRESH_MS = 12_000;
const LIVE_ACTIVITY_CACHE_TTL_MS = 6_000;
const LIVE_PREDICTION_CACHE_TTL_MS = 12_000;
const DASHBOARD_NEWS_CACHE_TTL_MS = 10 * 60_000;
const DASHBOARD_FEATURED_CACHE_TTL_MS = 60_000;
const MAX_ACTIVITY_FETCH_PAGES = 30;
const API_WARM_RETRY_TIMEOUT_MS = 4_000;
const FUTURE_ACTIVITY_CACHE_TTL_MS = 5 * 60_000;

const warmedDashboardImageUrls = new Set<string>();

function isDashboardLeague(league: string): boolean {
  return DASHBOARD_LEAGUE_SET.has(league);
}

function readSessionJson<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeSessionJson<T>(key: string, value: T): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota / private mode failures and keep the app interactive.
  }
}

function isFreshCache(cachedAt: number, ttlMs: number): boolean {
  return Number.isFinite(cachedAt) && Date.now() - cachedAt < ttlMs;
}

function readDashboardNewsCache({ freshOnly }: { freshOnly: boolean }): Record<string, NewsItem[]> {
  const cached = readSessionJson<Record<string, CachedNewsEntry>>(DASHBOARD_NEWS_CACHE_STORAGE_KEY, {});
  return Object.entries(cached).reduce<Record<string, NewsItem[]>>((next, [leagueKey, entry]) => {
    if (!entry?.items?.length) {
      return next;
    }
    if (!freshOnly || isFreshCache(entry.cachedAt, DASHBOARD_NEWS_CACHE_TTL_MS)) {
      next[leagueKey] = entry.items;
    }
    return next;
  }, {});
}

function writeDashboardNewsCacheEntry(leagueKey: string, items: NewsItem[]): void {
  const cached = readSessionJson<Record<string, CachedNewsEntry>>(DASHBOARD_NEWS_CACHE_STORAGE_KEY, {});
  cached[leagueKey] = {
    cachedAt: Date.now(),
    items,
  };
  writeSessionJson(DASHBOARD_NEWS_CACHE_STORAGE_KEY, cached);
}

function readFreshDashboardFeaturedCache(): FeaturedItem[] {
  const cached = readSessionJson<CachedFeaturedEntry | null>(DASHBOARD_FEATURED_CACHE_STORAGE_KEY, null);
  if (!cached || !cached.items || !isFreshCache(cached.cachedAt, DASHBOARD_FEATURED_CACHE_TTL_MS)) {
    return [];
  }
  return cached.items;
}

function writeDashboardFeaturedCache(items: FeaturedItem[]): void {
  writeSessionJson(DASHBOARD_FEATURED_CACHE_STORAGE_KEY, {
    cachedAt: Date.now(),
    items,
  } satisfies CachedFeaturedEntry);
}

function warmDashboardImages(urls: Array<string | null | undefined>): void {
  if (typeof window === "undefined") {
    return;
  }

  urls.forEach((url) => {
    if (!url || warmedDashboardImageUrls.has(url)) {
      return;
    }
    warmedDashboardImageUrls.add(url);
    const image = new Image();
    image.decoding = "async";
    image.src = url;
  });
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
    scheduledAt: g.scheduledAt || g.dateEvent || "",
  };
}

function formatCompactDate(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeTeamMatchValue(value: string): string {
  return (value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

function normalizeSavedTeamLeague(value: string | undefined): string {
  const normalized = (value || "").trim().toUpperCase();
  if (normalized === "ENGLISH PREMIER LEAGUE") return "EPL";
  return normalized;
}

function matchesSavedTeamSide(
  gameTeam: { name: string; shortName?: string },
  gameLeague: string,
  savedTeam: SavedTeamSummary,
): boolean {
  const savedLeague = normalizeSavedTeamLeague(savedTeam.league || savedTeam.sport);
  const normalizedGameLeague = normalizeSavedTeamLeague(gameLeague);
  if (savedLeague && normalizedGameLeague && savedLeague !== normalizedGameLeague) {
    return false;
  }

  const gameFull = normalizeTeamMatchValue(gameTeam.name);
  const gameShort = normalizeTeamMatchValue(gameTeam.shortName || "");
  const savedFull = normalizeTeamMatchValue(savedTeam.name);
  const savedShort = normalizeTeamMatchValue(savedTeam.shortName || "");

  if (!savedFull && !savedShort) {
    return false;
  }

  return (
    (!!savedFull && (gameFull === savedFull || gameShort === savedFull || gameFull.endsWith(savedFull))) ||
    (!!savedShort && (gameFull === savedShort || gameShort === savedShort || gameFull.endsWith(savedShort) || gameShort.endsWith(savedShort)))
  );
}

function buildLocalSavedTeamFallback(): SavedTeamSummary[] {
  try {
    const stored = localStorage.getItem("sportsync_saved_teams");
    const parsed = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    if (parsed.every((value) => value && typeof value === "object")) {
      return parsed
        .map((team): SavedTeamSummary | null => {
          const record = team as Record<string, unknown>;
          const name = String(record.name || "");
          const shortName = String(record.short_name || record.shortName || "").trim();
          const league = typeof record.league === "string" ? record.league : "";
          const sport = typeof record.sport === "string" ? record.sport : "";
          const id = String(record.external_id || record.id || `local:${normalizeTeamMatchValue(name)}`);
          if (!name.trim()) {
            return null;
          }
          return {
            id,
            name,
            shortName: shortName || name.trim().split(/\s+/).pop() || name,
            league,
            sport,
          };
        })
        .filter((team): team is SavedTeamSummary => team !== null);
    }
    return parsed
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((name) => ({
        id: `local:${normalizeTeamMatchValue(name)}`,
        name,
        shortName: name.trim().split(/\s+/).pop() || name,
      }));
  } catch {
    return [];
  }
}

function serializeSavedTeamSummary(team: SavedTeamSummary): Record<string, unknown> {
  return {
    id: team.id,
    name: team.name,
    short_name: team.shortName || "",
    league: team.league || "",
    sport: team.sport || "",
  };
}

function mapSavedTeamRecords(rawTeams: Record<string, unknown>[]): SavedTeamSummary[] {
  return rawTeams
    .map((team): SavedTeamSummary | null => {
      const id = String(team.id || team.external_id || "");
      const name = String(team.name || "");
      if (!id || !name) {
        return null;
      }
      return {
        id,
        name,
        shortName: typeof team.short_name === "string" ? team.short_name : undefined,
        league: typeof team.league === "string" ? team.league : "",
        sport: typeof team.sport === "string" ? team.sport : "",
      };
    })
    .filter((team): team is SavedTeamSummary => team !== null);
}

function isFutureCompactDate(dateStr?: string): boolean {
  return Boolean(dateStr && dateStr > formatCompactDate(new Date()));
}

function buildActivityCacheKey(dateStr?: string, leagueStr?: string): string {
  return `${ACTIVITY_DISPLAY_CACHE_VERSION}::${(leagueStr || "ALL").toUpperCase()}::${dateStr || "LIVE"}`;
}

function parseCompactDate(dateStr?: string): Date | null {
  if (!dateStr || !/^\d{8}$/.test(dateStr)) {
    return null;
  }

  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(4, 6));
  const day = Number(dateStr.slice(6, 8));
  const candidate = new Date(year, month - 1, day);

  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return candidate;
}

function getCurrentActivityDay(): string {
  return formatCompactDate(new Date());
}

function isLiveActivityCacheKey(cacheKey: string): boolean {
  return cacheKey.endsWith("::LIVE");
}

function isFreshLiveActivityEntry(cacheKey: string, entry?: ActivityCacheEntry | null): entry is ActivityCacheEntry {
  if (!entry) {
    return false;
  }

  const cachedAt = typeof entry.cachedAt === "number" ? entry.cachedAt : 0;
  const ageMs = cachedAt > 0 ? Date.now() - cachedAt : Number.POSITIVE_INFINITY;
  const currentActivityDay = getCurrentActivityDay();
  const explicitDate = cacheKey.split("::").pop() || "";

  if (!isLiveActivityCacheKey(cacheKey)) {
    if (isFutureCompactDate(explicitDate)) {
      const cachedToday = entry.cachedForDay === currentActivityDay;
      const scheduleOnly = entry.items.every((item) => item.playType === "Scheduled Game");
      const freshEnough = ageMs < FUTURE_ACTIVITY_CACHE_TTL_MS;
      return cachedToday && scheduleOnly && freshEnough;
    }

    if (explicitDate === currentActivityDay) {
      return entry.cachedForDay === currentActivityDay && ageMs < LIVE_ACTIVITY_CACHE_TTL_MS;
    }

    return true;
  }

  return entry.cachedForDay === currentActivityDay && ageMs < LIVE_ACTIVITY_CACHE_TTL_MS;
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

  if (item.league === "EPL") {
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

function compareActivitiesWithinGame(
  a: ActivityItem,
  b: ActivityItem,
  order: ActivityDisplayOrder = "recentFirst",
): number {
  const aRecency = getActivityRecency(a);
  const bRecency = getActivityRecency(b);
  if (aRecency.period !== bRecency.period) {
    return order === "chronological"
      ? aRecency.period - bRecency.period
      : bRecency.period - aRecency.period;
  }

  const aBoundary = getActivityBoundaryRank(a);
  const bBoundary = getActivityBoundaryRank(b);
  if (aBoundary !== bBoundary) {
    return order === "chronological"
      ? aBoundary - bBoundary
      : bBoundary - aBoundary;
  }

  if (aRecency.progress !== bRecency.progress) {
    return order === "chronological"
      ? aRecency.progress - bRecency.progress
      : bRecency.progress - aRecency.progress;
  }

  return order === "chronological"
    ? getActivitySequence(a) - getActivitySequence(b)
    : getActivitySequence(b) - getActivitySequence(a);
}

function sortActivitiesForDisplay(
  items: ActivityItem[],
  order: ActivityDisplayOrder = "recentFirst",
): ActivityItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const a = left.item;
      const b = right.item;
      const aWallclock = a.sortWallclock || "";
      const bWallclock = b.sortWallclock || "";
      if (aWallclock && bWallclock && aWallclock !== bWallclock) {
        return order === "chronological"
          ? aWallclock.localeCompare(bWallclock)
          : bWallclock.localeCompare(aWallclock);
      }

      const sameGame = (a.gameId || a.id) === (b.gameId || b.id);
      if (sameGame) {
        return compareActivitiesWithinGame(a, b, order);
      }

      return left.index - right.index;
    })
    .map(({ item }) => item);
}

function getActivityStatusPriority(status: string): number {
  switch (status) {
    case "live":
      return 0;
    case "upcoming":
      return 1;
    case "final":
      return 2;
    default:
      return 3;
  }
}

function sortSummaryActivitiesChronologically(items: ActivityItem[]): ActivityItem[] {
  return [...items].sort((a, b) => {
    const aWallclock = a.sortWallclock || "";
    const bWallclock = b.sortWallclock || "";

    if (aWallclock && bWallclock && aWallclock !== bWallclock) {
      return aWallclock.localeCompare(bWallclock);
    }
    if (aWallclock !== bWallclock) {
      return aWallclock ? -1 : 1;
    }

    const aLeagueRank = LEAGUE_PRIORITY[a.league] ?? 99;
    const bLeagueRank = LEAGUE_PRIORITY[b.league] ?? 99;
    if (aLeagueRank !== bLeagueRank) {
      return aLeagueRank - bLeagueRank;
    }

    const aMatchup = a.gameMatchup || `${a.awayAbbr || a.awayTeam} vs ${a.homeAbbr || a.homeTeam}`;
    const bMatchup = b.gameMatchup || `${b.awayAbbr || b.awayTeam} vs ${b.homeAbbr || b.homeTeam}`;
    return aMatchup.localeCompare(bMatchup);
  });
}

function filterGamesForLeague(games: ESPNGame[], league?: string): ESPNGame[] {
  const requestedLeague = (league || "ALL").toUpperCase();
  const dashboardGames = games.filter((game) => isDashboardLeague(game.league));
  if (requestedLeague === "ALL") return dashboardGames;
  return dashboardGames.filter((game) => game.league === requestedLeague);
}

function getPredictionCacheFingerprint(game: GameItem): string {
  return [
    game.leagueKey,
    game.status,
    game.statusDetail || "",
    game.scheduledAt || "",
    String(game.awayScore),
    String(game.homeScore),
  ].join("|");
}

function getPredictionCacheTtlMs(game: GameItem): number {
  if (game.status === "live") return LIVE_PREDICTION_CACHE_TTL_MS;
  if (game.status === "upcoming") return 3 * 60_000;
  if (game.status === "final") return 60 * 60_000;
  return 60_000;
}

function supportsPredictions(game: GameItem): boolean {
  return game.status === "live" || game.status === "upcoming" || game.status === "final";
}

export default function DashboardPage() {
  const cachedNewsByLeague = useMemo(() => readDashboardNewsCache({ freshOnly: true }), []);
  const staleNewsByLeague = useMemo(() => readDashboardNewsCache({ freshOnly: false }), []);
  const cachedFeaturedItems = useMemo(() => readFreshDashboardFeaturedCache(), []);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeSport, setActiveSport] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"all" | "live" | "upcoming" | "final">("all");
  const [predictionsByGame, setPredictionsByGame] = useState<Record<string, PredictionResult | null>>({});
  const [isDateSwitching, setIsDateSwitching] = useState(false);
  const [hasResolvedGamesOnce, setHasResolvedGamesOnce] = useState(false);
  const [activityDate, setActivityDate] = useState<string>("");  // "" = today
  const [activityLeague, setActivityLeague] = useState<string>("ALL");
  const [activityStatusFilter, setActivityStatusFilter] = useState<"all" | "live" | "final">("all");
  const [activityVisibleCount, setActivityVisibleCount] = useState(ACTIVITY_PAGE_SIZE);
  const predictionCacheRef = useRef<Record<string, PredictionCacheEntry>>(
    readSessionJson<Record<string, PredictionCacheEntry>>(PREDICTION_CACHE_STORAGE_KEY, {}),
  );
  const predictionRequestInFlightRef = useRef<Set<string>>(new Set());
  const gameSlateCacheRef = useRef<Record<string, GameSlateCacheEntry>>(
    readSessionJson<Record<string, GameSlateCacheEntry>>(GAME_SLATE_CACHE_STORAGE_KEY, {}),
  );
  const eventsRequestPromiseRef = useRef<Record<string, Promise<GameItem[]>>>({});
  const liveActivityRequestPromiseRef = useRef<Record<string, Promise<ActivityCacheEntry | null>>>({});
  const [predictionRefreshTick, setPredictionRefreshTick] = useState(0);
  const [predictionsLoadingIds, setPredictionsLoadingIds] = useState<Set<string>>(new Set());
  const predictionsByGameRef = useRef<Record<string, PredictionResult | null>>({});

  const mapNewsItems = useCallback((rawItems: NewsItem[]) => {
    return (rawItems || [])
      .filter((n: NewsItem) => isDashboardLeague(n.league))
      .map((n: NewsItem) => ({
        ...n,
        publishedAt: n.publishedAt ? formatTimeAgo(n.publishedAt) : "Today",
      }));
  }, []);

  const initialSavedTeamRecords = useMemo<Record<string, unknown>[]>(
    () => buildLocalSavedTeamFallback().map((team) => serializeSavedTeamSummary(team)),
    [],
  );
  const { data: rawSavedTeams = initialSavedTeamRecords } = useQuery<Record<string, unknown>[]>({
    queryKey: ["savedTeams"],
    queryFn: async () => {
      const response = await apiClient.get(API.USER_TEAMS);
      return Array.isArray(response.data) ? response.data : [];
    },
    staleTime: 600_000,
    initialData: initialSavedTeamRecords.length ? initialSavedTeamRecords : undefined,
    refetchOnWindowFocus: false,
  });
  const savedTeams = useMemo(() => mapSavedTeamRecords(rawSavedTeams), [rawSavedTeams]);
  const selectedDateKey = useMemo(() => formatCompactDate(selectedDate), [selectedDate]);
  const isSelectedDateToday = useMemo(
    () => selectedDateKey === formatCompactDate(new Date()),
    [selectedDateKey],
  );
  const activityRequestDate = useMemo(() => {
    const todayKey = formatCompactDate(new Date());
    const resolvedActivityDate = activityDate || selectedDateKey;
    if (!resolvedActivityDate) {
      return "";
    }

    if (resolvedActivityDate !== todayKey) {
      return resolvedActivityDate;
    }

    return activityStatusFilter === "final" ? resolvedActivityDate : "";
  }, [activityDate, activityStatusFilter, selectedDateKey]);
  const gamesQuery = useQuery<GameItem[]>({
    queryKey: ["dashboardGames", selectedDateKey],
    queryFn: async () => {
      try {
        return await loadSlateForDate(selectedDateKey);
      } catch {
        await warmApiConnection();
        return loadSlateForDate(selectedDateKey);
      }
    },
    initialData: (() => {
      const cachedSlate = gameSlateCacheRef.current[selectedDateKey];
      if (cachedSlate?.data?.length) {
        return cachedSlate.data;
      }
      return undefined;
    })(),
    refetchInterval: isSelectedDateToday ? LIVE_DASHBOARD_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    staleTime: isSelectedDateToday ? 0 : 15 * 60_000,
    retry: false,
  });
  const games = useMemo(() => gamesQuery.data ?? [], [gamesQuery.data]);
  const gamesError = gamesQuery.error instanceof Error
    ? /network|timeout|fetch/i.test(gamesQuery.error.message)
      ? "Scores are temporarily unavailable because the API server is not responding."
      : "Scores are temporarily unavailable right now."
    : "";
  const isLoading = !hasResolvedGamesOnce && gamesQuery.isLoading;
  const featuredQuery = useQuery<FeaturedItem[]>({
    queryKey: ["dashboardFeatured"],
    queryFn: async () => {
      const resp = await apiClient.get(API.ESPN_FEATURED);
      const items = (resp.data.featured || [])
        .map((featured: ESPNGame) => ({
          ...featured,
          thumb: null,
          strTime: featured.statusDetail,
        }))
        .filter((item: FeaturedItem) => isDashboardLeague(item.league));
      writeDashboardFeaturedCache(items);
      return items;
    },
    initialData: cachedFeaturedItems.length ? cachedFeaturedItems : undefined,
    staleTime: DASHBOARD_FEATURED_CACHE_TTL_MS,
    refetchInterval: DASHBOARD_FEATURED_CACHE_TTL_MS,
    refetchOnWindowFocus: false,
  });
  const featuredItems = featuredQuery.data || [];
  const featuredLoading = featuredQuery.isLoading && featuredItems.length === 0;
  const allNewsQuery = useQuery<NewsItem[]>({
    queryKey: ["dashboardNews", "ALL"],
    queryFn: async () => {
      const resp = await apiClient.get(API.ESPN_NEWS);
      const items = mapNewsItems(resp.data.news || []);
      writeDashboardNewsCacheEntry("ALL", items);
      return items;
    },
    initialData: cachedNewsByLeague.ALL ?? staleNewsByLeague.ALL,
    staleTime: DASHBOARD_NEWS_CACHE_TTL_MS,
    refetchOnWindowFocus: false,
  });
  const activeLeagueNewsQuery = useQuery<NewsItem[]>({
    queryKey: ["dashboardNews", activeSport],
    enabled: activeSport !== "ALL" && activeSport !== "MY_TEAMS",
    queryFn: async () => {
      const resp = await apiClient.get(API.ESPN_NEWS, { params: { league: activeSport } });
      const items = mapNewsItems(resp.data.news || []);
      writeDashboardNewsCacheEntry(activeSport, items);
      return items;
    },
    initialData: activeSport !== "ALL" && activeSport !== "MY_TEAMS"
      ? cachedNewsByLeague[activeSport] ?? staleNewsByLeague[activeSport]
      : undefined,
    staleTime: DASHBOARD_NEWS_CACHE_TTL_MS,
    refetchOnWindowFocus: false,
  });

  const hasSavedTeams = savedTeams.length > 0;
  const isSavedMatchup = useCallback(
    (
      homeTeam: { name: string; shortName?: string },
      awayTeam: { name: string; shortName?: string },
      gameLeague: string,
    ) => savedTeams.some((team) =>
      matchesSavedTeamSide(homeTeam, gameLeague, team) || matchesSavedTeamSide(awayTeam, gameLeague, team)
    ),
    [savedTeams],
  );

  useEffect(() => {
    predictionsByGameRef.current = predictionsByGame;
  }, [predictionsByGame]);

  useEffect(() => {
    const activeGameIds = new Set(games.map((game) => game.id));
    const predictionEligibleIds = new Set(
      games.filter((game) => supportsPredictions(game)).map((game) => game.id),
    );

    setPredictionsByGame((prev) => {
      const prevKeys = Object.keys(prev);
      if (prevKeys.length === 0) {
        return prev;
      }

      const nextEntries = prevKeys
        .filter((gameId) => activeGameIds.has(gameId))
        .map((gameId) => [gameId, prev[gameId]] as const);

      if (nextEntries.length === prevKeys.length) {
        return prev;
      }

      return Object.fromEntries(nextEntries);
    });

    setPredictionsLoadingIds((prev) => {
      if (prev.size === 0) {
        return prev;
      }

      let removedAny = false;
      const next = new Set<string>();
      prev.forEach((gameId) => {
        if (predictionEligibleIds.has(gameId)) {
          next.add(gameId);
        } else {
          removedAny = true;
        }
      });

      return removedAny ? next : prev;
    });
  }, [games]);

  useEffect(() => {
    if (gamesQuery.data || gamesQuery.error) {
      setHasResolvedGamesOnce(true);
    }
    if (!gamesQuery.isFetching) {
      setIsDateSwitching(false);
    }
  }, [gamesQuery.data, gamesQuery.error, gamesQuery.isFetching]);

  useEffect(() => {
    try {
      localStorage.setItem("sportsync_saved_teams", JSON.stringify(rawSavedTeams));
    } catch {
      // Ignore local storage sync failures and keep the shared query cache authoritative.
    }
  }, [rawSavedTeams]);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  /* Parse activity response into ActivityItem[] */
  const parseActivities = useCallback((
    data: Record<string, unknown>[],
    order: ActivityDisplayOrder = "recentFirst",
  ) => {
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
      isSavedTeam: isSavedMatchup(
        { name: String(a.homeTeam || ""), shortName: String(a.homeAbbr || "") },
        { name: String(a.awayTeam || ""), shortName: String(a.awayAbbr || "") },
        String(a.league || ""),
      ),
    })) as ActivityItem[];

    return sortActivitiesForDisplay(items, order);
  }, [isSavedMatchup]);

  const buildGameSummaryActivities = useCallback((games: ESPNGame[]) => {
    const items = games.map((game) => {
      const isUpcoming = game.status === "upcoming";
      const summaryText = isUpcoming
        ? `${game.awayTeam} at ${game.homeTeam}`
        : game.headline
          ? `${game.headline} - ${game.awayTeam} ${game.awayScore}, ${game.homeTeam} ${game.homeScore}`
          : `${game.awayTeam} ${game.awayScore}, ${game.homeTeam} ${game.homeScore}`;

      return {
        id: `summary_${game.league}_${game.id}`,
        gameId: game.id,
        text: summaryText,
        playType:
          game.status === "live"
            ? "Game Update"
            : game.status === "upcoming"
              ? "Scheduled Game"
              : "End of Game",
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
        sortWallclock: game.scheduledAt || game.dateEvent || "",
        isSavedTeam: isSavedMatchup(
          { name: game.homeTeam, shortName: game.homeAbbr || "" },
          { name: game.awayTeam, shortName: game.awayAbbr || "" },
          game.league,
        ),
      };
    }) as ActivityItem[];

    return sortSummaryActivitiesChronologically(items);
  }, [isSavedMatchup]);

  const buildDashboardGameSummaryActivities = useCallback((gameItems: GameItem[]) => {
    const items = gameItems.map((game) => {
      const isUpcoming = game.status === "upcoming";
      const awayLabel = game.awayTeam.shortName || game.awayTeam.name;
      const homeLabel = game.homeTeam.shortName || game.homeTeam.name;
      return {
        id: `dashboard_summary_${game.league}_${game.id}`,
        gameId: game.id,
        text: isUpcoming
          ? `${game.awayTeam.name} at ${game.homeTeam.name}`
          : `${game.awayTeam.name} ${game.awayScore}, ${game.homeTeam.name} ${game.homeScore}`,
        playType:
          game.status === "live"
            ? "Game Update"
            : game.status === "upcoming"
              ? "Scheduled Game"
              : "End of Game",
        athleteName: "",
        athleteHeadshot: "",
        athleteStats: "",
        athlete2Name: "",
        athlete2Headshot: "",
        playTeamName: "",
        playTeamAbbr: "",
        playTeamLogo: "",
        league: game.league,
        statusDetail: game.statusDetail || "",
        homeTeam: game.homeTeam.name,
        awayTeam: game.awayTeam.name,
        homeAbbr: game.homeTeam.shortName || "",
        awayAbbr: game.awayTeam.shortName || "",
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        homeBadge: game.homeTeam.logoUrl || "",
        awayBadge: game.awayTeam.logoUrl || "",
        gameMatchup: `${awayLabel} vs ${homeLabel}`,
        status: game.status,
        sortWallclock: game.scheduledAt || "",
        isSavedTeam: isSavedMatchup(
          { name: game.homeTeam.name, shortName: game.homeTeam.shortName || "" },
          { name: game.awayTeam.name, shortName: game.awayTeam.shortName || "" },
          game.leagueKey,
        ),
      };
    }) as ActivityItem[];

    return sortSummaryActivitiesChronologically(items);
  }, [isSavedMatchup]);

  const fetchLiveActivityDirect = useCallback(async (leagueStr?: string) => {
    const todayStr = formatCompactDate(new Date());
    const requestKey = `${(leagueStr || "ALL").toUpperCase()}::${todayStr}`;
    const existingRequest = liveActivityRequestPromiseRef.current[requestKey];
    if (existingRequest) {
      return existingRequest;
    }

    const requestPromise = (async () => {
      const collectedActivities: Record<string, unknown>[] = [];
      let total = 0;
      let offset = 0;
      let pageCount = 0;

      while (pageCount < MAX_ACTIVITY_FETCH_PAGES) {
        const params: Record<string, string | number | boolean> = {
          date: todayStr,
          live_day: true,
          limit: ACTIVITY_FETCH_BATCH_SIZE,
          offset,
        };
        if (leagueStr && leagueStr !== "ALL") {
          params.league = leagueStr;
        }

        const resp = await apiClient.get(API.ESPN_ACTIVITY, { params });
        const activities = Array.isArray(resp.data.activities) ? resp.data.activities : [];
        total = Math.max(total, Number(resp.data.total || 0), collectedActivities.length + activities.length);
        collectedActivities.push(...activities);

        const hasMore = Boolean(resp.data.hasMore);
        if (!hasMore || activities.length === 0) {
          break;
        }

        offset += activities.length;
        pageCount += 1;
        if (activities.length < ACTIVITY_FETCH_BATCH_SIZE) {
          break;
        }
      }

      const parsed = parseActivities(collectedActivities, "recentFirst");
      if (!parsed.length) {
        return null;
      }

      return {
        items: parsed,
        total: Math.max(total, parsed.length),
        hasMore: false,
        allItems: parsed,
        effectiveDate: "",
      } as ActivityCacheEntry;
    })();

    liveActivityRequestPromiseRef.current[requestKey] = requestPromise;
    try {
      return await requestPromise;
    } finally {
      delete liveActivityRequestPromiseRef.current[requestKey];
    }
  }, [parseActivities]);

  const latestActivityDateCacheRef = useRef<Record<string, string | null>>({});
  const activityResponseCacheRef = useRef<Record<string, ActivityCacheEntry>>(
    readSessionJson<Record<string, ActivityCacheEntry>>(ACTIVITY_CACHE_STORAGE_KEY, {}),
  );

  const persistPredictionCache = useCallback(() => {
    writeSessionJson(PREDICTION_CACHE_STORAGE_KEY, predictionCacheRef.current);
  }, []);

  const persistGameSlateCache = useCallback(() => {
    const entries = Object.entries(gameSlateCacheRef.current);
    const compact = Object.fromEntries(entries.slice(-10));
    writeSessionJson(GAME_SLATE_CACHE_STORAGE_KEY, compact);
  }, []);

  const loadSlateForDate = useCallback(async (dateStr: string) => {
    let requestPromise = eventsRequestPromiseRef.current[dateStr];
    if (!requestPromise) {
      requestPromise = apiClient.get(API.ESPN_ALL, {
        params: { d: dateStr },
      }).then((resp) => {
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

        return unique;
      }).finally(() => {
        delete eventsRequestPromiseRef.current[dateStr];
      });
      eventsRequestPromiseRef.current[dateStr] = requestPromise;
    }

    const unique = await requestPromise;
    gameSlateCacheRef.current[dateStr] = {
      cachedAt: Date.now(),
      data: unique,
    };
    persistGameSlateCache();
    return unique;
  }, [persistGameSlateCache]);

  const warmApiConnection = useCallback(async () => {
    try {
      await apiClient.get("/api/health", { timeout: API_WARM_RETRY_TIMEOUT_MS });
    } catch {
      // Best effort warm-up only.
    }
  }, []);

  const persistActivityCache = useCallback(() => {
    const entries = Object.entries(activityResponseCacheRef.current);
    const compact = Object.fromEntries(
      entries.slice(-8).map(([key, entry]) => [
        key,
        {
          items: entry.items,
          total: entry.total,
          hasMore: entry.hasMore,
          cachedForDay: entry.cachedForDay,
          cachedAt: entry.cachedAt,
        } satisfies ActivityCacheEntry,
      ]),
    );
    writeSessionJson(ACTIVITY_CACHE_STORAGE_KEY, compact);
  }, []);

  const setPredictionCacheEntry = useCallback((gameId: string, entry: PredictionCacheEntry) => {
    predictionCacheRef.current[gameId] = entry;
    persistPredictionCache();
  }, [persistPredictionCache]);

  const setActivityCacheEntry = useCallback((cacheKey: string, entry: ActivityCacheEntry) => {
    const explicitDate = cacheKey.split("::").pop() || "";
    activityResponseCacheRef.current[cacheKey] = {
      ...entry,
      cachedForDay:
        isLiveActivityCacheKey(cacheKey) || isFutureCompactDate(explicitDate)
          ? getCurrentActivityDay()
          : entry.cachedForDay,
      cachedAt: Date.now(),
    };
    persistActivityCache();
  }, [persistActivityCache]);

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

  const fetchGameSummaryFallback = useCallback(async (dateStr?: string, leagueStr?: string) => {
    try {
      const resp = await apiClient.get(API.ESPN_ALL, {
        params: dateStr ? { d: dateStr } : undefined,
      });
      const games = filterGamesForLeague(resp.data.games || [], leagueStr);
      return buildGameSummaryActivities(games);
    } catch {
      return [] as ActivityItem[];
    }
  }, [buildGameSummaryActivities]);

  const buildFallbackActivitiesForDate = useCallback(async (
    dateStr: string,
    leagueStr?: string,
    options?: { scheduleOnly?: boolean },
  ) => {
    const requestedLeague = (leagueStr || "ALL").toUpperCase();
    const includeGame = (game: GameItem) => {
      if (requestedLeague !== "ALL" && game.leagueKey !== requestedLeague) {
        return false;
      }
      return options?.scheduleOnly ? game.status === "upcoming" : true;
    };

    const cachedSlate = gameSlateCacheRef.current[dateStr];
    const cachedGames = cachedSlate?.data.filter(includeGame) ?? [];
    if (cachedGames.length > 0) {
      return buildDashboardGameSummaryActivities(cachedGames);
    }

    try {
      const loadedGames = (await loadSlateForDate(dateStr)).filter(includeGame);
      if (loadedGames.length > 0) {
        return buildDashboardGameSummaryActivities(loadedGames);
      }
    } catch {
      // Fall back to the lighter summary request below.
    }

    const fallbackActivities = await fetchGameSummaryFallback(dateStr, leagueStr);
    return options?.scheduleOnly
      ? fallbackActivities.filter((item) => item.status === "upcoming")
      : fallbackActivities;
  }, [buildDashboardGameSummaryActivities, fetchGameSummaryFallback, loadSlateForDate]);

  const loadActivityFeed = useCallback(async (dateStr?: string, leagueStr?: string): Promise<ActivityCacheEntry> => {
    const cacheKey = buildActivityCacheKey(dateStr, leagueStr);
    const cachedEntry = activityResponseCacheRef.current[cacheKey];
    const cached = isFreshLiveActivityEntry(cacheKey, cachedEntry) ? cachedEntry : undefined;
    if (cached) {
      return {
        ...cached,
        allItems: cached.allItems ?? cached.items,
      };
    }
    if (cachedEntry) {
      delete activityResponseCacheRef.current[cacheKey];
      persistActivityCache();
    }

    if (isFutureCompactDate(dateStr)) {
      const scheduledGames = dateStr
        ? await buildFallbackActivitiesForDate(dateStr, leagueStr, { scheduleOnly: true })
        : [];
      const entry: ActivityCacheEntry = {
        items: scheduledGames,
        total: scheduledGames.length,
        hasMore: false,
        allItems: scheduledGames,
        effectiveDate: dateStr,
      };
      setActivityCacheEntry(cacheKey, entry);
      return entry;
    }

    if (!dateStr) {
      const liveEntry = await fetchLiveActivityDirect(leagueStr);
      if (liveEntry) {
        const hydratedEntry: ActivityCacheEntry = {
          ...liveEntry,
          allItems: liveEntry.allItems ?? liveEntry.items,
          effectiveDate: "",
        };
        setActivityCacheEntry(cacheKey, hydratedEntry);
        return hydratedEntry;
      }
    }

    const requestLeague = leagueStr && leagueStr !== "ALL" ? leagueStr : undefined;
    const requestDate = dateStr || undefined;
    const localTodayKey = formatCompactDate(new Date());
    const isCurrentDayRequest = requestDate === localTodayKey;
    const collectedActivities: Record<string, unknown>[] = [];
    let total = 0;
    let offset = 0;

    let pageCount = 0;
    while (pageCount < MAX_ACTIVITY_FETCH_PAGES) {
      const params: Record<string, string | number | boolean> = {
        limit: ACTIVITY_FETCH_BATCH_SIZE,
        offset,
      };
      if (requestDate) {
        params.date = requestDate;
        if (isCurrentDayRequest) {
          params.live_day = true;
        }
      }
      if (requestLeague) {
        params.league = requestLeague;
      }

      const resp = await apiClient.get(API.ESPN_ACTIVITY, { params });
      const activities = Array.isArray(resp.data.activities) ? resp.data.activities : [];
      total = Math.max(total, Number(resp.data.total || 0), collectedActivities.length + activities.length);
      collectedActivities.push(...activities);

      const hasMore = Boolean(resp.data.hasMore);
      if (!hasMore || activities.length === 0) {
        break;
      }
      offset += activities.length;
      pageCount += 1;
      if (activities.length < ACTIVITY_FETCH_BATCH_SIZE) {
        break;
      }
    }

    const displayOrder: ActivityDisplayOrder =
      !requestDate || isCurrentDayRequest ? "recentFirst" : "chronological";
    const parsed = parseActivities(collectedActivities, displayOrder);

    if (parsed.length === 0) {
      if (requestDate) {
        const fallbackGames = await buildFallbackActivitiesForDate(requestDate, leagueStr);
        const fallbackEntry: ActivityCacheEntry = {
          items: fallbackGames,
          total: fallbackGames.length,
          hasMore: false,
          allItems: fallbackGames,
          effectiveDate: requestDate,
        };
        setActivityCacheEntry(cacheKey, fallbackEntry);
        return fallbackEntry;
      }

      const latestDate = await findLatestActivityDate(leagueStr);
      if (latestDate && latestDate !== requestDate) {
        const fallbackEntry = await loadActivityFeed(latestDate, leagueStr);
        const latestEntry: ActivityCacheEntry = {
          ...fallbackEntry,
          effectiveDate: latestDate,
        };
        setActivityCacheEntry(cacheKey, latestEntry);
        return latestEntry;
      }
    }

    const entry: ActivityCacheEntry = {
      items: parsed,
      total: Math.max(total, parsed.length),
      hasMore: false,
      allItems: parsed,
      effectiveDate: requestDate || "",
    };
    setActivityCacheEntry(cacheKey, entry);
    return entry;
  }, [
    buildFallbackActivitiesForDate,
    fetchLiveActivityDirect,
    findLatestActivityDate,
    parseActivities,
    persistActivityCache,
    setActivityCacheEntry,
  ]);

  const activityQuery = useQuery<ActivityCacheEntry>({
    queryKey: ["dashboardActivity", activityRequestDate || "LIVE", activityLeague],
    queryFn: async () => {
      try {
        return await loadActivityFeed(activityRequestDate || undefined, activityLeague);
      } catch {
        await warmApiConnection();
        return loadActivityFeed(activityRequestDate || undefined, activityLeague);
      }
    },
    initialData: (() => {
      const cacheKey = buildActivityCacheKey(activityRequestDate || undefined, activityLeague);
      const cachedEntry = activityResponseCacheRef.current[cacheKey];
      if (!cachedEntry?.items?.length || !isFreshLiveActivityEntry(cacheKey, cachedEntry)) {
        return undefined;
      }
      return {
        ...cachedEntry,
        allItems: cachedEntry.allItems ?? cachedEntry.items,
      };
    })(),
    refetchInterval: isSelectedDateToday ? LIVE_DASHBOARD_REFRESH_MS : false,
    refetchIntervalInBackground: isSelectedDateToday,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const loadMoreActivity = useCallback(() => {
    setActivityVisibleCount((prev) => prev + ACTIVITY_PAGE_SIZE);
  }, []);

  const handleActivityDateChange = useCallback((dateStr: string) => {
    const parsedDate = dateStr ? parseCompactDate(dateStr) : new Date();
    if (parsedDate) {
      setSelectedDate(parsedDate);
    }
    setActivityVisibleCount(ACTIVITY_PAGE_SIZE);
    setActivityDate(dateStr);
  }, []);

  const handleSelectedDateChange = useCallback((nextDate: Date) => {
    if (formatCompactDate(nextDate) === formatCompactDate(selectedDate)) {
      return;
    }

    const nextDateStr = formatCompactDate(nextDate);
    const todayDateStr = formatCompactDate(new Date());
    setSelectedDate(nextDate);
    setActivityVisibleCount(ACTIVITY_PAGE_SIZE);
    setIsDateSwitching(true);
    setActivityDate(nextDateStr === todayDateStr ? "" : nextDateStr);
  }, [selectedDate]);

  useEffect(() => {
    if (!isSelectedDateToday) {
      return;
    }
    const interval = setInterval(() => {
      setPredictionRefreshTick((tick) => tick + 1);
    }, LIVE_DASHBOARD_REFRESH_MS);
    return () => clearInterval(interval);
  }, [isSelectedDateToday]);

  useEffect(() => {
    const shouldPrioritizeVisibleHeadlines = !(allNewsQuery.data?.length) && allNewsQuery.isLoading;
    const timer = window.setTimeout(() => {
      const offsets = [-2, -1, 1, 2];
      void Promise.allSettled(
        offsets.map(async (offset) => {
          const nearbyDate = new Date(selectedDate);
          nearbyDate.setDate(selectedDate.getDate() + offset);
          const nearbyDateStr = formatCompactDate(nearbyDate);
          const cachedSlate = gameSlateCacheRef.current[nearbyDateStr];
          const isCurrentDay = nearbyDateStr === formatCompactDate(new Date());
          const ttlMs = isCurrentDay ? 30_000 : 15 * 60_000;

          if (cachedSlate && Date.now() - cachedSlate.cachedAt < ttlMs) {
            return;
          }

          await loadSlateForDate(nearbyDateStr);
        }),
      );
    }, shouldPrioritizeVisibleHeadlines ? 2_500 : 900);

    return () => window.clearTimeout(timer);
  }, [allNewsQuery.data, allNewsQuery.isLoading, loadSlateForDate, selectedDate]);

  useEffect(() => {
    if (!games.length) {
      return;
    }

    const scopedGames = (() => {
      if (activeSport === "ALL") {
        return games;
      }
      if (activeSport === "MY_TEAMS") {
        return games.filter((game) =>
          savedTeams.some((team) =>
            matchesSavedTeamSide(game.homeTeam, game.leagueKey, team) ||
            matchesSavedTeamSide(game.awayTeam, game.leagueKey, team)
          )
        );
      }
      return games.filter((game) => game.leagueKey === activeSport);
    })();

    const liveScopedGames = scopedGames.filter((game) => game.status === "live");
    const upcomingScopedGames = scopedGames.filter((game) => game.status === "upcoming");
    const finalScopedGames = scopedGames.filter((game) => game.status === "final");
    const orderedScopedGames =
      statusFilter === "live"
        ? liveScopedGames
        : statusFilter === "upcoming"
          ? upcomingScopedGames
          : statusFilter === "final"
            ? finalScopedGames
            : [...liveScopedGames, ...upcomingScopedGames, ...finalScopedGames];
    const predictionTargetGames = orderedScopedGames
      .filter((game) => supportsPredictions(game));

    if (!predictionTargetGames.length) {
      return;
    }

    const now = Date.now();
    const nextState: Record<string, PredictionResult | null> = {};
    const gamesToFetch = predictionTargetGames.filter((game) => {
      const cached = predictionCacheRef.current[game.id];
      const fingerprint = getPredictionCacheFingerprint(game);
      const isRequestInFlight = predictionRequestInFlightRef.current.has(game.id);
      // Never cache failures — always retry games that returned null
      if (cached && cached.fingerprint === fingerprint && cached.data) {
        // Keep the last good value on screen while a background refresh updates it.
        nextState[game.id] = cached.data;
      }
      if (cached && cached.data === null) {
        return !isRequestInFlight;
      }
      if (
        cached
        && cached.fingerprint === fingerprint
        && now - cached.fetchedAt < getPredictionCacheTtlMs(game)
      ) {
        return false;
      }
      return !isRequestInFlight;
    });

    if (Object.keys(nextState).length > 0) {
      setPredictionsByGame((prev) => ({ ...prev, ...nextState }));
    }

    if (!gamesToFetch.length) {
      return;
    }

    let cancelled = false;
    let deferredTimer: number | null = null;

    const PRIORITY_PREDICTION_COUNT = 16;
    const PREDICTION_BATCH_SIZE = 18;
    const DEFERRED_PREDICTION_DELAY_MS = 150;
    const clearPredictionLoading = (batchGames: GameItem[]) => {
      batchGames.forEach((game) => {
        predictionRequestInFlightRef.current.delete(game.id);
      });
      setPredictionsLoadingIds((prev) => {
        const next = new Set(prev);
        batchGames.forEach((g) => next.delete(g.id));
        return next;
      });
    };

    /* Mark all games we're about to fetch as "loading" for the shimmer UI */
    setPredictionsLoadingIds((prev) => {
      const next = new Set(prev);
      gamesToFetch.forEach((game) => {
        if (!nextState[game.id] && !predictionsByGameRef.current[game.id]) {
          next.add(game.id);
        }
      });
      return next;
    });

    /* Try the batch endpoint first — all predictions in one request.
       Falls back to client-side estimates instead of hammering per-game endpoints. */
    async function fetchBatch(batchGames: GameItem[]) {
      if (!batchGames.length) {
        return new Set<string>();
      }
      try {
        const leagueMap: Record<string, string> = {};
        const gamesById = new Map(batchGames.map((game) => [game.id, game]));
        batchGames.forEach((g) => { leagueMap[g.id] = g.leagueKey; });
        const batchResp = await apiClient.post(API.PREDICT_BATCH, {
          game_ids: batchGames.map((g) => g.id),
          leagues: leagueMap,
        }, { timeout: 20_000 });
        if (cancelled) return new Set<string>();
        const predictions = batchResp.data?.predictions || {};
        const fetchedGameIds = new Set<string>();
        if (Object.keys(predictions).length > 0) {
          const updates: Record<string, PredictionResult | null> = {};
          for (const [gameId, data] of Object.entries(predictions)) {
            if (!data) continue;
            const d = data as { game_id: string; home_win_prob: number; away_win_prob: number; model_version: string };
            const game = gamesById.get(gameId);
            const fingerprint = game ? getPredictionCacheFingerprint(game) : "";
            const prediction: PredictionResult = {
              gameId: String(d.game_id),
              homeWinProb: Number(d.home_win_prob || 0),
              awayWinProb: Number(d.away_win_prob || 0),
              modelVersion: String(d.model_version || ""),
            };
            setPredictionCacheEntry(gameId, {
              fetchedAt: Date.now(),
              fingerprint,
              data: prediction,
            });
            updates[gameId] = prediction;
            fetchedGameIds.add(gameId);
          }
          if (Object.keys(updates).length > 0) {
            setPredictionsByGame((prev) => ({ ...prev, ...updates }));
          }
          return fetchedGameIds;
        }
      } catch {
        // Batch endpoint failed — fall back to per-game
      }
      return new Set<string>();
    }

    function fillFallbackPredictions(queueGames: GameItem[]) {
      if (!queueGames.length || cancelled) {
        return;
      }

      const updates: Record<string, PredictionResult | null> = {};
      queueGames.forEach((game) => {
        const fallbackPrediction = buildFallbackPrediction(game);
        setPredictionCacheEntry(game.id, {
          fetchedAt: Date.now(),
          fingerprint: getPredictionCacheFingerprint(game),
          data: fallbackPrediction,
        });
        updates[game.id] = fallbackPrediction;
      });

      if (Object.keys(updates).length > 0) {
        setPredictionsByGame((prev) => ({ ...prev, ...updates }));
      }

      clearPredictionLoading(queueGames);
    }

    (async () => {
      const priorityGames = gamesToFetch.slice(0, PRIORITY_PREDICTION_COUNT);
      const deferredGames = gamesToFetch.slice(PRIORITY_PREDICTION_COUNT);

      const loadGames = async (queueGames: GameItem[]) => {
        for (let index = 0; index < queueGames.length; index += PREDICTION_BATCH_SIZE) {
          if (cancelled) return;
          const chunk = queueGames.slice(index, index + PREDICTION_BATCH_SIZE);
          chunk.forEach((game) => {
            predictionRequestInFlightRef.current.add(game.id);
          });
          const fetchedIds = await fetchBatch(chunk);
          if (cancelled) return;
          const remainingGames = chunk.filter((game) => !fetchedIds.has(game.id));
          if (!remainingGames.length) {
            clearPredictionLoading(chunk);
            continue;
          }

          fillFallbackPredictions(remainingGames);
          clearPredictionLoading(chunk);
        }
      };

      await loadGames(priorityGames);
      if (cancelled) return;

      if (deferredGames.length) {
        deferredTimer = window.setTimeout(() => {
          if (!cancelled) {
            void loadGames(deferredGames);
          }
        }, DEFERRED_PREDICTION_DELAY_MS);
        return;
      }
    })();

    return () => {
      cancelled = true;
      if (deferredTimer) {
        window.clearTimeout(deferredTimer);
      }
      clearPredictionLoading(gamesToFetch);
    };
    // predictionRefreshTick drives periodic re-evaluation even when games array
    // reference hasn't changed (e.g. same scores on consecutive polls).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, activeSport, savedTeams, statusFilter, predictionRefreshTick]);

  /* Filter by sport tab */
  const filteredGames = useMemo(() => {
    if (activeSport === "ALL") return games;
    if (activeSport === "MY_TEAMS") {
      return games.filter((game) =>
        savedTeams.some((team) =>
          matchesSavedTeamSide(game.homeTeam, game.leagueKey, team) ||
          matchesSavedTeamSide(game.awayTeam, game.leagueKey, team)
        )
      );
    }
    return games.filter((g) => g.leagueKey === activeSport);
  }, [games, activeSport, savedTeams]);

  /** Check if either team in a game is one of the user's saved teams */
  const isMyTeamGame = useCallback((game: GameItem) => {
    if (!savedTeams.length) return false;
    return savedTeams.some((team) =>
      matchesSavedTeamSide(game.homeTeam, game.leagueKey, team) ||
      matchesSavedTeamSide(game.awayTeam, game.leagueKey, team)
    );
  }, [savedTeams]);

  const activityQueryData = activityQuery.data;
  const activityEffectiveDate = activityDate || activityQueryData?.effectiveDate || activityRequestDate;
  const activityAllItems = useMemo(
    () => activityQueryData?.allItems ?? activityQueryData?.items ?? [],
    [activityQueryData],
  );
  const activityItems = useMemo(
    () => activityAllItems.slice(0, activityVisibleCount),
    [activityAllItems, activityVisibleCount],
  );
  const activityHasMore = activityAllItems.length > activityItems.length;
  const activityTotal = activityQueryData?.total ?? activityAllItems.length;
  const activityLoading = activityQuery.isLoading || (activityQuery.isFetching && !activityQueryData);
  const activityError = activityQuery.error instanceof Error
    ? /network|timeout|fetch/i.test(activityQuery.error.message)
      ? "Live activity is temporarily unavailable because the API server is not responding."
      : "Live activity is temporarily unavailable right now."
    : "";
  const activityDisplayOrder: ActivityDisplayOrder =
    !activityEffectiveDate || activityEffectiveDate === formatCompactDate(new Date()) ? "recentFirst" : "chronological";
  const activityLeagueFinalGames = useMemo(
    () =>
      games.filter(
        (game) => game.status === "final" && (activityLeague === "ALL" || game.leagueKey === activityLeague),
      ),
    [activityLeague, games],
  );
  const normalizeActivityItemsForDisplay = useCallback((items: ActivityItem[]) => {
    const gameLookup = new Map(games.map((game) => [game.id, game]));
    return items.map((item) => {
      const nextSavedState = isSavedMatchup(
        { name: item.homeTeam, shortName: item.homeAbbr || "" },
        { name: item.awayTeam, shortName: item.awayAbbr || "" },
        item.league,
      );
      const game = gameLookup.get(item.gameId);
      const nextStatus = game?.status || item.status;
      const nextStatusDetail = game?.statusDetail || item.statusDetail;
      const nextSortWallclock = item.sortWallclock || game?.scheduledAt || "";
      if (
        item.isSavedTeam === nextSavedState &&
        item.status === nextStatus &&
        item.statusDetail === nextStatusDetail &&
        (item.sortWallclock || "") === nextSortWallclock
      ) {
        return item;
      }
      return {
        ...item,
        isSavedTeam: nextSavedState,
        status: nextStatus,
        statusDetail: nextStatusDetail,
        sortWallclock: nextSortWallclock,
      };
    });
  }, [games, isSavedMatchup]);
  const mergeActivityFinalSummaries = useCallback((
    items: ActivityItem[],
    feedFullyLoaded: boolean,
  ) => {
    if (!activityLeagueFinalGames.length || !feedFullyLoaded) {
      return items;
    }

    const existingFinalGameIds = new Set(
      items
        .filter((item) => item.status === "final")
        .map((item) => item.gameId || item.id),
    );
    const missingFinalSummaries = buildDashboardGameSummaryActivities(activityLeagueFinalGames)
      .filter((item) => !existingFinalGameIds.has(item.gameId || item.id));

    if (!missingFinalSummaries.length) {
      return items;
    }

    return sortActivitiesForDisplay(
      [...items, ...missingFinalSummaries],
      activityDisplayOrder,
    );
  }, [activityDisplayOrder, activityLeagueFinalGames, buildDashboardGameSummaryActivities]);
  const prioritizeCurrentDayActivity = useCallback((items: ActivityItem[]) => {
    const currentDayKey = formatCompactDate(new Date());
    const isCurrentDayActivity = !activityEffectiveDate || activityEffectiveDate === currentDayKey;
    if (!items.length || !isCurrentDayActivity) {
      return items;
    }

    return items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const priorityDelta =
          getActivityStatusPriority(left.item.status) - getActivityStatusPriority(right.item.status);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        return left.index - right.index;
      })
      .map(({ item }) => item);
  }, [activityEffectiveDate]);
  const activityFeedFullyLoaded = activityAllItems.length > 0 && !activityHasMore;
  const displayActivityAllItems = useMemo(() => {
    return prioritizeCurrentDayActivity(
      mergeActivityFinalSummaries(
        normalizeActivityItemsForDisplay(activityAllItems),
        activityFeedFullyLoaded,
      ),
    );
  }, [
    activityAllItems,
    activityFeedFullyLoaded,
    mergeActivityFinalSummaries,
    normalizeActivityItemsForDisplay,
    prioritizeCurrentDayActivity,
  ]);
  const displayActivityItems = useMemo(() => {
    return mergeActivityFinalSummaries(
      normalizeActivityItemsForDisplay(activityItems),
      activityFeedFullyLoaded,
    );
  }, [
    activityItems,
    activityFeedFullyLoaded,
    mergeActivityFinalSummaries,
    normalizeActivityItemsForDisplay,
  ]);
  const fallbackActivityItems = useMemo(() => {
    const relevantGames = games.filter(
      (game) => activityLeague === "ALL" || game.leagueKey === activityLeague,
    );
    return buildDashboardGameSummaryActivities(relevantGames).slice(0, ACTIVITY_PAGE_SIZE);
  }, [activityLeague, buildDashboardGameSummaryActivities, games]);
  const effectiveActivityAllItems =
    displayActivityAllItems.length > 0 ? displayActivityAllItems : fallbackActivityItems;
  const effectiveActivityItems =
    displayActivityItems.length > 0
      ? displayActivityItems
      : fallbackActivityItems.slice(0, activityVisibleCount);
  const activityDisplayTotal = useMemo(
    () => Math.max(activityTotal, effectiveActivityItems.length),
    [activityTotal, effectiveActivityItems.length],
  );
  const activityUiError = effectiveActivityAllItems.length > 0 ? "" : activityError;

  const visibleNewsItems = useMemo(() => {
    const allNews = allNewsQuery.data || [];
    if (activeSport === "ALL" || activeSport === "MY_TEAMS") {
      return allNews;
    }

    if (activeLeagueNewsQuery.data) {
      return activeLeagueNewsQuery.data;
    }

    return allNews.filter((item) => item.league === activeSport);
  }, [activeLeagueNewsQuery.data, activeSport, allNewsQuery.data]);
  const isNewsLoading = useMemo(() => {
    if (activeSport === "ALL" || activeSport === "MY_TEAMS") {
      return allNewsQuery.isLoading;
    }

    return allNewsQuery.isLoading || activeLeagueNewsQuery.isLoading;
  }, [activeLeagueNewsQuery.isLoading, activeSport, allNewsQuery.isLoading]);
  const showNewsSkeleton = visibleNewsItems.length === 0 && (isLoading || isNewsLoading);

  useEffect(() => {
    warmDashboardImages(visibleNewsItems.slice(0, 6).map((item) => item.imageUrl));
  }, [visibleNewsItems]);

  /* Split games into sections — respecting statusFilter */
  const liveGames = statusFilter === "all" || statusFilter === "live" ? filteredGames.filter((g) => g.status === "live") : [];
  const upcomingGames = statusFilter === "all" || statusFilter === "upcoming" ? filteredGames.filter((g) => g.status === "upcoming") : [];
  const finalGames = statusFilter === "all" || statusFilter === "final" ? filteredGames.filter((g) => g.status === "final") : [];
  const noGames = liveGames.length === 0 && upcomingGames.length === 0 && finalGames.length === 0;
  const slateTransitionClass = isDateSwitching ? "opacity-55 pointer-events-none select-none transition-opacity" : "transition-opacity";
  const selectedDateLabel = selectedDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

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
                    ? "border-[color:var(--danger-border)] bg-[color:var(--danger-fill)] text-[color:var(--danger)]"
                    : "bg-accent/15 text-accent border border-accent/30"
                  : "bg-surface border border-muted/15 text-muted hover:text-foreground"
              }`}
            >
              {status === "all" ? "All" : status === "live" ? "Live" : status === "upcoming" ? "Upcoming" : "Final"}
            </button>
          ))}
        </div>

        {/* Date picker strip */}
        <DateStrip selectedDate={selectedDate} onSelectDate={handleSelectedDateChange} />

        {isDateSwitching && (
          <section className="px-4 mb-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent">
              <span className="h-3.5 w-3.5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              <span>Loading {selectedDateLabel} slate...</span>
            </div>
          </section>
        )}

        {/* Loading state — skeleton grid instead of spinner */}
        {isLoading && (
          <section className="px-4 mb-6">
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
          </section>
        )}

        {/* ── Live Games Section ── */}
        {!isLoading && liveGames.length > 0 && (
          <section className={`px-4 mb-6 ${slateTransitionClass}`}>
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
          <section className={`px-4 mb-6 ${slateTransitionClass}`}>
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
          <section className={`px-4 mb-6 ${slateTransitionClass}`}>
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
        {!isLoading && gamesError && games.length === 0 && (
          <section className={`px-4 mb-8 ${slateTransitionClass}`}>
            <div className="surface-note-warning rounded-xl p-8 text-center">
              <p className="text-[color:var(--panel-text-warning)]">{gamesError}</p>
              <p className="text-muted text-sm mt-1">
                We could not refresh the scoreboard right now. Please try again in a moment.
              </p>
            </div>
          </section>
        )}

        {!isLoading && !gamesError && noGames && (
          <section className={`px-4 mb-8 ${slateTransitionClass}`}>
            <div className="bg-surface border border-muted/20 rounded-xl p-8 text-center">
              <p className="text-muted">No games found for this date.</p>
              <p className="text-muted text-sm mt-1">
                Try selecting a different date or use the calendar to jump to another day.
              </p>
            </div>
          </section>
        )}

        {showNewsSkeleton && (
          <section className="px-4 mb-8">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-5 w-5 skeleton-pulse rounded" />
              <div className="h-5 w-36 skeleton-pulse rounded" />
            </div>
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="w-72 flex-shrink-0 rounded-xl border border-muted/20 bg-surface overflow-hidden"
                >
                  <div className="h-32 skeleton-pulse" />
                  <div className="p-4">
                    <div className="h-4 w-full skeleton-pulse rounded" />
                    <div className="mt-2 h-4 w-11/12 skeleton-pulse rounded" />
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="h-3 w-20 skeleton-pulse rounded" />
                        <div className="h-1 w-1 rounded-full bg-muted/20 flex-none" />
                        <div className="h-3 w-12 skeleton-pulse rounded" />
                      </div>
                      <div className="h-3 w-14 skeleton-pulse rounded" />
                    </div>
                  </div>
                </div>
              ))}
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
              {visibleNewsItems.map((news, index) => (
                <NewsCard
                  key={news.id}
                  headline={news.headline}
                  source={news.source}
                  imageUrl={news.imageUrl}
                  publishedAt={news.publishedAt}
                  url={news.url || undefined}
                  league={news.league}
                  priority={index < 4}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Live Activity Feed ── */}
        <section className="px-4 mb-8">
          <LiveActivityFeed
            items={effectiveActivityItems}
            allItems={effectiveActivityAllItems}
            activityDate={activityEffectiveDate}
            onDateChange={handleActivityDateChange}
            hasMore={activityHasMore}
            onLoadMore={loadMoreActivity}
            total={activityDisplayTotal}
            loading={activityLoading && effectiveActivityAllItems.length === 0}
            error={activityUiError}
            activeLeague={activityLeague}
            savedTeams={savedTeams}
            statusFilter={activityStatusFilter}
            onStatusFilterChange={(nextStatus) => {
              setActivityVisibleCount(ACTIVITY_PAGE_SIZE);
              setActivityStatusFilter(nextStatus);
            }}
            onLeagueChange={(league) => {
              setActivityLeague(league);
              setActivityVisibleCount(ACTIVITY_PAGE_SIZE);
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
