import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FiCalendar, FiChevronDown, FiTrendingUp, FiUsers } from "react-icons/fi";
import apiClient from "../api/client";
import Footer from "../components/Footer";
import Navbar from "../components/Navbar";
import SafeAvatar from "../components/SafeAvatar";
import ScoreCard from "../components/ScoreCard";
import StatChart from "../components/StatChart";
import TeamFollowButton from "../components/TeamFollowButton";
import { API } from "../constants";
import type { Team } from "../types";

type TeamTab = "overview" | "schedule" | "roster" | "stats";

type TeamMini = {
  id?: string | null;
  externalId?: string | null;
  name: string;
  shortName?: string | null;
  logoUrl?: string | null;
  city?: string | null;
  record?: string | null;
  color?: string | null;
};

type TeamScheduleGame = {
  id: string;
  league: string;
  sport: string;
  scheduledAt: string;
  status: string;
  statusDetail?: string | null;
  homeTeam: TeamMini;
  awayTeam: TeamMini;
  homeScore: number;
  awayScore: number;
  venue?: string | null;
};

type TeamRosterPlayer = {
  id: string;
  name: string;
  shortName: string;
  headshot?: string | null;
  position?: string | null;
  jersey?: string | null;
  status?: string | null;
  facts: Array<{ label: string; value: string }>;
};

type TeamSeasonOption = {
  year: string;
  displayName: string;
  startDate?: string | null;
  endDate?: string | null;
};

type TeamDetailData = Team & {
  season: string;
  seasonLabel: string;
  seasonRecord?: string | null;
  seasons: TeamSeasonOption[];
  schedule: TeamScheduleGame[];
  roster: TeamRosterPlayer[];
};

type PredictionData = {
  homeWinProb: number;
  awayWinProb: number;
};

type PredictionCacheEntry = {
  fetchedAt: number;
  fingerprint: string;
  data: PredictionData | null;
};

const TEAM_DETAIL_PREDICTION_CACHE_STORAGE_KEY = "sportsync_team_detail_prediction_cache_v2";
const TEAM_DETAIL_QUERY_VERSION = "v3";

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
    // Ignore storage failures and keep rendering.
  }
}

function getInitials(name: string, fallback = "", limit = 2): string {
  const source = [name, fallback]
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
  if (!source) return "";

  const parts = source
    .replace(/[^A-Za-z0-9\s-]+/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);

  if (parts.length >= 2) {
    return parts
      .slice(0, limit)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("");
  }

  return source.replace(/[^A-Za-z0-9]+/g, "").slice(0, limit).toUpperCase();
}

function getPredictionCacheFingerprint(game: TeamScheduleGame): string {
  return [
    game.status,
    game.statusDetail ?? "",
    String(game.homeScore ?? 0),
    String(game.awayScore ?? 0),
    game.scheduledAt,
  ].join("|");
}

function getPredictionCacheTtlMs(game: TeamScheduleGame): number {
  if (game.status === "live") return 15000;
  if (game.status === "final") return 6 * 60 * 60 * 1000;
  return 15 * 60 * 1000;
}

function normalizeTeam(raw: Record<string, unknown>): Team {
  return {
    id: String(raw.id ?? ""),
    externalId: String(raw.external_id ?? raw.externalId ?? ""),
    name: String(raw.name ?? ""),
    shortName: String(raw.short_name ?? raw.shortName ?? ""),
    sport: String(raw.sport ?? raw.league ?? ""),
    league: String(raw.league ?? raw.sport ?? ""),
    logoUrl: String(raw.logo_url ?? raw.logoUrl ?? ""),
    city: String(raw.city ?? ""),
    record: raw.record ? String(raw.record) : null,
    color: raw.color ? String(raw.color) : null,
  };
}

function normalizeTeamMini(raw: Record<string, unknown>): TeamMini {
  return {
    id: raw.id ? String(raw.id) : null,
    externalId: raw.external_id ? String(raw.external_id) : null,
    name: String(raw.name ?? ""),
    shortName: raw.short_name ? String(raw.short_name) : null,
    logoUrl: raw.logo_url ? String(raw.logo_url) : null,
    city: raw.city ? String(raw.city) : null,
    record: raw.record ? String(raw.record) : null,
    color: raw.color ? String(raw.color) : null,
  };
}

