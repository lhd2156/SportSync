import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import apiClient from "../api/client";
import Footer from "../components/Footer";
import Navbar from "../components/Navbar";
import Logo from "../components/Logo";
import { API, ROUTES } from "../constants";
import { useAuth } from "../context/AuthContext";
import { buildFallbackPrediction } from "../utils/predictions";

const HERO_PILLS = [
  "Live slate",
  "Saved team focus",
  "Highlights",
  "Standings",
  "Play-by-play",
  "Predictions",
] as const;

const LEAGUE_LOGOS = {
  NFL: "https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png",
  NBA: "https://a.espncdn.com/i/teamlogos/leagues/500/nba.png",
  MLB: "https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png",
  NHL: "https://a.espncdn.com/i/teamlogos/leagues/500/nhl.png",
  EPL: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png",
} as const;

const STATS = [
  { value: 5, suffix: "+", label: "Major leagues covered" },
  { value: 1, label: "Home base for the full slate" },
  { value: 4, label: "Primary game views per matchup" },
  { value: 24, label: "Hours the board can matter" },
] as const;

const FEATURE_CARDS = [
  {
    eyebrow: "Live Board",
    title: "Follow the slate without losing the thread.",
    body: "Live, upcoming, and final games stay in one readable rhythm, so the right matchup stands out the second the night changes.",
    numeral: "01",
  },
  {
    eyebrow: "Game Pages",
    title: "Click once and the context is already there.",
    body: "Leaders, play-by-play, box score, and matchup detail stay connected instead of feeling like separate destinations.",
    numeral: "02",
  },
  {
    eyebrow: "Personalization",
    title: "Your teams stay closer without turning into clutter.",
    body: "Saved teams reshape the slate, the feed, and the follow-up views so the app feels focused instead of noisy.",
    numeral: "03",
  },
] as const;

const LEAGUES = [
  { id: "NFL", label: "NFL", sport: "Football", logo: LEAGUE_LOGOS.NFL },
  { id: "NBA", label: "NBA", sport: "Basketball", logo: LEAGUE_LOGOS.NBA },
  { id: "MLB", label: "MLB", sport: "Baseball", logo: LEAGUE_LOGOS.MLB },
  { id: "NHL", label: "NHL", sport: "Hockey", logo: LEAGUE_LOGOS.NHL },
  { id: "EPL", label: "EPL", sport: "Soccer", logo: LEAGUE_LOGOS.EPL },
] as const;

const CHECKLIST = [
  {
    title: "Live scores and status-aware game cards.",
    body: "One cleaner board for live, upcoming, and final matchups.",
  },
  {
    title: "Game detail pages with the depth already connected.",
    body: "Leaders, box score, play-by-play, and game info stay in the same flow.",
  },
  {
    title: "Saved-team focus that reshapes the homepage.",
    body: "The games you care about do not have to fight for position.",
  },
  {
    title: "Prediction context layered right onto the slate.",
    body: "Useful before tipoff, during swings, and after the result.",
  },
  {
    title: "Highlights, standings, rosters, and season context.",
    body: "Five leagues, one product, one visual rhythm.",
  },
] as const;

const BOARD_LEAGUES = new Set(["NFL", "NBA", "MLB", "NHL", "EPL"]);
const BOARD_REFRESH_INTERVAL_MS = 60_000;
const BOARD_LOOKBACK_DAYS = 3;
const BOARD_SLOTS = 3;
const BOARD_ROTATION_WINDOW_MINUTES = 15;
const LEAGUE_PRIORITY: Record<string, number> = {
  NFL: 0,
  NBA: 1,
  MLB: 2,
  NHL: 3,
  EPL: 4,
};

type ESPNGame = {
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
  scheduledAt?: string;
  strTime: string;
  strVenue: string;
  headline: string;
};

type PredictionResult = {
  gameId: string;
  homeWinProb: number;
  awayWinProb: number;
  modelVersion: string;
};

type PredictionApiPayload = {
  game_id?: string;
  home_win_prob?: number;
  away_win_prob?: number;
  model_version?: string;
};

type BoardMode = "live" | "mixed" | "recent" | "scheduled" | "empty";

function easeOutCubic(value: number) {
  return 1 - (1 - value) ** 3;
}

function formatCompactDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

