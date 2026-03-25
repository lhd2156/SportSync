import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import apiClient from "../api/client";
import { SUPPORTED_SPORTS } from "../constants";
import type {
  SavedStandingTeam,
  StandingsEntry,
  StandingsGroup,
  StandingsResponse,
} from "../types";

const LEAGUE_LOGOS: Record<string, string> = {
  NFL: "https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png",
  NBA: "https://a.espncdn.com/i/teamlogos/leagues/500/nba.png",
  MLB: "https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png",
  NHL: "https://a.espncdn.com/i/teamlogos/leagues/500/nhl.png",
  EPL: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png",
};

const STANDINGS_CACHE_KEY = "sportsync_standings_cache_v5";
const SAVED_TEAMS_CACHE_KEY = "sportsync_saved_team_directory_v1";
const MY_TEAM_BADGE_CLASS = "inline-flex items-center rounded-full border border-[color:var(--warning-border)] bg-[color:var(--warning-fill)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[color:var(--gold-accent)]";
const MY_TEAM_ROW_BACKGROUND = "color-mix(in srgb, var(--gold-accent) 16%, transparent)";

type LeagueId = (typeof SUPPORTED_SPORTS)[number]["id"];
const LEAGUE_IDS = SUPPORTED_SPORTS.map((sport) => sport.id);

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
    // Ignore storage issues and keep the page interactive.
  }
}