function normalizeScheduleGame(raw: Record<string, unknown>): TeamScheduleGame {
  return {
    id: String(raw.id ?? ""),
    league: String(raw.league ?? ""),
    sport: String(raw.sport ?? raw.league ?? ""),
    scheduledAt: String(raw.scheduled_at ?? raw.scheduledAt ?? ""),
    status: String(raw.status ?? "upcoming"),
    statusDetail: raw.status_detail ? String(raw.status_detail) : null,
    homeTeam: normalizeTeamMini((raw.home_team as Record<string, unknown>) ?? {}),
    awayTeam: normalizeTeamMini((raw.away_team as Record<string, unknown>) ?? {}),
    homeScore: Number(raw.home_score ?? raw.homeScore ?? 0),
    awayScore: Number(raw.away_score ?? raw.awayScore ?? 0),
    venue: raw.venue ? String(raw.venue) : null,
  };
}

function normalizeRosterPlayer(raw: Record<string, unknown>): TeamRosterPlayer {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    shortName: String(raw.short_name ?? raw.shortName ?? raw.name ?? ""),
    headshot: raw.headshot ? String(raw.headshot) : null,
    position: raw.position ? String(raw.position) : null,
    jersey: raw.jersey ? String(raw.jersey) : null,
    status: raw.status ? String(raw.status) : null,
    facts: Array.isArray(raw.facts)
      ? raw.facts
          .map((fact) => ({
            label: String((fact as Record<string, unknown>).label ?? ""),
            value: String((fact as Record<string, unknown>).value ?? ""),
          }))
          .filter((fact) => fact.label && fact.value)
      : [],
  };
}

function normalizeSeasonOption(raw: Record<string, unknown>): TeamSeasonOption {
  const year = String(raw.year ?? "").trim();
  return {
    year,
    displayName: String(raw.display_name ?? raw.displayName ?? year).trim() || year,
    startDate: raw.start_date ? String(raw.start_date) : null,
    endDate: raw.end_date ? String(raw.end_date) : null,
  };
}

function normalizeTeamDetail(raw: Record<string, unknown>): TeamDetailData {
  return {
    ...normalizeTeam(raw),
    season: String(raw.season ?? ""),
    seasonLabel: String(raw.season_label ?? raw.seasonLabel ?? raw.season ?? ""),
    seasonRecord: raw.season_record ? String(raw.season_record) : raw.record ? String(raw.record) : null,
    seasons: Array.isArray(raw.seasons)
      ? raw.seasons
          .map((item) => normalizeSeasonOption(item as Record<string, unknown>))
          .filter((season) => season.year)
      : [],
    schedule: Array.isArray(raw.schedule)
      ? raw.schedule.map((item) => normalizeScheduleGame(item as Record<string, unknown>))
      : [],
    roster: Array.isArray(raw.roster)
      ? raw.roster.map((item) => normalizeRosterPlayer(item as Record<string, unknown>))
      : [],
  };
}

function normalizePrediction(raw: Record<string, unknown>): PredictionData {
  return {
    homeWinProb: Number(raw.home_win_prob ?? raw.homeWinProb ?? 0),
    awayWinProb: Number(raw.away_win_prob ?? raw.awayWinProb ?? 0),
  };
}

function chartLabelForLeague(league: string) {
  if (league === "MLB") return "Runs";
  if (league === "NHL" || league === "EPL") return "Goals";
  return "Points";
}

async function fetchTeamDetail(slug: string, season?: string): Promise<TeamDetailData> {
  const config = season ? { params: { season } } : undefined;

  try {
    const response = await apiClient.get(`${API.TEAMS}/slug/${slug}`, config);
    return normalizeTeamDetail(response.data as Record<string, unknown>);
  } catch {
    const response = await apiClient.get(`${API.TEAMS}/${slug}`, config);
    return normalizeTeamDetail(response.data as Record<string, unknown>);
  }
}