function shiftDate(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseEpoch(value?: string) {
  const parsed = Date.parse(String(value || ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededShuffle<T>(items: T[], seed: string) {
  const next = [...items];
  let state = hashSeed(seed) || 1;

  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1000) / 1000;
  };

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

function getRotationSeed(now = new Date()) {
  const bucket = Math.floor(now.getMinutes() / BOARD_ROTATION_WINDOW_MINUTES);
  return `${formatCompactDate(now)}-${now.getHours()}-${bucket}`;
}

function formatBoardCalendarDate(value?: string) {
  if (!value) {
    return "";
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return value;
  }

  const [, year, month, day] = match;
  const safeDate = new Date(Number(year), Number(month) - 1, Number(day), 12);

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(safeDate);
}

function normalizeBoardGames(input: unknown): ESPNGame[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const game = entry as Partial<ESPNGame>;
    const league = String(game.league || "").toUpperCase();
    if (!BOARD_LEAGUES.has(league)) {
      return [];
    }

    const normalizedGame: ESPNGame = {
      id: String(game.id || ""),
      homeTeam: String(game.homeTeam || ""),
      awayTeam: String(game.awayTeam || ""),
      homeAbbr: String(game.homeAbbr || ""),
      awayAbbr: String(game.awayAbbr || ""),
      homeScore: Number(game.homeScore || 0),
      awayScore: Number(game.awayScore || 0),
      homeBadge: String(game.homeBadge || ""),
      awayBadge: String(game.awayBadge || ""),
      homeColor: String((game as { homeColor?: string }).homeColor || ""),
      awayColor: String((game as { awayColor?: string }).awayColor || ""),
      status: String(game.status || "upcoming"),
      statusDetail: String(game.statusDetail || game.strTime || ""),
      league,
      dateEvent: String(game.dateEvent || ""),
      scheduledAt: String(game.scheduledAt || ""),
      strTime: String(game.strTime || game.statusDetail || ""),
      strVenue: String(game.strVenue || ""),
      headline: String(game.headline || ""),
    };

    if (!normalizedGame.id || !normalizedGame.homeTeam || !normalizedGame.awayTeam) {
      return [];
    }

    return [normalizedGame];
  });
}

function dedupeBoardGames(games: ESPNGame[]) {
  const seen = new Set<string>();
  return games.filter((game) => {
    if (seen.has(game.id)) {
      return false;
    }
    seen.add(game.id);
    return true;
  });
}

function sortLiveGames(games: ESPNGame[]) {
  return [...games].sort(
    (left, right) =>
      parseEpoch(right.scheduledAt) - parseEpoch(left.scheduledAt)
      || (LEAGUE_PRIORITY[left.league] ?? 99) - (LEAGUE_PRIORITY[right.league] ?? 99)
  );
}

function getRecentGameScore(game: ESPNGame) {
  const eventTime = parseEpoch(game.scheduledAt);
  const ageHours = eventTime ? Math.max(0, (Date.now() - eventTime) / 3_600_000) : 999;
  const recencyScore = Math.max(0, 96 - ageHours) * 100;
  const margin = Math.abs(game.homeScore - game.awayScore);
  const closenessScore = Math.max(0, 20 - margin) * 25;
  const leagueBoost = Math.max(0, 10 - (LEAGUE_PRIORITY[game.league] ?? 9));
  return recencyScore + closenessScore + leagueBoost;
}

function sortRecentGames(games: ESPNGame[]) {
  return [...games].sort(
    (left, right) =>
      getRecentGameScore(right) - getRecentGameScore(left)
      || parseEpoch(right.scheduledAt) - parseEpoch(left.scheduledAt)
      || (LEAGUE_PRIORITY[left.league] ?? 99) - (LEAGUE_PRIORITY[right.league] ?? 99)
  );
}

function sortUpcomingGames(games: ESPNGame[]) {
  return [...games].sort(
    (left, right) =>
      parseEpoch(left.scheduledAt) - parseEpoch(right.scheduledAt)
      || (LEAGUE_PRIORITY[left.league] ?? 99) - (LEAGUE_PRIORITY[right.league] ?? 99)
  );
}

function pickBoardGames(
  candidates: ESPNGame[],
  count: number,
  seed: string,
  usedLeagues = new Set<string>(),
  excludedGameIds = new Set<string>(),
) {
  if (count <= 0) {
    return [];
  }

  const available = candidates.filter((game) => !excludedGameIds.has(game.id));
  const shuffled = seededShuffle(available, seed);
  const selected: ESPNGame[] = [];
  const selectedIds = new Set<string>();
  const openLeagues = new Set(usedLeagues);

  for (const game of shuffled) {
    if (selected.length === count) {
      break;
    }
    if (openLeagues.has(game.league)) {
      continue;
    }
    selected.push(game);
    selectedIds.add(game.id);
    openLeagues.add(game.league);
  }

  for (const game of shuffled) {
    if (selected.length === count) {
      break;
    }
    if (selectedIds.has(game.id)) {
      continue;
    }
    selected.push(game);
    selectedIds.add(game.id);
    openLeagues.add(game.league);
  }

  return selected;
}

function selectBoardGames(todayGames: ESPNGame[], recentGames: ESPNGame[]): {
  games: ESPNGame[];
  mode: BoardMode;
} {
  // Fill the board with live games first, then backfill with recent finals while
  // preferring league variety before repeating the same sport.
  const seed = getRotationSeed();
  const liveGames = sortLiveGames(todayGames.filter((game) => game.status === "live"));
  const finalGames = sortRecentGames(recentGames.filter((game) => game.status === "final")).slice(0, 12);
  const selectedLive = pickBoardGames(liveGames, Math.min(BOARD_SLOTS, liveGames.length), `${seed}-live`);

  if (selectedLive.length) {
    const selectedRecent = pickBoardGames(
      finalGames,
      BOARD_SLOTS - selectedLive.length,
      `${seed}-recent`,
      new Set(selectedLive.map((game) => game.league)),
      new Set(selectedLive.map((game) => game.id)),
    );

    return {
      games: [...selectedLive, ...selectedRecent].slice(0, BOARD_SLOTS),
      mode: selectedRecent.length ? "mixed" : "live",
    };
  }

  const selectedRecent = pickBoardGames(finalGames, BOARD_SLOTS, `${seed}-recent`);
  if (selectedRecent.length) {
    return { games: selectedRecent, mode: "recent" };
  }

  const upcomingGames = sortUpcomingGames(todayGames.filter((game) => game.status === "upcoming")).slice(0, 12);
  const selectedUpcoming = pickBoardGames(upcomingGames, BOARD_SLOTS, `${seed}-upcoming`);
  if (selectedUpcoming.length) {
    return { games: selectedUpcoming, mode: "scheduled" };
  }

  return { games: [], mode: "empty" };
}

function getBoardDateLabel(game: ESPNGame) {
  if (!game.scheduledAt) {
    return formatBoardCalendarDate(game.dateEvent) || game.league;
  }

  if (game.status === "live" || game.status === "final") {
    return formatBoardCalendarDate(game.dateEvent) || game.league;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(game.scheduledAt));
}

function formatBoardTimestamp(value: Date | null) {
  if (!value) {
    return "Updating";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value).replace(",", " -");
}

function getBoardHeading(mode: BoardMode) {
  if (mode === "mixed") {
    return "Live + Recent";
  }
  if (mode === "recent") {
    return "Recent Board";
  }
  if (mode === "scheduled") {
    return "Next Up";
  }
  return "Live Board";
}

function getBoardBanner(mode: BoardMode, error: string) {
  if (error) {
    return error;
  }
  if (mode === "mixed") {
    return "Live now plus recent popular finals.";
  }
  if (mode === "recent") {
    return "No live games on the board. Showing recent popular finals.";
  }
  if (mode === "scheduled") {
    return "No live or final games found yet. Showing the next scheduled matchups.";
  }
  if (mode === "empty") {
    return "No scoreboard data is available right now.";
  }
  return "";
}

function getBoardStatusTone(status: string) {
  if (status === "live") {
    return "surface-status-negative";
  }
  if (status === "upcoming") {
    return "text-accent";
  }
  return "text-foreground-base";
}

function getBoardScore(game: ESPNGame) {
  if (game.status === "upcoming") {
    return "-- --";
  }
  return `${game.awayScore} - ${game.homeScore}`;
}

function getBoardNote(game: ESPNGame) {
  if (game.status === "live") {
    return game.strVenue || "In progress";
  }
  if (game.status === "final") {
    if (game.headline) {
      return game.headline;
    }

    const margin = Math.abs(game.homeScore - game.awayScore);
    if (margin <= 3) {
      return "Close finish";
    }
    if (margin >= 15) {
      return "Wide margin";
    }
    return "Recent final";
  }
  return game.strVenue || game.statusDetail || "Scheduled matchup";
}

function supportsPredictions(game: ESPNGame) {
  return game.status === "live" || game.status === "upcoming" || game.status === "final";
}

function toCssColor(color?: string, fallback = "var(--accent)") {
  if (!color) {
    return fallback;
  }

  const trimmed = color.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function StatValue({
  current,
  suffix,
}: {
  current: number;
  suffix?: string;
}) {
  return (
    <span className="tabular-nums">
      {current}
      {suffix ?? ""}
    </span>
  );
}

function TeamBadge({
  abbr,
  logo,
  name,
}: {
  abbr: string;
  logo: string;
  name: string;
}) {
  if (logo) {
    return (
      <div className="flex h-11 w-11 items-center justify-center border border-white/10 bg-background p-1.5">
        <img
          src={logo}
          alt={`${name} logo`}
          className="h-full w-full object-contain"
          loading="eager"
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }

  return (
    <div className="flex h-11 w-11 items-center justify-center border border-white/10 bg-background text-xs font-semibold tracking-[0.16em] text-foreground-base">
      {abbr}
    </div>
  );
}

function LeagueBadge({
  abbr,
  logo,
  name,
}: {
  abbr: string;
  logo: string;
  name: string;
}) {
  const [logoFailed, setLogoFailed] = useState(false);

  if (logo && !logoFailed) {
    return (
      <div className="flex h-16 items-center justify-center sm:h-[4.5rem]">
        <img
          src={logo}
          alt={`${name} logo`}
          className="h-12 w-auto object-contain img-fade-in sm:h-14"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setLogoFailed(true)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-16 items-center justify-center text-lg font-semibold tracking-[0.18em] text-accent sm:h-[4.5rem]">
      {abbr}
    </div>
  );
}

function BoardPredictionLine({
  game,
  prediction,
  isLoading,
}: {
  game: ESPNGame;
  prediction?: PredictionResult | null;
  isLoading: boolean;
}) {
  if (!supportsPredictions(game)) {
    return null;
  }

  if (prediction) {
    const homePct = Math.max(0, Math.min(100, Math.round(prediction.homeWinProb * 100)));
    const awayPct = Math.max(0, Math.min(100, Math.round(prediction.awayWinProb * 100)));
    const homeColor = toCssColor(game.homeColor, "var(--accent)");
    const awayColor = toCssColor(game.awayColor, "var(--chart-axis)");

    return (
      <div className="px-5 pb-4">
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/15">
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{ width: `${awayPct}%`, backgroundColor: awayColor }}
          />
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{ width: `${homePct}%`, backgroundColor: homeColor }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] font-medium tracking-wide">
          <span className="text-accent">
            {game.awayAbbr.toUpperCase()} {awayPct}%
          </span>
          <span className="text-accent">
            {game.homeAbbr.toUpperCase()} {homePct}%
          </span>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="px-5 pb-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted/15">
          <div className="h-full w-full shimmer-prediction" />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="h-3 w-14 rounded bg-muted/10 shimmer-prediction" />
          <div className="h-3 w-14 rounded bg-muted/10 shimmer-prediction" />
        </div>
      </div>
    );
  }

  return null;
}

export default function LandingPage() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const pageRef = useRef<HTMLDivElement | null>(null);
  const statsRef = useRef<HTMLElement | null>(null);
  const statsAnimatedRef = useRef(false);
  const statsFrameRef = useRef<number | null>(null);
  const boardLoadedRef = useRef(false);
  const [heroVisible, setHeroVisible] = useState(() => prefersReducedMotion());
  const [animatedStats, setAnimatedStats] = useState<number[]>(() =>
    prefersReducedMotion() ? STATS.map((stat) => stat.value) : STATS.map(() => 0)
  );
  const [boardGames, setBoardGames] = useState<ESPNGame[]>([]);
  const [boardMode, setBoardMode] = useState<BoardMode>("live");
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState("");
  const [boardUpdatedAt, setBoardUpdatedAt] = useState<Date | null>(null);
  const [predictionsByGame, setPredictionsByGame] = useState<Record<string, PredictionResult | null>>({});
  const [predictionLoadingIds, setPredictionLoadingIds] = useState<Set<string>>(new Set());

  const dashboardCta = ROUTES.DASHBOARD;
  const highlightsCta = ROUTES.HIGHLIGHTS;
  const showAuthenticatedNavbar = !!user || isAuthenticated;

  useEffect(() => {
    if (prefersReducedMotion()) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => setHeroVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) {
      return undefined;
    }

    const nodes = Array.from(page.querySelectorAll<HTMLElement>("[data-landing-reveal]"));
    if (!nodes.length) {
      return undefined;
    }

    if (prefersReducedMotion()) {
      nodes.forEach((node) => node.classList.add("is-visible"));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      {
        threshold: 0.18,
        rootMargin: "0px 0px -8% 0px",
      }
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = statsRef.current;
    if (!node) {
      return undefined;
    }

    if (prefersReducedMotion()) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || statsAnimatedRef.current) {
          return;
        }

        statsAnimatedRef.current = true;
        const startedAt = performance.now();
        const duration = 900;

        const tick = (now: number) => {
          const progress = Math.min(1, (now - startedAt) / duration);
          const eased = easeOutCubic(progress);

          setAnimatedStats(
            STATS.map((stat) => {
              const nextValue = Math.round(stat.value * eased);
              return progress >= 1 ? stat.value : nextValue;
            })
          );

          if (progress < 1) {
            statsFrameRef.current = window.requestAnimationFrame(tick);
            return;
          }

          statsFrameRef.current = null;
        };

        statsFrameRef.current = window.requestAnimationFrame(tick);
        observer.unobserve(node);
      },
      { threshold: 0.45 }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
      if (statsFrameRef.current !== null) {
        window.cancelAnimationFrame(statsFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    const fetchGamesForDate = async (dateKey: string) => {
      const response = await apiClient.get(API.ESPN_ALL, {
        params: { d: dateKey },
      });
      return normalizeBoardGames(response.data?.games);
    };

    const loadBoard = async () => {
      try {
        if (!boardLoadedRef.current) {
          setBoardLoading(true);
        }
        setBoardError("");
        const today = new Date();
        const dateKeys = Array.from({ length: BOARD_LOOKBACK_DAYS + 1 }, (_, index) =>
          formatCompactDate(shiftDate(today, -index))
        );
        const results = await Promise.allSettled(dateKeys.map((dateKey) => fetchGamesForDate(dateKey)));
        const gameSets = results.map((result) => (result.status === "fulfilled" ? result.value : []));

        if (!gameSets.some((games) => games.length)) {
          throw new Error("No board games returned");
        }

        const todayGames = dedupeBoardGames(gameSets[0] || []);
        const recentCandidates = dedupeBoardGames(gameSets.flat());
        const selection = selectBoardGames(todayGames, recentCandidates);

        if (cancelled) {
          return;
        }

        setBoardGames(selection.games);
        setBoardMode(selection.mode);
        setBoardUpdatedAt(new Date());
        setBoardLoading(false);
        boardLoadedRef.current = true;
      } catch {
        if (cancelled) {
          return;
        }

        setBoardError("Unable to load the live board right now.");
        setBoardGames([]);
        setBoardMode("empty");
        setBoardLoading(false);
        boardLoadedRef.current = true;
      }
    };

    void loadBoard();
    intervalId = window.setInterval(() => {
      void loadBoard();
    }, BOARD_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, []);

  useEffect(() => {
    const predictionGames = boardGames.filter((game) => supportsPredictions(game));
    const activeIds = new Set(predictionGames.map((game) => game.id));

    setPredictionsByGame((prev) => {
      const nextEntries = Object.entries(prev).filter(([gameId]) => activeIds.has(gameId));
      if (nextEntries.length === Object.keys(prev).length) {
        return prev;
      }
      return Object.fromEntries(nextEntries);
    });

    setPredictionLoadingIds((prev) => {
      if (prev.size === 0) {
        return prev;
      }

      let removedAny = false;
      const next = new Set<string>();
      prev.forEach((gameId) => {
        if (activeIds.has(gameId)) {
          next.add(gameId);
        } else {
          removedAny = true;
        }
      });

      return removedAny ? next : prev;
    });

    if (!predictionGames.length) {
      return undefined;
    }

    let cancelled = false;

    const fetchSinglePrediction = async (game: ESPNGame) => {
      try {
        const response = await apiClient.get(`${API.PREDICT}/${game.id}`, {
          params: { league: game.league },
          timeout: 6_000,
        });

        return {
          gameId: game.id,
          prediction: {
            gameId: String(response.data?.game_id || game.id),
            homeWinProb: Number(response.data?.home_win_prob || 0),
            awayWinProb: Number(response.data?.away_win_prob || 0),
            modelVersion: String(response.data?.model_version || ""),
          } satisfies PredictionResult,
        };
      } catch {
        return { gameId: game.id, prediction: buildFallbackPrediction(game) };
      }
    };

    const fetchPredictions = async () => {
      setPredictionLoadingIds((prev) => {
        const next = new Set(prev);
        predictionGames.forEach((game) => next.add(game.id));
        return next;
      });

      const unresolvedGames = new Map(predictionGames.map((game) => [game.id, game]));
      const nextPredictions: Record<string, PredictionResult | null> = {};

      try {
        const leagueMap = Object.fromEntries(predictionGames.map((game) => [game.id, game.league]));
        const response = await apiClient.post(
          API.PREDICT_BATCH,
          {
            game_ids: predictionGames.map((game) => game.id),
            leagues: leagueMap,
          },
          { timeout: 12_000 },
        );

        const batchPredictions = (response.data?.predictions || {}) as Record<string, PredictionApiPayload>;
        Object.entries(batchPredictions).forEach(([gameId, payload]) => {
          if (!payload) {
            return;
          }

          nextPredictions[gameId] = {
            gameId: String(payload.game_id || gameId),
            homeWinProb: Number(payload.home_win_prob || 0),
            awayWinProb: Number(payload.away_win_prob || 0),
            modelVersion: String(payload.model_version || ""),
          };
          unresolvedGames.delete(gameId);
        });
      } catch {
        // Fall back to the per-game endpoint for any unresolved board cards.
      }

      if (unresolvedGames.size) {
        const results = await Promise.allSettled(
          Array.from(unresolvedGames.values()).map((game) => fetchSinglePrediction(game)),
        );

        results.forEach((result) => {
          if (result.status !== "fulfilled") {
            return;
          }

          nextPredictions[result.value.gameId] = result.value.prediction;
        });
      }

      if (cancelled) {
        return;
      }

      if (Object.keys(nextPredictions).length) {
        setPredictionsByGame((prev) => ({ ...prev, ...nextPredictions }));
      }

      setPredictionLoadingIds((prev) => {
        if (prev.size === 0) {
          return prev;
        }

        const next = new Set(prev);
        predictionGames.forEach((game) => next.delete(game.id));
        return next;
      });
    };

    void fetchPredictions();

    return () => {
      cancelled = true;
    };
  }, [boardGames]);

  return (
    <div ref={pageRef} className="landing-page-shell min-h-screen w-full overflow-x-hidden bg-background text-foreground">
      {showAuthenticatedNavbar ? (
        <Navbar />
      ) : (
        <nav className="w-full border-b border-white/8 bg-background">
          <div className="flex w-full items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8 xl:px-10">
            <div className="min-w-0">
              <Logo size="md" linkTo={ROUTES.HOME} />
            </div>

            <div className="flex items-center justify-end gap-2.5 sm:gap-3">
              {isLoading ? (
                <>
                  <div className="h-9 w-16 skeleton-pulse" />
                  <div className="h-9 w-24 skeleton-pulse rounded-md" />
                </>
              ) : (
                <>
                  <Link
                    to={ROUTES.LOGIN}
                    className="px-2.5 py-2 text-sm text-foreground-base hover:text-foreground sm:px-4"
                  >
                    Sign In
                  </Link>
                  <Link
                    to={ROUTES.REGISTER}
                    className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-hover sm:px-4"
                  >
                    Get Started
                  </Link>
                </>
              )}
            </div>
          </div>
        </nav>
      )}

      <main className="w-full bg-background">
        <section id="live" className="border-b border-white/8 bg-background">
          <div className="grid w-full gap-12 px-6 py-14 md:gap-10 lg:grid-cols-[minmax(0,0.94fr)_minmax(38rem,1.06fr)] lg:items-start lg:px-10 lg:py-[4.5rem] xl:grid-cols-[minmax(28rem,0.92fr)_minmax(46rem,1.08fr)] xl:gap-16 xl:px-14 xl:py-20 2xl:grid-cols-[minmax(31rem,1fr)_minmax(52rem,1.12fr)] 2xl:gap-20 2xl:px-20">
            <div className="md:pt-3 lg:max-w-[42rem] lg:pr-8 xl:pr-10">
              <p
                className={`landing-hero-reveal text-[11px] font-semibold uppercase tracking-[0.28em] text-accent ${heroVisible ? "is-visible" : ""}`}
              >
                Five leagues / one home base
              </p>

              <h1
                className={`landing-hero-reveal mt-5 max-w-[10.2ch] pb-[0.08em] text-[3.85rem] font-semibold leading-[0.94] tracking-[-0.075em] text-foreground sm:text-[4.4rem] md:text-[4.8rem] lg:text-[5.45rem] xl:text-[6.1rem] 2xl:text-[6.75rem] ${heroVisible ? "is-visible" : ""}`}
                style={{ transitionDelay: "80ms", textWrap: "balance" }}
              >
                The whole <span className="inline-block pr-[0.04em] tracking-[-0.05em] text-white/25">sports</span> night.
              </h1>

              <p
                className={`landing-hero-reveal mt-5 max-w-[34rem] text-base leading-8 text-muted sm:text-[1.02rem] xl:max-w-[35rem] ${heroVisible ? "is-visible" : ""}`}
                style={{ transitionDelay: "160ms" }}
              >
                Live scores, saved-team focus, deeper game pages, standings, highlights, and prediction context all live inside one landing experience that stays readable at a glance.
              </p>

              <div
                className={`landing-hero-reveal mt-7 flex flex-wrap items-center gap-3 ${heroVisible ? "is-visible" : ""}`}
                style={{ transitionDelay: "240ms" }}
              >
                <Link
                  to={dashboardCta}
                  className="rounded-md bg-accent px-6 py-3 text-sm font-semibold text-white hover:bg-accent-hover"
                >
                  Open Dashboard
                </Link>
                <Link
                  to={highlightsCta}
                  className="rounded-md border border-white/12 px-6 py-3 text-sm font-medium text-foreground-base hover:border-white/20 hover:text-foreground"
                >
                  Open Highlights
                </Link>
              </div>

              <div
                className={`landing-hero-reveal mt-7 grid max-w-[38rem] grid-cols-2 gap-2.5 sm:grid-cols-3 ${heroVisible ? "is-visible" : ""}`}
                style={{ transitionDelay: "320ms" }}
              >
                {HERO_PILLS.map((pill) => (
                  <span
                    key={pill}
                    className="highlights-glass-chip inline-flex min-h-[3.1rem] items-center justify-center rounded-full px-4 py-2 text-center text-sm font-medium tracking-[0.01em] text-foreground-base/92"
                  >
                    {pill}
                  </span>
                ))}
              </div>
            </div>

            <div
              className={`landing-hero-reveal lg:justify-self-end ${heroVisible ? "is-visible" : ""}`}
              style={{ transitionDelay: "400ms" }}
            >
              <article className="w-full max-w-[56rem] overflow-hidden rounded-[1.1rem] border border-white/8 bg-surface">
                <div className="flex items-center justify-between border-b border-white/8 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[color:var(--danger-strong)] animate-pulse-live" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
                      {getBoardHeading(boardMode)}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
                    {formatBoardTimestamp(boardUpdatedAt)}
                  </span>
                </div>

                {getBoardBanner(boardMode, boardError) ? (
                  <div className="border-b border-white/8 px-6 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                    {getBoardBanner(boardMode, boardError)}
                  </div>
                ) : null}

                {boardLoading ? (
                  <div className="divide-y divide-white/8">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <section key={`board-loading-${index}`} className={index === 0 ? "bg-background/40" : undefined}>
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 px-6 py-5">
                          <div className="flex items-center gap-3">
                            <div className="h-11 w-11 skeleton-pulse" />
                            <div className="space-y-2">
                              <div className="h-3 w-24 skeleton-pulse" />
                              <div className="h-3 w-14 skeleton-pulse" />
                            </div>
                          </div>
                          <div className="min-w-[6.2rem] space-y-2 text-center">
                            <div className="mx-auto h-6 w-20 skeleton-pulse" />
                            <div className="mx-auto h-3 w-16 skeleton-pulse" />
                          </div>
                          <div className="flex items-center justify-end gap-3">
                            <div className="space-y-2 text-right">
                              <div className="ml-auto h-3 w-24 skeleton-pulse" />
                              <div className="ml-auto h-3 w-14 skeleton-pulse" />
                            </div>
                            <div className="h-11 w-11 skeleton-pulse" />
                          </div>
                        </div>
                        <div className="px-6 pb-4">
                          <div className="h-px bg-white/8" />
                          <div className="mt-3 h-3 w-40 skeleton-pulse" />
                        </div>
                      </section>
                    ))}
                  </div>
                ) : boardGames.length ? (
                  <div className="divide-y divide-white/8">
                    {boardGames.map((game, index) => (
                      <section key={game.id} className={index === 0 ? "bg-background/35" : undefined}>
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-4 px-6 py-5">
                          <div className="flex min-w-0 items-center gap-3">
                            <TeamBadge abbr={game.awayAbbr} logo={game.awayBadge} name={game.awayTeam} />
                            <div className="min-w-0">
                              <p className="truncate text-[0.96rem] font-semibold text-foreground">{game.awayTeam}</p>
                              <p className="text-xs text-muted">{game.league}</p>
                            </div>
                          </div>

                          <div className="min-w-[6.65rem] text-center">
                            <p className="text-[2rem] font-semibold tracking-[0.05em] text-foreground">
                              {getBoardScore(game)}
                            </p>
                            <p className={`mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${getBoardStatusTone(game.status)}`}>
                              {game.statusDetail || game.strTime || game.status}
                            </p>
                          </div>

                          <div className="flex min-w-0 items-center justify-end gap-3 text-right">
                            <div className="min-w-0">
                              <p className="truncate text-[0.96rem] font-semibold text-foreground">{game.homeTeam}</p>
                              <p className="text-xs text-muted">{getBoardDateLabel(game)}</p>
                            </div>
                            <TeamBadge abbr={game.homeAbbr} logo={game.homeBadge} name={game.homeTeam} />
                          </div>
                        </div>

                        <BoardPredictionLine
                          game={game}
                          prediction={predictionsByGame[game.id]}
                          isLoading={predictionLoadingIds.has(game.id)}
                        />

                        <div className="flex items-center justify-between gap-4 border-t border-white/8 px-6 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                          <span>{game.league}</span>
                          <span className="truncate text-right">{getBoardNote(game)}</span>
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="px-5 py-8 text-sm text-muted">
                    No scoreboard games are available right now.
                  </div>
                )}
              </article>
            </div>
          </div>
        </section>

        <section ref={statsRef} className="landing-paint-surface border-b border-white/8 bg-background">
          <div className="grid grid-cols-2 md:grid-cols-4">
            {STATS.map((stat, index) => (
              <div
                key={stat.label}
                className={`px-6 py-8 sm:px-8 sm:py-9 ${index < STATS.length - 1 ? "border-r border-white/8" : ""} ${index < 2 ? "border-b border-white/8 md:border-b-0" : ""}`}
              >
                <p className="text-[3.25rem] font-semibold leading-none tracking-[-0.06em] text-foreground sm:text-[4rem]">
                  <StatValue current={animatedStats[index]} suffix={"suffix" in stat ? stat.suffix : undefined} />
                </p>
                <p className="mt-3 max-w-[18ch] text-sm leading-6 text-muted">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="landing-paint-surface border-b border-white/8 bg-background">
          <div className="landing-paint-surface grid gap-px bg-white/8 lg:grid-cols-3">
            {FEATURE_CARDS.map((card, index) => (
              <article
                key={card.title}
                data-landing-reveal
                className="landing-paint-surface landing-section-reveal relative min-h-[18rem] bg-background px-6 py-9 sm:px-8"
                style={{ transitionDelay: `${index * 80}ms` }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
                  {card.eyebrow}
                </p>
                <h2 className="mt-5 max-w-[12ch] text-3xl font-semibold leading-[0.94] tracking-[-0.05em] text-foreground sm:text-[2.5rem]">
                  {card.title}
                </h2>
                <p className="mt-5 max-w-md text-sm leading-7 text-muted sm:text-base">
                  {card.body}
                </p>
                <span className="pointer-events-none absolute bottom-6 right-6 text-[4.8rem] font-semibold leading-none tracking-[-0.06em] text-white/[0.04] sm:text-[5.6rem]">
                  {card.numeral}
                </span>
              </article>
            ))}
          </div>
        </section>

        <section id="leagues" className="landing-paint-surface border-b border-white/8 bg-background">
          <div className="mx-auto max-w-7xl px-6 py-14">
            <p
              data-landing-reveal
              className="landing-section-reveal text-[11px] font-semibold uppercase tracking-[0.24em] text-muted"
            >
              League Coverage
            </p>

            <div className="mt-8 overflow-hidden border border-white/8">
              <div className="grid grid-cols-5 divide-x divide-white/8">
                {LEAGUES.map((league, index) => (
                  <article
                    key={league.id}
                    data-landing-reveal
                    className="landing-section-reveal flex min-h-[10rem] flex-col items-center justify-center px-2 py-6 text-center sm:min-h-[11rem] sm:px-4"
                    style={{ transitionDelay: `${index * 80}ms` }}
                  >
                    <LeagueBadge abbr={league.id} logo={league.logo} name={league.label} />
                    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-foreground-base sm:text-sm">
                      {league.label}
                    </p>
                    <p className="mt-1 px-1 text-[11px] leading-5 text-muted sm:text-xs">
                      {league.sport}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="why-sportsync" className="landing-paint-surface border-b border-white/8 bg-background">
          <div className="mx-auto grid max-w-7xl gap-10 px-6 py-16 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-12 lg:py-20">
            <div data-landing-reveal className="landing-section-reveal lg:pr-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
                Why SportSync
              </p>
              <h2 className="mt-5 max-w-[10ch] text-[3.35rem] font-semibold leading-[0.9] tracking-[-0.06em] text-foreground sm:text-[4.4rem]">
                Everything important feels closer.
              </h2>
              <p className="mt-6 max-w-xl text-base leading-8 text-muted">
                Quick checks first, then deeper context when the game starts to turn. That is the entire pitch: one cleaner front page, one stronger click into the matchup, and one product rhythm across every league we cover.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to={dashboardCta}
                  className="rounded-md bg-accent px-6 py-3 text-sm font-semibold text-white hover:bg-accent-hover"
                >
                  Open Dashboard
                </Link>
                <Link
                  to={highlightsCta}
                  className="rounded-md border border-white/12 px-6 py-3 text-sm font-medium text-foreground-base hover:border-white/20 hover:text-foreground"
                >
                  Open Highlights
                </Link>
              </div>
            </div>

            <div className="border border-white/8">
              {CHECKLIST.map((item, index) => (
                <div
                  key={item.title}
                  data-landing-reveal
                  className="landing-section-reveal grid gap-3 border-b border-white/8 px-5 py-5 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-5 sm:px-6"
                  style={{ transitionDelay: `${index * 80}ms` }}
                >
                  <span className="text-sm font-semibold uppercase tracking-[0.22em] text-accent">
                    {(index + 1).toString().padStart(2, "0")}
                  </span>
                  <div>
                    <p className="text-sm font-medium leading-6 text-foreground sm:text-base">
                      {item.title}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      {item.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
