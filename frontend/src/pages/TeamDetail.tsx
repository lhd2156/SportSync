import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { FiCalendar, FiTrendingUp, FiUsers } from "react-icons/fi";
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

interface TeamMini {
  id?: string | null;
  externalId?: string | null;
  name: string;
  shortName?: string | null;
  logoUrl?: string | null;
  city?: string | null;
  record?: string | null;
  color?: string | null;
}

interface TeamScheduleGame {
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
}

interface TeamRosterPlayer {
  id: string;
  name: string;
  shortName: string;
  headshot?: string | null;
  position?: string | null;
  jersey?: string | null;
  status?: string | null;
  facts: Array<{ label: string; value: string }>;
}

interface TeamDetailData extends Team {
  schedule: TeamScheduleGame[];
  roster: TeamRosterPlayer[];
}

interface PredictionData {
  homeWinProb: number;
  awayWinProb: number;
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

function normalizeTeamDetail(raw: Record<string, unknown>): TeamDetailData {
  return {
    ...normalizeTeam(raw),
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

export default function TeamDetail() {
  const { id: slug } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TeamTab>("overview");

  const { data: team, isLoading } = useQuery<TeamDetailData>({
    queryKey: ["team", slug],
    queryFn: async () => {
      // Try slug-based lookup first, fall back to UUID
      try {
        const response = await apiClient.get(`${API.TEAMS}/slug/${slug}`);
        return normalizeTeamDetail(response.data as Record<string, unknown>);
      } catch {
        // Fall back to UUID lookup for backward compatibility
        const response = await apiClient.get(`${API.TEAMS}/${slug}`);
        return normalizeTeamDetail(response.data as Record<string, unknown>);
      }
    },
    enabled: Boolean(slug),
    staleTime: 300000,
  });

  const { data: savedTeams = [] } = useQuery<Team[]>({
    queryKey: ["savedTeams"],
    queryFn: async () => {
      const response = await apiClient.get(API.USER_TEAMS);
      return (response.data as Record<string, unknown>[]).map(normalizeTeam);
    },
  });

  const teamId = team?.id;

  const schedule = useMemo(() => {
    if (!team) return [];
    return [...team.schedule].sort(
      (left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime(),
    );
  }, [team]);

  const now = Date.now();
  const recentResults = useMemo(
    () =>
      schedule
        .filter((game) => game.status === "final")
        .slice(-5)
        .reverse(),
    [schedule],
  );
  const upcomingGames = useMemo(
    () =>
      schedule
        .filter((game) => {
          if (game.status === "final") {
            return false;
          }
          const gameTime = new Date(game.scheduledAt).getTime();
          return Number.isNaN(gameTime) ? true : gameTime >= now - 60_000;
        })
        .slice(0, 5),
    [now, schedule],
  );

  const predictionQueries = useQueries({
    queries: upcomingGames.map((game) => ({
      queryKey: ["prediction", game.id, team?.league],
      queryFn: async () => {
        const response = await apiClient.get(`${API.PREDICT}/${game.id}`, {
          params: { league: team?.league },
        });
        return normalizePrediction(response.data as Record<string, unknown>);
      },
      enabled: Boolean(team?.league && game.id),
      staleTime: 60000,
    })),
  });

  const predictionByGameId = useMemo(() => {
    const mapped = new Map<string, PredictionData>();
    upcomingGames.forEach((game, index) => {
      const prediction = predictionQueries[index]?.data;
      if (prediction) {
        mapped.set(game.id, prediction);
      }
    });
    return mapped;
  }, [predictionQueries, upcomingGames]);

  const chartGames = useMemo(
    () => schedule.filter((game) => game.status === "final").slice(-10),
    [schedule],
  );

  const scoringLabel = chartLabelForLeague(team?.league || "");
  const offenseTrend = useMemo(() => {
    if (!team) return [];
    return chartGames.map((game) => {
      const isHome = game.homeTeam.id === team.id;
      const scored = isHome ? game.homeScore : game.awayScore;
      const allowed = isHome ? game.awayScore : game.homeScore;
      const stamp = new Date(game.scheduledAt);
      const label = `${stamp.getMonth() + 1}/${stamp.getDate()}`;
      return { label, scored, allowed };
    });
  }, [chartGames, team]);

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
    if (!team) return [];
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
  }, [chartGames, team]);

  const isFollowing = savedTeams.some((savedTeam) => savedTeam.id === teamId);
  const accent = team?.color?.startsWith("#")
    ? team.color
    : team?.color
      ? `#${team.color}`
      : "#2E8EFF";

  if (isLoading || !team) {
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
        <section className="overflow-hidden rounded-[2rem] border border-muted/15 bg-surface shadow-[0_24px_64px_rgba(5,10,25,0.24)]">
          <div
            className="relative px-6 py-8"
            style={{
              background: `radial-gradient(circle at top right, ${accent}22 0%, rgba(10,14,30,0) 38%), linear-gradient(180deg, rgba(11,17,32,0.96) 0%, rgba(13,19,37,0.92) 100%)`,
            }}
          >
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-5">
                <SafeAvatar
                  src={team.logoUrl}
                  alt={team.name}
                  className="flex h-24 w-24 items-center justify-center rounded-[1.75rem] border border-accent/20 bg-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
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
                      ? "bg-accent text-foreground shadow-[0_14px_30px_rgba(46,142,255,0.18)]"
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
          <section className="mt-8 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
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
                <div className="grid gap-4">
                  {recentResults.map((game) => (
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
                <div className="grid gap-4">
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
                      prediction={predictionByGameId.get(game.id) ?? null}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : null}

        {activeTab === "schedule" ? (
          <section className="mt-8 rounded-[2rem] border border-muted/15 bg-surface p-6">
            <div className="mb-4 flex items-center gap-3">
              <FiCalendar className="h-5 w-5 text-accent" />
              <div>
                <h2 className="text-xl font-semibold text-foreground">Full Season Schedule</h2>
                <p className="text-sm text-muted">Everything we can currently see for this team’s season path.</p>
              </div>
            </div>

            {schedule.length === 0 ? (
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
            <div className="mb-4 flex items-center gap-3">
              <FiUsers className="h-5 w-5 text-accent" />
              <div>
                <h2 className="text-xl font-semibold text-foreground">Roster</h2>
                <p className="text-sm text-muted">Key bio and sport-specific info for the current squad.</p>
              </div>
            </div>

            {team.roster.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-muted/20 bg-background/60 px-6 py-10 text-center text-sm text-muted">
                Roster data is not available yet.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {team.roster.map((player, i) => (
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
                            {(player.shortName || player.name).slice(0, 2).toUpperCase()}
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
                { dataKey: "allowed", color: "#94A3B8", name: `${scoringLabel} allowed` },
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
                              ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                              : "bg-red-500/20 border-red-500/50 text-red-400"
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
                          backgroundColor: g.won ? "#10b981" : "#ef4444",
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