function formatGameDateLabel(value: string): string {
  const gameDate = new Date(value);
  if (Number.isNaN(gameDate.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(gameDate);
}

function slugifySegment(value?: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildGameSlug(game: TeamScheduleGame): string {
  return `${slugifySegment(game.league)}-${slugifySegment(game.awayTeam.name)}-${slugifySegment(game.homeTeam.name)}-${game.id}`;
}

function RecentPulseCard({ game }: { game: TeamScheduleGame }) {
  const playedOn = formatGameDateLabel(game.scheduledAt);
  const statusLabel = game.statusDetail?.trim() || "FINAL";

  return (
    <Link
      to={`/games/${buildGameSlug(game)}`}
      className="block rounded-[1.75rem] border border-muted/20 bg-background/55 px-6 py-5 transition-all hover:border-accent/30"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted">
            {game.league}
          </span>
          {playedOn ? (
            <span className="rounded-full border border-muted/15 bg-surface/80 px-2.5 py-1 text-[11px] font-medium text-muted">
              {playedOn}
            </span>
          ) : null}
        </div>
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
          {statusLabel}
        </span>
      </div>

      <div className="space-y-4">
        {[
          {
            team: game.awayTeam,
            score: game.awayScore,
            isWinning: game.awayScore > game.homeScore,
          },
          {
            team: game.homeTeam,
            score: game.homeScore,
            isWinning: game.homeScore > game.awayScore,
          },
        ].map(({ team, score, isWinning }) => (
          <div key={`${game.id}-${team.name}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
            <div className="flex min-w-0 items-center gap-3">
              {team.logoUrl ? (
                <img
                  src={team.logoUrl}
                  alt={team.name}
                  className="h-8 w-8 shrink-0 object-contain img-fade-in"
                  loading="lazy"
                />
              ) : (
                <div className="h-8 w-8 shrink-0 rounded-full bg-muted/20" />
              )}
              <div className="min-w-0">
                <p
                  className={`truncate text-[1.05rem] ${
                    isWinning ? "font-semibold text-foreground" : "font-medium text-foreground-base"
                  }`}
                >
                  {team.name}
                </p>
                {team.city ? (
                  <p className="truncate text-xs text-muted">{team.city}</p>
                ) : null}
              </div>
            </div>

            <span
              className={`text-[2rem] leading-none tabular-nums ${
                isWinning ? "font-semibold text-foreground" : "font-medium text-foreground-base"
              }`}
            >
              {score}
            </span>
          </div>
        ))}
      </div>
    </Link>
  );
}

function TeamSeasonSelector({
  seasonOptions,
  selectedSeason,
  activeSeason,
  seasonLabel,
  recordLabel,
  onSeasonChange,
}: {
  seasonOptions: TeamSeasonOption[];
  selectedSeason: string;
  activeSeason: string;
  seasonLabel: string;
  recordLabel?: string | null;
  onSeasonChange: (season: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  const effectiveSeason = selectedSeason || activeSeason || seasonOptions[0]?.year || "";
  const activeSeasonLabel =
    seasonOptions.find((option) => option.year === effectiveSeason)?.displayName ||
    seasonLabel ||
    effectiveSeason ||
    "Current";

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {recordLabel ? (
        <span className="rounded-full border border-accent/20 bg-accent/10 px-3.5 py-2 text-sm font-semibold text-accent">
          {recordLabel}
        </span>
      ) : null}

      {seasonOptions.length > 0 ? (
        <div ref={menuRef} className="relative" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            onClick={() => setIsOpen((current) => !current)}
            className="inline-flex min-w-[10.5rem] items-center justify-between gap-3 rounded-full border border-muted/15 bg-background/60 px-4 py-2 text-sm font-medium text-foreground outline-none transition-colors hover:border-accent/30 focus:border-accent/50"
          >
            <span>{activeSeasonLabel}</span>
            <FiChevronDown className={`h-4 w-4 text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
          </button>

          {isOpen ? (
            <div className="surface-elevated-flyout absolute right-0 top-[calc(100%+0.6rem)] z-20 w-52 overflow-hidden rounded-3xl border border-muted/15 bg-surface">
              <div className="max-h-72 overflow-y-auto py-2">
                {seasonOptions.map((seasonOption) => {
                  const isSelected = seasonOption.year === effectiveSeason;
                  return (
                    <button
                      key={seasonOption.year}
                      type="button"
                      onClick={() => {
                        onSeasonChange(seasonOption.year);
                        setIsOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors ${
                        isSelected ? "bg-accent text-foreground" : "text-foreground-base hover:bg-background/60"
                      }`}
                    >
                      <span>{seasonOption.displayName}</span>
                      {isSelected ? <span className="text-base leading-none">✓</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function TeamDetail() {
  const { id: slug } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TeamTab>("overview");
  const [selectedSeason, setSelectedSeason] = useState("");
  const predictionCacheRef = useRef<Record<string, PredictionCacheEntry>>(
    readSessionJson<Record<string, PredictionCacheEntry>>(TEAM_DETAIL_PREDICTION_CACHE_STORAGE_KEY, {}),
  );
  const [predictionByGameId, setPredictionByGameId] = useState<Record<string, PredictionData | null>>({});
  const [predictionsLoadingIds, setPredictionsLoadingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedSeason("");
  }, [slug]);

  const { data: baseTeam, isLoading: isBaseTeamLoading } = useQuery<TeamDetailData>({
    queryKey: [TEAM_DETAIL_QUERY_VERSION, "team", slug],
    queryFn: () => fetchTeamDetail(slug || ""),
    enabled: Boolean(slug),
    staleTime: 300000,
  });

  const {
    data: selectedSeasonTeam,
    isLoading: isSelectedSeasonLoading,
    isFetching: isSelectedSeasonFetching,
  } = useQuery<TeamDetailData>({
    queryKey: [TEAM_DETAIL_QUERY_VERSION, "teamSeason", slug, selectedSeason],
    queryFn: () => fetchTeamDetail(slug || "", selectedSeason),
    enabled: Boolean(slug && selectedSeason),
    staleTime: 300000,
  });

  const { data: savedTeams = [] } = useQuery<Team[]>({
    queryKey: ["savedTeams"],
    queryFn: async () => {
      const response = await apiClient.get(API.USER_TEAMS);
      return (response.data as Record<string, unknown>[]).map(normalizeTeam);
    },
    staleTime: 300000,
  });

  const team = baseTeam ?? selectedSeasonTeam ?? null;
  const seasonView = selectedSeason ? selectedSeasonTeam ?? null : baseTeam ?? null;
  const seasonOptions = baseTeam?.seasons || selectedSeasonTeam?.seasons || [];
  const teamId = team?.id;
  const activeSeason = selectedSeason || seasonView?.season || seasonOptions[0]?.year || "";
  const activeSeasonLabel =
    seasonOptions.find((option) => option.year === activeSeason)?.displayName ||
    seasonView?.seasonLabel ||
    activeSeason ||
    "Current Season";
  const activeSeasonRecord = selectedSeason
    ? seasonView?.seasonRecord || seasonView?.record || null
    : baseTeam?.seasonRecord || baseTeam?.record || null;
  const isSeasonContentLoading = Boolean(selectedSeason) && !seasonView && isSelectedSeasonLoading;
  const isSeasonContentRefreshing = Boolean(selectedSeason) && isSelectedSeasonFetching;

  const schedule = useMemo(() => {
    if (!seasonView) return [];
    return [...seasonView.schedule].sort(
      (left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime(),
    );
  }, [seasonView]);

  const recentResults = useMemo(
    () =>
      schedule
        .filter((game) => game.status === "final")
        .slice(-5)
        .reverse(),
    [schedule],
  );
  const upcomingGames = useMemo(
    () => {
      const now = Date.now();
      return schedule
        .filter((game) => {
          if (game.status === "final") {
            return false;
          }
          const gameTime = new Date(game.scheduledAt).getTime();
          return Number.isNaN(gameTime) ? true : gameTime >= now - 60_000;
        })
        .slice(0, 5);
    },
    [schedule],
  );

  const persistPredictionCache = useCallback(() => {
    writeSessionJson(TEAM_DETAIL_PREDICTION_CACHE_STORAGE_KEY, predictionCacheRef.current);
  }, []);

  const setPredictionCacheEntry = useCallback(
    (gameId: string, entry: PredictionCacheEntry) => {
      predictionCacheRef.current[gameId] = entry;
      persistPredictionCache();
    },
    [persistPredictionCache],
  );

  useEffect(() => {
    if (!team?.league || upcomingGames.length === 0) {
      setPredictionByGameId({});
      setPredictionsLoadingIds(new Set());
      return;
    }

    const predictionLeague = team.league;
    const now = Date.now();
    const warmPredictions: Record<string, PredictionData | null> = {};
    const gamesToFetch: TeamScheduleGame[] = [];

    for (const game of upcomingGames) {
      const cached = predictionCacheRef.current[game.id];
      const fingerprint = getPredictionCacheFingerprint(game);
      const cacheTtl = cached?.data ? getPredictionCacheTtlMs(game) : 30000;
      const sameSnapshot = cached && cached.fingerprint === fingerprint;
      if (sameSnapshot && cached.data) {
        warmPredictions[game.id] = cached.data;
      }
      if (!sameSnapshot || now - (cached?.fetchedAt ?? 0) >= cacheTtl) {
        gamesToFetch.push(game);
      }
    }

    setPredictionByGameId(warmPredictions);
    setPredictionsLoadingIds(new Set(gamesToFetch.map((game) => game.id)));

    if (!gamesToFetch.length) {
      return;
    }

    const controller = new AbortController();

    const clearLoadingIds = (gameIds: string[]) => {
      setPredictionsLoadingIds((prev) => {
        if (!prev.size) return prev;
        const next = new Set(prev);
        gameIds.forEach((gameId) => next.delete(gameId));
        return next;
      });
    };

    const PREDICTION_CHUNK_SIZE = 4;

    const fetchBatch = async (games: TeamScheduleGame[]) => {
      if (!games.length) {
        return new Set<string>();
      }
      try {
        const leagueMap: Record<string, string> = {};
        games.forEach((game) => {
          leagueMap[game.id] = predictionLeague;
        });
        const response = await apiClient.post(
          API.PREDICT_BATCH,
          {
            game_ids: games.map((game) => game.id),
            leagues: leagueMap,
          },
          {
            signal: controller.signal,
            timeout: 20_000,
          },
        );
        if (controller.signal.aborted) {
          return new Set<string>();
        }

        const predictions = response.data?.predictions || {};
        const fetchedGameIds = new Set<string>();
        const updates: Record<string, PredictionData | null> = {};

        for (const [gameId, data] of Object.entries(predictions)) {
          if (!data) continue;
          const game = games.find((entry) => entry.id === gameId);
          if (!game) continue;
          const prediction = normalizePrediction(data as Record<string, unknown>);
          updates[gameId] = prediction;
          setPredictionCacheEntry(gameId, {
            fetchedAt: Date.now(),
            fingerprint: getPredictionCacheFingerprint(game),
            data: prediction,
          });
          fetchedGameIds.add(gameId);
        }

        if (Object.keys(updates).length) {
          setPredictionByGameId((prev) => ({ ...prev, ...updates }));
        }

        return fetchedGameIds;
      } catch {
        return new Set<string>();
      }
    };

    const fetchQueued = async (games: TeamScheduleGame[]) => {
      for (let index = 0; index < games.length; index += PREDICTION_CHUNK_SIZE) {
        if (controller.signal.aborted) return;
        const chunk = games.slice(index, index + PREDICTION_CHUNK_SIZE);
        const fetchedIds = await fetchBatch(chunk);
        if (controller.signal.aborted) return;
        const remainingChunk = chunk.filter((game) => !fetchedIds.has(game.id));
        const results = await Promise.allSettled(
          remainingChunk.map(async (game) => {
            const response = await apiClient.get(`${API.PREDICT}/${game.id}`, {
              params: { league: predictionLeague },
              signal: controller.signal,
            });
            return {
              game,
              prediction: normalizePrediction(response.data as Record<string, unknown>),
            };
          }),
        );
        if (controller.signal.aborted) return;

        const updates: Record<string, PredictionData | null> = {};
        results.forEach((result, chunkIndex) => {
          const game = remainingChunk[chunkIndex];
          if (!game) return;
          if (result.status === "fulfilled") {
            updates[game.id] = result.value.prediction;
            setPredictionCacheEntry(game.id, {
              fetchedAt: Date.now(),
              fingerprint: getPredictionCacheFingerprint(game),
              data: result.value.prediction,
            });
          } else {
            setPredictionCacheEntry(game.id, {
              fetchedAt: Date.now(),
              fingerprint: getPredictionCacheFingerprint(game),
              data: null,
            });
          }
        });

        if (Object.keys(updates).length) {
          setPredictionByGameId((prev) => ({ ...prev, ...updates }));
        }

        clearLoadingIds(chunk.map((game) => game.id));
      }
    };

    void fetchQueued(gamesToFetch);

    return () => controller.abort();
  }, [setPredictionCacheEntry, team?.league, upcomingGames]);

  const chartGames = useMemo(() => schedule.filter((game) => game.status === "final").slice(-10), [schedule]);

  const scoringLabel = chartLabelForLeague(team?.league || "");
  const offenseTrend = useMemo(() => {
    if (!team || !seasonView) return [];
    return chartGames.map((game) => {
      const isHome = game.homeTeam.id === team.id;
      const scored = isHome ? game.homeScore : game.awayScore;
      const allowed = isHome ? game.awayScore : game.homeScore;
      const stamp = new Date(game.scheduledAt);
      const label = `${stamp.getMonth() + 1}/${stamp.getDate()}`;
      return { label, scored, allowed };
    });
  }, [chartGames, seasonView, team]);

  const averages = useMemo(() => {
    if (!offenseTrend.length) return [];
    const avgScored =
      offenseTrend.reduce((sum, game) => sum + Number(game.scored || 0), 0) / offenseTrend.length;
    const avgAllowed =
      offenseTrend.reduce((sum, game) => sum + Number(game.allowed || 0), 0) / offenseTrend.length;
    return [
      { label: "Offense", value: Number(avgScored.toFixed(1)) },
      { label: "Defense", value: Number(avgAllowed.toFixed(1)) },
    ];
  }, [offenseTrend]);

  const winTrend = useMemo(() => {
    if (!team || !seasonView) return [];
    return chartGames.map((game) => {
      const isHome = game.homeTeam.id === team.id;
      const scored = isHome ? game.homeScore : game.awayScore;
      const allowed = isHome ? game.awayScore : game.homeScore;
      const stamp = new Date(game.scheduledAt);
      return {
        label: `${stamp.getMonth() + 1}/${stamp.getDate()}`,
        wins: scored > allowed ? 1 : 0,
        won: scored > allowed,
        scored,
        allowed,
      };
    });
  }, [chartGames, seasonView, team]);

  const isFollowing = savedTeams.some((savedTeam) => savedTeam.id === teamId);
  const accent = team?.color?.startsWith("#")
    ? team.color
    : team?.color
      ? `#${team.color}`
      : "var(--accent)";

  if ((isBaseTeamLoading && !team) || !team) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="mx-auto max-w-7xl px-4 py-8">
          {/* Skeleton header */}
          <div className="overflow-hidden rounded-[2rem] border border-muted/15 bg-surface p-6">
            <div className="flex items-center gap-5">
              <div className="h-24 w-24 skeleton-pulse rounded-[1.75rem]" />
              <div className="space-y-3 flex-1">
                <div className="flex gap-2">
                  <div className="h-6 w-14 skeleton-pulse rounded-full" />
                  <div className="h-6 w-20 skeleton-pulse rounded-full" />
                </div>
                <div className="h-7 w-48 skeleton-pulse" />
                <div className="h-4 w-24 skeleton-pulse" />
              </div>
            </div>
            <div className="flex gap-2 mt-8">
              {[1,2,3,4].map(i => <div key={i} className="h-9 w-24 skeleton-pulse rounded-full" />)}
            </div>
          </div>
          {/* Skeleton content */}
          <div className="mt-8 grid gap-6 xl:grid-cols-2">
            {[1,2].map(i => (
              <div key={i} className="rounded-[2rem] border border-muted/15 bg-surface p-6">
                <div className="h-5 w-32 skeleton-pulse mb-4" />
                <div className="space-y-3">
                  {[1,2,3].map(j => <div key={j} className="h-20 skeleton-pulse rounded-xl" />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-8">
        <section className="surface-elevated-strong overflow-hidden rounded-[2rem] border border-muted/15 bg-surface">
          <div
            className="relative px-6 py-8"
            style={{
              background: `radial-gradient(circle at top right, color-mix(in srgb, ${accent} 13%, transparent) 0%, transparent 38%), linear-gradient(180deg, var(--highlight-feature-image-overlay) 0%, var(--panel-team-hero-bottom) 100%)`,
            }}
          >
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-5">
                <SafeAvatar
                  src={team.logoUrl}
                  alt={team.name}
                  className="flex h-24 w-24 items-center justify-center rounded-[1.75rem] border border-accent/20 bg-background/80 shadow-[inset_0_1px_0_var(--overlay-white-hairline)]"
                  imgClassName="h-16 w-16 object-contain"
                  loadingContent={<div className="h-16 w-16 animate-pulse rounded-2xl bg-accent/10" />}
                  fallback={
                    <span className="text-2xl font-semibold tracking-[0.2em] text-accent/70">
                      {(team.shortName || team.name).slice(0, 3).toUpperCase()}
                    </span>
                  }
                />

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-accent">
                      {team.league}
                    </span>
                    {team.record ? (
                      <span className="rounded-full border border-muted/15 bg-background/70 px-3 py-1 text-xs font-medium text-foreground-base">
                        {team.record}
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <h1 className="text-3xl font-semibold text-foreground">{team.name}</h1>
                    <p className="mt-1 text-sm text-muted">{team.city || "Team profile"}</p>
                  </div>
                </div>
              </div>

              <TeamFollowButton teamId={team.id} isFollowing={isFollowing} className="min-w-[124px] self-start lg:self-center" />
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              {([
                { id: "overview", label: "Overview" },
                { id: "schedule", label: "Schedule" },
                { id: "roster", label: "Roster" },
                { id: "stats", label: "Stats" },
              ] as Array<{ id: TeamTab; label: string }>).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? "surface-accent-choice-strong bg-accent text-foreground"
                      : "border border-muted/15 bg-background/70 text-muted hover:border-accent/30 hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <div key={activeTab} className="tab-content-enter">

        {activeTab === "overview" ? (
          <section className="mt-8 grid gap-6 xl:grid-cols-[1.18fr_0.82fr]">
            <div className="rounded-[2rem] border border-muted/15 bg-surface p-6">
              <div className="mb-4 flex items-center gap-3">
                <FiTrendingUp className="h-5 w-5 text-accent" />
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Recent Pulse</h2>
                  <p className="text-sm text-muted">The last five results in this team’s run.</p>
                </div>
              </div>

              {recentResults.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-muted/20 bg-background/60 px-6 py-10 text-center text-sm text-muted">
                  No completed games are available yet.
                </div>
              ) : (
                <div className="grid auto-rows-fr gap-4">
                  {recentResults.map((game) => (
                    <RecentPulseCard key={game.id} game={game} />
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[2rem] border border-muted/15 bg-surface p-6">
              <div className="mb-4 flex items-center gap-3">
                <FiCalendar className="h-5 w-5 text-accent" />
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Next Up</h2>
                  <p className="text-sm text-muted">
                    Upcoming matchups with model probabilities attached.
                  </p>
                </div>
              </div>

              {upcomingGames.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-muted/20 bg-background/60 px-6 py-10 text-center text-sm text-muted">
                  Upcoming games are not available from the source feed right now.
                </div>
              ) : (
                <div className="grid auto-rows-fr gap-4">
                  {upcomingGames.map((game) => (
                    <ScoreCard
                      key={game.id}
                      id={game.id}
                      homeTeam={{
                        name: game.homeTeam.name,
                        shortName: game.homeTeam.shortName ?? undefined,
                        logoUrl: game.homeTeam.logoUrl ?? undefined,
                        color: game.homeTeam.color ?? undefined,
                      }}
                      awayTeam={{
                        name: game.awayTeam.name,
                        shortName: game.awayTeam.shortName ?? undefined,
                        logoUrl: game.awayTeam.logoUrl ?? undefined,
                        color: game.awayTeam.color ?? undefined,
                      }}
                      homeScore={game.homeScore}
                      awayScore={game.awayScore}
                      status={game.status}
                      statusDetail={game.statusDetail ?? undefined}
                      league={game.league}
                      scheduledAt={game.scheduledAt}
                      prediction={predictionByGameId[game.id] ?? null}
                      predictionLoading={predictionsLoadingIds.has(game.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : null}

        {activeTab === "schedule" ? (
          <section className="mt-8 rounded-[2rem] border border-muted/15 bg-surface p-6">
            <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-center gap-3">
                <FiCalendar className="h-5 w-5 text-accent" />
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Full Season Schedule</h2>
                  <p className="text-sm text-muted">Everything we can currently see for {activeSeasonLabel}.</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                {isSeasonContentRefreshing ? (
                  <span className="text-xs font-medium text-muted">Updating season...</span>
                ) : null}
                <TeamSeasonSelector
                  seasonOptions={seasonOptions}
                  selectedSeason={selectedSeason}
                  activeSeason={activeSeason}
                  seasonLabel={activeSeasonLabel}
                  recordLabel={activeSeasonRecord}
                  onSeasonChange={setSelectedSeason}
                />
              </div>
            </div>

            {isSeasonContentLoading ? (
              <div className="grid gap-4 md:grid-cols-2">
                {[1, 2, 3, 4].map((item) => (
                  <div key={item} className="h-44 rounded-xl skeleton-pulse" />
                ))}
              </div>
            ) : schedule.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-muted/20 bg-background/60 px-6 py-10 text-center text-sm text-muted">
                Schedule data is not available yet.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {schedule.map((game) => (
                  <ScoreCard
                    key={game.id}
                    id={game.id}
                    homeTeam={{
                      name: game.homeTeam.name,
                      shortName: game.homeTeam.shortName ?? undefined,
                      logoUrl: game.homeTeam.logoUrl ?? undefined,
                      color: game.homeTeam.color ?? undefined,
                    }}
                    awayTeam={{
                      name: game.awayTeam.name,
                      shortName: game.awayTeam.shortName ?? undefined,
                      logoUrl: game.awayTeam.logoUrl ?? undefined,
                      color: game.awayTeam.color ?? undefined,
                    }}
                    homeScore={game.homeScore}
                    awayScore={game.awayScore}
                    status={game.status}
                    statusDetail={game.statusDetail ?? undefined}
                    league={game.league}
                    scheduledAt={game.scheduledAt}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}

        {activeTab === "roster" ? (
          <section className="mt-8 rounded-[2rem] border border-muted/15 bg-surface p-6">
            <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-center gap-3">
                <FiUsers className="h-5 w-5 text-accent" />
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Roster</h2>
                  <p className="text-sm text-muted">Key bio and sport-specific info for the selected squad.</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                {isSeasonContentRefreshing ? (
                  <span className="text-xs font-medium text-muted">Updating roster...</span>
                ) : null}
                <TeamSeasonSelector
                  seasonOptions={seasonOptions}
                  selectedSeason={selectedSeason}
                  activeSeason={activeSeason}
                  seasonLabel={activeSeasonLabel}
                  onSeasonChange={setSelectedSeason}
                />
              </div>
            </div>

            {isSeasonContentLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
                  <div key={item} className="overflow-hidden rounded-3xl border border-muted/15 bg-background/60">
                    <div className="h-36 skeleton-pulse" />
                    <div className="space-y-3 px-4 py-4">
                      <div className="mx-auto h-5 w-24 skeleton-pulse" />
                      <div className="mx-auto h-4 w-20 skeleton-pulse" />
                      <div className="mx-auto h-4 w-28 rounded-full skeleton-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : seasonView?.roster.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-muted/20 bg-background/60 px-6 py-10 text-center text-sm text-muted">
                Roster data is not available yet.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {seasonView?.roster.map((player, i) => (
                  <div
                    key={player.id || player.name}
                    className="rounded-3xl border border-muted/15 bg-background/60 overflow-hidden box-row-enter"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    {/* Large headshot on top */}
                    <div className="relative w-full h-36 bg-gradient-to-b from-accent/8 to-transparent flex items-center justify-center">
                      <SafeAvatar
                        src={player.headshot}
                        alt={player.name}
                        className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-accent/20 bg-surface shadow-lg"
                        imgClassName="h-28 w-28 rounded-full object-cover img-fade-in"
                        loadingContent={<div className="h-28 w-28 animate-pulse rounded-full bg-accent/10" />}
                        fallback={
                          <span className="text-2xl font-semibold tracking-[0.18em] text-accent/70">
                            {getInitials(player.name, player.shortName)}
                          </span>
                        }
                      />
                    </div>

                    {/* Name + position */}
                    <div className="px-4 pt-3 pb-2 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <h3 className="truncate text-base font-semibold text-foreground">{player.name}</h3>
                        {player.jersey ? (
                          <span className="rounded-full border border-muted/15 px-2 py-0.5 text-[11px] font-semibold text-muted">
                            #{player.jersey}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {[player.position, player.status].filter(Boolean).join(" • ") || "Active roster"}
                      </p>
                    </div>

                    {/* Stats facts */}
                    {player.facts.length > 0 ? (
                      <div className="px-4 pb-4 pt-1 flex flex-wrap justify-center gap-1.5">
                        {player.facts.map((fact) => (
                          <span
                            key={`${player.id}-${fact.label}`}
                            className="rounded-full border border-accent/15 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent"
                          >
                            {fact.label} {fact.value}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {activeTab === "stats" ? (
          <section className="mt-8 grid gap-6 xl:grid-cols-2">
            <StatChart
              title={`${scoringLabel} Trend`}
              subtitle={`Last ${offenseTrend.length || 10} completed games`}
              type="line"
              data={offenseTrend}
              xKey="label"
              series={[
                { dataKey: "scored", color: accent, name: `${scoringLabel} scored` },
                { dataKey: "allowed", color: "var(--chart-axis)", name: `${scoringLabel} allowed` },
              ]}
            />

            <StatChart
              title="Offense vs Defense"
              subtitle="Average production across the recent run"
              type="bar"
              data={averages}
              xKey="label"
              series={[{ dataKey: "value", color: accent, name: "Average" }]}
            />

            {/* Win/Loss Streak — custom visual instead of chart */}
            <div className="xl:col-span-2 rounded-3xl border border-muted/15 bg-surface p-5">
              <h3 className="text-base font-semibold text-foreground">Win/Loss Streak</h3>
              <p className="mt-1 text-sm text-muted mb-5">
                Last {winTrend.length} completed games — {winTrend.filter(g => g.won).length}W {winTrend.filter(g => !g.won).length}L
              </p>

              {winTrend.length === 0 ? (
                <p className="text-sm text-muted text-center py-6">No completed games yet.</p>
              ) : (
                <>
                  {/* Streak circles */}
                  <div className="flex items-center gap-2 flex-wrap justify-center">
                    {winTrend.map((g, i) => (
                      <div key={i} className="flex flex-col items-center gap-1 box-row-enter" style={{ animationDelay: `${i * 60}ms` }}>
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                            g.won
                              ? "surface-success-card"
                              : "surface-error-card"
                          }`}
                        >
                          {g.won ? "W" : "L"}
                        </div>
                        <span className="text-[10px] text-muted">{g.label}</span>
                        <span className="text-[10px] text-muted/60">{g.scored}-{g.allowed}</span>
                      </div>
                    ))}
                  </div>

                  {/* Streak bar */}
                  <div className="mt-5 h-2 rounded-full overflow-hidden bg-muted/10 flex">
                    {winTrend.map((g, i) => (
                      <div
                        key={i}
                        className="h-full transition-all duration-300"
                        style={{
                          width: `${100 / winTrend.length}%`,
                          backgroundColor: g.won ? "var(--success-strong)" : "var(--danger-strong)",
                          opacity: 0.7 + (i / winTrend.length) * 0.3,
                        }}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex justify-between text-[10px] text-muted">
                    <span>Oldest</span>
                    <span>Most Recent</span>
                  </div>
                </>
              )}
            </div>
          </section>
        ) : null}
        </div>
      </main>

      <Footer />
    </div>
  );
}