function normalizeTeamMatchValue(value: string | undefined | null): string {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSavedStandingLeague(value: string | undefined | null): string {
  const normalized = (value || "").trim().toUpperCase();
  if (normalized === "ENGLISH PREMIER LEAGUE") return "EPL";
  return normalized;
}

function isSavedStandingTeam(
  entry: StandingsEntry,
  league: LeagueId,
  savedTeams: SavedStandingTeam[],
): boolean {
  const teamName = normalizeTeamMatchValue(entry.team.name);
  const teamShortName = normalizeTeamMatchValue(entry.team.short_name);
  const cityAndName = normalizeTeamMatchValue(`${entry.team.city} ${entry.team.name}`);
  const normalizedLeague = normalizeSavedStandingLeague(league);

  return savedTeams.some((savedTeam) => {
    const savedLeague = normalizeSavedStandingLeague(savedTeam.league || savedTeam.sport);
    if (savedLeague && savedLeague !== normalizedLeague) {
      return false;
    }

    const savedFullName = normalizeTeamMatchValue(savedTeam.name);
    const savedShortName = normalizeTeamMatchValue(savedTeam.shortName);
    const savedCityAndName = normalizeTeamMatchValue(`${savedTeam.city} ${savedTeam.name}`);

    return (
      (!!savedFullName && (
        teamName === savedFullName
        || teamShortName === savedFullName
        || cityAndName === savedFullName
        || teamName.includes(savedFullName)
        || cityAndName.includes(savedFullName)
      ))
      || (!!savedShortName && (
        teamShortName === savedShortName
        || teamName === savedShortName
      ))
      || (!!savedCityAndName && cityAndName === savedCityAndName)
    );
  });
}

function ChevronIcon({ open = false }: { open?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-300 ${open ? "rotate-0" : "-rotate-90"}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M7 4h10v4a5 5 0 0 1-10 0V4Z"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M17 5h3v2a4 4 0 0 1-4 4h-1" />
      <path d="M7 5H4v2a4 4 0 0 0 4 4h1" />
      <path d="M9 4.5h6" opacity="0.7" />
    </svg>
  );
}

function getColumnsForLeague(league: LeagueId) {
  switch (league) {
    case "NFL":
      return [
        { key: "wins", label: "W" },
        { key: "losses", label: "L" },
        { key: "ties", label: "T" },
        { key: "pct", label: "Pct" },
        { key: "gb", label: "GB" },
        { key: "conference", label: "Conf" },
        { key: "home", label: "Home" },
        { key: "away", label: "Away" },
        { key: "streak", label: "Strk" },
      ] as const;
    case "NBA":
      return [
        { key: "wins", label: "W" },
        { key: "losses", label: "L" },
        { key: "pct", label: "Pct" },
        { key: "gb", label: "GB" },
        { key: "conference", label: "Conf" },
        { key: "home", label: "Home" },
        { key: "away", label: "Away" },
        { key: "last_ten", label: "L10" },
        { key: "streak", label: "Strk" },
      ] as const;
    case "MLB":
      return [
        { key: "wins", label: "W" },
        { key: "losses", label: "L" },
        { key: "pct", label: "Pct" },
        { key: "gb", label: "GB" },
        { key: "home", label: "Home" },
        { key: "away", label: "Away" },
        { key: "division", label: "Div" },
        { key: "last_ten", label: "L10" },
        { key: "streak", label: "Strk" },
      ] as const;
    case "NHL":
      return [
        { key: "wins", label: "W" },
        { key: "losses", label: "L" },
        { key: "otl", label: "OTL" },
        { key: "points", label: "Pts" },
        { key: "gb", label: "GB" },
        { key: "home", label: "Home" },
        { key: "away", label: "Away" },
        { key: "last_ten", label: "L10" },
        { key: "streak", label: "Strk" },
      ] as const;
    case "EPL":
      return [
        { key: "wins", label: "W" },
        { key: "ties", label: "D" },
        { key: "losses", label: "L" },
        { key: "diff", label: "GD" },
        { key: "points", label: "Pts" },
      ] as const;
    default:
      return [
        { key: "wins", label: "W" },
        { key: "losses", label: "L" },
        { key: "pct", label: "Pct" },
      ] as const;
  }
}

function getColumnSizingForLeague(league: LeagueId, columnCount: number) {
  const sizing = (() => {
    switch (league) {
      case "NFL":
      case "NBA":
      case "MLB":
      case "NHL":
        return { teamColumnRem: 17.5, statColumnRem: 4.75 };
      case "EPL":
        return { teamColumnRem: 18, statColumnRem: 4.5 };
      default:
        return { teamColumnRem: 17, statColumnRem: 4.5 };
    }
  })();

  return {
    ...sizing,
    tableMinWidthRem: sizing.teamColumnRem + (columnCount * sizing.statColumnRem),
  };
}

function StandingsTable({
  league,
  group,
  savedTeams,
  seasonLabel,
}: {
  league: LeagueId;
  group: StandingsGroup;
  savedTeams: SavedStandingTeam[];
  seasonLabel: string;
}) {
  const columns = getColumnsForLeague(league);
  const { teamColumnRem, statColumnRem, tableMinWidthRem } = getColumnSizingForLeague(league, columns.length);

  return (
    <div className="surface-elevated-soft overflow-hidden rounded-[1.75rem] border border-muted/15 bg-surface">
      <div className="border-b border-muted/15 px-5 py-4">
        <h2 className="text-xl font-semibold text-foreground">{group.name}</h2>
      </div>

      <div className="overflow-x-auto">
        <table
          className="table-fixed"
          style={{ width: `max(100%, ${tableMinWidthRem}rem)` }}
        >
          <colgroup>
            <col style={{ width: `${teamColumnRem}rem` }} />
            {columns.map((column) => (
              <col key={column.key} style={{ width: `${statColumnRem}rem` }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-muted/10 bg-surface/90 text-left text-sm text-muted">
              <th className="sticky left-0 z-10 bg-surface/90 px-5 py-3 font-medium text-muted">Team</th>
              {columns.map((column) => (
                <th key={column.key} className="whitespace-nowrap px-3 py-3 text-right font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.entries.map((entry, idx) => {
              const displayRank = entry.rank && entry.rank !== "0" ? entry.rank : String(idx + 1);
              const isMyTeam = isSavedStandingTeam(entry, league, savedTeams);
              const myTeamCellStyle = isMyTeam ? { backgroundColor: MY_TEAM_ROW_BACKGROUND } : undefined;

              return (
                <tr
                  key={`${group.id}-${entry.team.id}-${entry.rank}`}
                  className="border-b border-muted/10 last:border-b-0"
                >
                  <td
                    className={`sticky left-0 z-10 px-5 py-4 ${
                      isMyTeam
                        ? ""
                        : "bg-surface"
                    }`}
                    style={myTeamCellStyle}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-7 text-right text-2xl font-semibold text-muted/85">{displayRank}</div>
                      {entry.team.logo_url ? (
                        <img src={entry.team.logo_url} alt={entry.team.name} className="h-9 w-9 object-contain" />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-muted/15" />
                      )}
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2 text-lg font-semibold text-foreground">
                          <span className="truncate">{entry.team.short_name || entry.team.name}</span>
                          {isMyTeam ? (
                            <span className={MY_TEAM_BADGE_CLASS}>
                              My Team
                            </span>
                          ) : null}
                          {entry.is_champion ? (
                            <span
                              className="inline-flex h-[18px] w-[18px] flex-none translate-y-px items-center justify-center text-[color:var(--gold-accent)]"
                              title={`${seasonLabel || league} champion`}
                              aria-label={`${entry.team.name} won ${seasonLabel || league}`}
                            >
                              <TrophyIcon />
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-sm text-muted">{entry.record || entry.team.name}</div>
                      </div>
                    </div>
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className="whitespace-nowrap px-3 py-4 text-right text-lg font-medium text-foreground-base"
                      style={myTeamCellStyle}
                    >
                      {entry.stats[column.key as keyof StandingsEntry["stats"]] || "-"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeagueStandingsSection({
  league,
  data,
  loading = false,
  savedTeams = [],
  selectedSeason = "",
  onSeasonChange,
  isFocusedView = false,
}: {
  league: LeagueId;
  data: StandingsResponse | undefined;
  loading?: boolean;
  savedTeams?: SavedStandingTeam[];
  selectedSeason?: string;
  onSeasonChange?: (season: string) => void;
  isFocusedView?: boolean;
}) {
  const [activeGroupId, setActiveGroupId] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const [isSeasonMenuOpen, setIsSeasonMenuOpen] = useState(false);
  const seasonMenuRef = useRef<HTMLDivElement | null>(null);
  const defaultGroupId = data?.groups?.[0]?.id ?? "";
  const resolvedActiveGroupId = data?.groups?.some((group) => group.id === activeGroupId)
    ? activeGroupId
    : defaultGroupId;

  useEffect(() => {
    if (!isSeasonMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!seasonMenuRef.current?.contains(event.target as Node)) {
        setIsSeasonMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isSeasonMenuOpen]);

  const activeGroup = useMemo(
    () => data?.groups.find((group) => group.id === resolvedActiveGroupId) ?? data?.groups?.[0],
    [data, resolvedActiveGroupId],
  );
  const seasonOptions = data?.seasons ?? [];
  const effectiveSeason = selectedSeason || seasonOptions[0]?.year || "";
  const activeSeasonLabel =
    seasonOptions.find((season) => season.year === effectiveSeason)?.display_name ||
    data?.season ||
    `${league} Standings`;
  const sectionRenderStyle = isFocusedView
    ? undefined
    : {
        contentVisibility: "auto" as const,
        containIntrinsicSize: "1100px",
      };

  if (loading && !data?.groups?.length) {
    return (
      <section
        className="space-y-4 rounded-[1.9rem] border border-muted/15 bg-background/30 p-1"
        style={sectionRenderStyle}
      >
        <div className="rounded-[1.75rem] border border-muted/15 bg-surface px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {LEAGUE_LOGOS[league] && <img src={LEAGUE_LOGOS[league]} alt={league} className="h-5 w-5 object-contain" />}
              <div className="h-3 w-14 rounded shimmer-prediction" />
            </div>
            <div className="h-10 w-40 rounded-full shimmer-prediction" />
          </div>
          <div className="mt-4 h-8 w-56 rounded shimmer-prediction" />
        </div>
        <div className="overflow-hidden rounded-[1.75rem] border border-muted/15 bg-surface">
          <div className="border-b border-muted/15 px-5 py-4">
            <div className="h-5 w-48 rounded shimmer-prediction" />
          </div>
          <div className="space-y-4 px-5 py-4">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div key={idx} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-4 w-6 rounded shimmer-prediction" />
                  <div className="h-8 w-8 rounded-full shimmer-prediction" />
                  <div className="h-4 w-32 rounded shimmer-prediction" />
                </div>
                <div className="flex gap-4">
                  {Array.from({ length: 5 }).map((__, columnIdx) => (
                    <div key={columnIdx} className="h-4 w-10 rounded shimmer-prediction" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (!data?.groups?.length) {
    return (
    <section
      className="rounded-[1.75rem] border border-muted/15 bg-surface px-6 py-10"
      style={sectionRenderStyle}
    >
        <p className="text-xs uppercase tracking-[0.28em] text-accent">{league}</p>
        <h2 className="mt-2 text-2xl font-semibold text-foreground">Standings unavailable</h2>
      </section>
    );
  }

  return (
    <section
      className="space-y-4 rounded-[1.9rem] border border-muted/15 bg-background/30 p-1"
      style={sectionRenderStyle}
    >
      <div className="rounded-[1.75rem] border border-muted/15 bg-surface px-6 py-5">
        <div className="group">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setIsOpen((current) => !current)}
              className="min-w-0 flex-1 cursor-pointer text-left"
            >
              <div className="flex items-center gap-2">
                {LEAGUE_LOGOS[league] && <img src={LEAGUE_LOGOS[league]} alt={league} className="h-5 w-5 object-contain" />}
                <p className="text-xs uppercase tracking-[0.28em] text-accent">{league}</p>
              </div>
              <div className="mt-3">
                <h2 className="text-2xl font-semibold text-foreground">{activeSeasonLabel}</h2>
                <p className="mt-1 text-sm text-muted">
                  Browse the full {league} table for the selected season.
                </p>
              </div>
            </button>
            <div className="flex items-center gap-3">
              {seasonOptions.length > 0 && onSeasonChange ? (
                <div
                  ref={seasonMenuRef}
                  className="relative"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => setIsSeasonMenuOpen((current) => !current)}
                    className="inline-flex min-w-[9rem] items-center justify-between gap-3 rounded-full border border-muted/15 bg-background/40 px-4 py-2 text-sm font-medium text-foreground outline-none transition-colors hover:border-accent/30 focus:border-accent/50"
                  >
                    <span>{activeSeasonLabel}</span>
                    <span className={`text-muted transition-transform duration-200 ${isSeasonMenuOpen ? "rotate-180" : ""}`}>
                      <ChevronIcon open />
                    </span>
                  </button>

                  {isSeasonMenuOpen ? (
                    <div className="surface-elevated-flyout absolute right-0 top-[calc(100%+0.6rem)] z-20 w-48 overflow-hidden rounded-3xl border border-muted/15 bg-surface">
                      <div className="max-h-72 overflow-y-auto py-2">
                        {seasonOptions.map((season) => {
                          const isSelected = season.year === effectiveSeason;
                          return (
                            <button
                              key={season.year}
                              type="button"
                              onClick={() => {
                                onSeasonChange(season.year);
                                setIsSeasonMenuOpen(false);
                              }}
                              className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors ${
                                isSelected
                                  ? "bg-accent text-foreground"
                                  : "text-foreground-base hover:bg-background/60"
                              }`}
                            >
                              <span>{season.display_name}</span>
                              {isSelected ? (<span className="inline-block h-2.5 w-2.5 rounded-full bg-current" aria-hidden="true" />) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setIsOpen((current) => !current)}
                className="text-muted/50 transition-colors hover:text-foreground"
                aria-label={isOpen ? `Collapse ${league} standings` : `Expand ${league} standings`}
              >
                <ChevronIcon open={isOpen} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {isOpen ? (
        <div className="rounded-[1.75rem] border border-muted/15 bg-surface px-6 py-5">
          <div className="flex flex-wrap gap-2">
            {data.groups.map((group) => {
              const isActive = activeGroup?.id === group.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setActiveGroupId(group.id)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                    isActive
                      ? "surface-accent-choice bg-accent text-foreground"
                      : "border border-muted/15 text-muted hover:border-accent/30 hover:text-foreground"
                  }`}
                >
                  {group.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {isOpen && activeGroup ? (
        <StandingsTable
          league={league}
          group={activeGroup}
          savedTeams={savedTeams}
          seasonLabel={activeSeasonLabel}
        />
      ) : null}
    </section>
  );
}

export default function StandingsPage() {
  const [activeLeague, setActiveLeague] = useState<LeagueId | "ALL">("ALL");
  const [selectedSeasonByLeague, setSelectedSeasonByLeague] = useState<Partial<Record<LeagueId, string>>>({});
  const [allViewResetVersion, setAllViewResetVersion] = useState(0);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  const standingsCache = useMemo(
    () => readSessionJson<Record<string, StandingsResponse>>(STANDINGS_CACHE_KEY, {}),
    [],
  );
  const cachedSavedTeams = useMemo(
    () => readSessionJson<Record<string, unknown>[]>(SAVED_TEAMS_CACHE_KEY, []),
    [],
  );
  const visibleLeagues = useMemo(
    () => (activeLeague === "ALL" ? LEAGUE_IDS : [activeLeague]),
    [activeLeague],
  );

  const { data: rawSavedTeams = [] } = useQuery<Record<string, unknown>[]>({
    queryKey: ["savedTeams"],
    queryFn: async () => {
      const response = await apiClient.get("/api/user/teams");
      return response.data;
    },
    staleTime: 600_000,
    initialData: cachedSavedTeams.length ? cachedSavedTeams : undefined,
    refetchOnWindowFocus: false,
  });

  const savedTeams = useMemo<SavedStandingTeam[]>(
    () =>
      rawSavedTeams
        .map((team) => ({
          name: String(team["name"] ?? "").trim(),
          shortName: String(team["short_name"] ?? "").trim(),
          city: String(team["city"] ?? "").trim(),
          league: String(team["league"] ?? "").trim(),
          sport: String(team["sport"] ?? "").trim(),
        }))
        .filter((team) => team.name || team.shortName),
    [rawSavedTeams],
  );

  const standingsQueries = useQueries({
    queries: visibleLeagues.map((league) => {
      const selectedSeason = selectedSeasonByLeague[league];
      const cacheKey = `${league}:${selectedSeason || "current"}`;

      return {
        queryKey: [STANDINGS_CACHE_KEY, "standings", league, selectedSeason || "current"],
        queryFn: async (): Promise<StandingsResponse> => {
          const response = await apiClient.get("/api/sports/espn/standings", {
            params: selectedSeason ? { league, season: selectedSeason } : { league },
          });
          return response.data as StandingsResponse;
        },
        staleTime: 900_000,
        gcTime: 1_800_000,
        initialData: standingsCache[cacheKey],
        refetchOnWindowFocus: false,
        refetchOnMount: false,
      };
    }),
  });

  const standingsByLeague = useMemo(() => {
    const next = new Map<LeagueId, StandingsResponse | undefined>();
    visibleLeagues.forEach((league, index) => {
      next.set(league, standingsQueries[index]?.data);
    });
    return next;
  }, [standingsQueries, visibleLeagues]);

  useEffect(() => {
    writeSessionJson(SAVED_TEAMS_CACHE_KEY, rawSavedTeams);
  }, [rawSavedTeams]);

  const handleLeagueChange = (nextLeague: LeagueId | "ALL") => {
    setActiveLeague((currentLeague) => {
      if (nextLeague === "ALL" && currentLeague !== "ALL") {
        setAllViewResetVersion((current) => current + 1);
      }
      return nextLeague;
    });
  };

  useEffect(() => {
    const merged: Record<string, StandingsResponse> = { ...standingsCache };
    let changed = false;

    visibleLeagues.forEach((league, index) => {
      const selectedSeason = selectedSeasonByLeague[league];
      const cacheKey = `${league}:${selectedSeason || "current"}`;
      const data = standingsQueries[index]?.data;
      if (data?.groups?.length) {
        merged[cacheKey] = data;
        changed = true;
      }
    });

    if (changed) {
      writeSessionJson(STANDINGS_CACHE_KEY, merged);
    }
  }, [selectedSeasonByLeague, standingsCache, standingsQueries, visibleLeagues]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-8">
        <section className="surface-elevated-medium rounded-[2rem] border border-muted/15 bg-surface px-6 py-6">
          <div className="max-w-3xl space-y-3">
            <span className="inline-flex rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-accent">
              League Tables
            </span>
            <div>
              <h1 className="text-3xl font-semibold text-foreground">Standings That Actually Show the Table</h1>
              <p className="mt-2 text-sm text-muted">
                Conference, division, home and away splits, and past seasons for every league ESPN exposes.
              </p>
            </div>
          </div>

          <div className="mt-6 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              type="button"
              onClick={() => handleLeagueChange("ALL")}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                activeLeague === "ALL"
                  ? "surface-accent-choice bg-accent text-foreground"
                  : "border border-muted/15 text-muted hover:border-accent/30 hover:text-foreground"
              }`}
            >
              All
            </button>
            {SUPPORTED_SPORTS.map((sport) => (
              <button
                key={sport.id}
                type="button"
                onClick={() => handleLeagueChange(sport.id)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  activeLeague === sport.id
                    ? "surface-accent-choice bg-accent text-foreground"
                    : "border border-muted/15 text-muted hover:border-accent/30 hover:text-foreground"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  {LEAGUE_LOGOS[sport.id] ? (
                    <img src={LEAGUE_LOGOS[sport.id]} alt={sport.label} className="h-4 w-4 object-contain" />
                  ) : null}
                  {sport.label}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-8 space-y-8">
          {visibleLeagues.map((league, index) => (
            <LeagueStandingsSection
              key={`${league}:${selectedSeasonByLeague[league] || "current"}:${activeLeague === league ? "focused" : "all"}:${allViewResetVersion}`}
              league={league}
              data={standingsByLeague.get(league)}
              loading={standingsQueries[index]?.isLoading}
              savedTeams={savedTeams}
              selectedSeason={selectedSeasonByLeague[league] || ""}
              isFocusedView={activeLeague !== "ALL" && activeLeague === league}
              onSeasonChange={(season) =>
                setSelectedSeasonByLeague((current) => ({
                  ...current,
                  [league]: season,
                }))
              }
            />
          ))}
        </section>
      </main>

      <Footer />
    </div>
  );
}
