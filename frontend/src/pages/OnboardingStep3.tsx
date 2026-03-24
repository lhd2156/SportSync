/**
 * SportSync - Onboarding Step 3: Pick Your Teams
 *
 * Uses backend APIs for team data and live standings groups so filtering stays
 * aligned with current league structure without hardcoded team maps.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import apiClient from "../api/client";
import { API, ROUTES } from "../constants";
import { useAuth } from "../context/AuthContext";
import type { LeagueKey, TeamGroup, TeamGroupsResponse, TeamItem, TeamCatalogResponse } from "../types";

const LEAGUE_ORDER = ["NFL", "NBA", "MLB", "NHL", "EPL"] as const;

type TeamFilterPanelProps = {
  title: string;
  groups: TeamGroup[];
  selectedGroups: string[];
  emptyStateText?: string;
  isLoading: boolean;
  layout?: "stack" | "grid";
  onClearAll: () => void;
  onToggleGroup: (groupName: string) => void;
};

function SearchIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5h18" />
      <path d="M7 12h10" />
      <path d="M10 19h4" />
    </svg>
  );
}

function normalizeTeamName(value: string) {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

function getFilterTitle(league: LeagueKey | null) {
  if (league === null) {
    return "League";
  }

  if (league === "NBA") {
    return "Conference";
  }

  if (league === "EPL") {
    return "Table";
  }

  if (league) {
    return "Division";
  }

  return "Filter";
}

function TeamFilterPanel({
  title,
  groups,
  selectedGroups,
  emptyStateText,
  isLoading,
  layout = "stack",
  onClearAll,
  onToggleGroup,
}: TeamFilterPanelProps) {
  const canClear = selectedGroups.length > 0;

  return (
    <div className="rounded-2xl border border-muted/15 bg-surface/85 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-muted/65">
            <FilterIcon />
            Filter
          </div>
          <h3 className="mt-2 text-sm font-semibold text-foreground">{title}</h3>
        </div>

        <button
          type="button"
          onClick={onClearAll}
          disabled={!canClear}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
            canClear
              ? "bg-accent text-white hover:bg-accent-hover"
              : "bg-accent text-white opacity-55"
          }`}
        >
          Clear all
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-10 rounded-xl border border-muted/10 bg-background/40 animate-pulse"
            />
          ))}
        </div>
      ) : groups.length > 0 ? (
        <div
          className={
            layout === "grid"
              ? "grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4"
              : "flex flex-col gap-2"
          }
        >
          {groups.map((group) => {
            const isActive = selectedGroups.includes(group.name);

            return (
              <button
                key={group.name}
                type="button"
                onClick={() => onToggleGroup(group.name)}
                className={`rounded-xl border px-3 py-2 text-left text-sm transition-all ${
                  isActive
                    ? "border-accent bg-accent text-white surface-accent-choice"
                    : "border-muted/15 bg-background/40 text-muted hover:border-muted/30 hover:text-foreground"
                }`}
              >
                {group.name}
              </button>
            );
          })}
        </div>
      ) : (
        emptyStateText ? <p className="text-xs leading-6 text-muted">{emptyStateText}</p> : null
      )}
    </div>
  );
}

export default function OnboardingStep3() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [groupsByLeague, setGroupsByLeague] = useState<Partial<Record<LeagueKey, TeamGroup[]>>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [teamsError, setTeamsError] = useState("");
  const [activeLeague, setActiveLeague] = useState<LeagueKey | null>("NFL");
  const [selectedGroupNames, setSelectedGroupNames] = useState<string[]>([]);
  const [groupLoadingLeague, setGroupLoadingLeague] = useState<LeagueKey | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchTeams = useCallback(async () => {
    setIsLoading(true);
    setTeamsError("");

    try {
      // Use /api/teams which returns internal DB IDs that work with onboarding save
      const response = await apiClient.get("/api/teams", {
        params: { page: 1, page_size: 500 },
      });

      const allTeams: TeamItem[] = (Array.isArray(response.data) ? response.data : []).map((team: TeamCatalogResponse) => ({
        id: team.id,
        requestId: team.external_id || team.id,
        name: team.name,
        shortName: team.short_name || team.name.slice(0, 3).toUpperCase(),
        league: team.league as LeagueKey,
        logo: team.logo_url || "",
      }));

      // Sort by league order then name
      allTeams.sort((left, right) => {
        const leftIndex = LEAGUE_ORDER.indexOf(left.league);
        const rightIndex = LEAGUE_ORDER.indexOf(right.league);
        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
        return left.name.localeCompare(right.name);
      });

      setTeams(allTeams);
      setTeamsError(
        allTeams.length === 0
          ? "Teams are temporarily unavailable. Retry once the backend is back up."
          : ""
      );
    } catch {
      setTeamsError("Failed to load teams. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  useEffect(() => {
    function handleWindowFocus() {
      if (teams.length === 0) {
        fetchTeams();
      }
    }

    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, [fetchTeams, teams.length]);

  const leagues = useMemo(() => {
    const loadedLeagues = new Set(teams.map((team) => team.league));
    return LEAGUE_ORDER.filter((league) => loadedLeagues.has(league));
  }, [teams]);

  useEffect(() => {
    if (activeLeague && !leagues.includes(activeLeague)) {
      setActiveLeague(leagues[0] ?? null);
    }
  }, [activeLeague, leagues]);

  useEffect(() => {
    setSelectedGroupNames([]);

    if (!activeLeague || groupsByLeague[activeLeague] !== undefined) {
      return;
    }

    let isCancelled = false;
    const leagueKey = activeLeague;

    async function fetchGroups() {
      setGroupLoadingLeague(leagueKey);

      try {
        const response = await apiClient.get<TeamGroupsResponse>("/api/sports/team-groups", {
          params: { league: leagueKey },
        });

        if (!isCancelled) {
          setGroupsByLeague((previous) => ({
            ...previous,
            [leagueKey]: response.data.groups || [],
          }));
        }
      } catch {
        if (!isCancelled) {
          setGroupsByLeague((previous) => ({
            ...previous,
            [leagueKey]: [],
          }));
        }
      } finally {
        if (!isCancelled) {
          setGroupLoadingLeague((current) => (current === leagueKey ? null : current));
        }
      }
    }

    fetchGroups();

    return () => {
      isCancelled = true;
    };
  }, [activeLeague, groupsByLeague]);

  const activeGroups = useMemo(() => {
    if (!activeLeague) {
      return [];
    }

    return groupsByLeague[activeLeague] ?? [];
  }, [activeLeague, groupsByLeague]);

  const isGroupsLoading = activeLeague !== null && groupLoadingLeague === activeLeague;
  const isLeagueFilterMode = activeLeague === null;
  const panelGroups = useMemo(
    () =>
      isLeagueFilterMode
        ? leagues.map((league) => ({
            name: league,
            teams: [],
            teamIds: [],
          }))
        : activeGroups,
    [activeGroups, isLeagueFilterMode, leagues]
  );

  const visibleTeams = useMemo(() => {
    let filtered = activeLeague ? teams.filter((team) => team.league === activeLeague) : teams;

    if (activeLeague && selectedGroupNames.length > 0) {
      const allowedIds = new Set<string>();
      const allowedNames = new Set<string>();

      activeGroups
        .filter((item) => selectedGroupNames.includes(item.name))
        .forEach((group) => {
          group.teamIds.forEach((teamId) => allowedIds.add(teamId));
          group.teams.forEach((teamName) => allowedNames.add(normalizeTeamName(teamName)));
        });

      filtered = filtered.filter(
        (team) => allowedIds.has(team.id) || allowedNames.has(normalizeTeamName(team.name))
      );
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (team) =>
          team.name.toLowerCase().includes(query) ||
          team.shortName.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [activeGroups, activeLeague, searchQuery, selectedGroupNames, teams]);

  const filterTitle = getFilterTitle(activeLeague);
  const filterEmptyStateText =
    activeLeague === null ? "" : "No additional filters for this league.";

  function handleFilterToggle(groupName: string) {
    if (isLeagueFilterMode) {
      if (LEAGUE_ORDER.includes(groupName as LeagueKey)) {
        setActiveLeague(groupName as LeagueKey);
      }
      setSelectedGroupNames([]);
      return;
    }

    setSelectedGroupNames((previous) =>
      previous.includes(groupName)
        ? previous.filter((name) => name !== groupName)
        : [...previous, groupName]
    );
  }

  function handleFilterClearAll() {
    if (isLeagueFilterMode) {
      setActiveLeague(null);
      return;
    }

    setSelectedGroupNames([]);
  }

  function toggleTeam(teamId: string) {
    setSelectedTeams((previous) =>
      previous.includes(teamId)
        ? previous.filter((id) => id !== teamId)
        : [...previous, teamId]
    );
  }

  async function handleComplete() {
    setIsSubmitting(true);

    try {
      await apiClient.post(API.ONBOARDING_COMPLETE, {
        team_ids: selectedTeams,
      });

      const teamNames = teams
        .filter((team) => selectedTeams.includes(team.id))
        .map((team) => team.name);

      if (teamNames.length > 0) {
        localStorage.setItem("sportsync_saved_teams", JSON.stringify(teamNames));
      }

      if (user) {
        setUser({ ...user, isOnboarded: true });
      }

      navigate(ROUTES.DASHBOARD);
    } catch {
      if (user) {
        setUser({ ...user, isOnboarded: true });
      }

      navigate(ROUTES.DASHBOARD);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-sm text-muted">Loading teams...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6 md:py-8 animate-fadeIn">
      <div className="mx-auto w-full max-w-[1460px]">
        <OnboardingProgress currentStep={3} />

        <div className="mx-auto mb-7 w-full max-w-[920px] text-center">
          <h1 className="mb-2 text-2xl font-bold text-foreground">Pick Your Teams</h1>
          <p className="text-sm text-muted">Your saved teams always appear first in the feed</p>
        </div>

        <div className="mx-auto mb-5 flex w-full max-w-[920px] flex-wrap justify-center gap-2 overflow-x-auto pb-2">
          <button
            type="button"
            onClick={() => setActiveLeague(null)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition-all whitespace-nowrap ${
              activeLeague === null
                ? "border-accent bg-accent text-white"
                : "border-muted/15 bg-surface/70 text-muted hover:border-muted/30 hover:text-foreground"
            }`}
          >
            All
          </button>

          {leagues.map((league) => (
            <button
              key={league}
              type="button"
              onClick={() => setActiveLeague(league)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-all whitespace-nowrap ${
                activeLeague === league
                  ? "border-accent bg-accent text-white"
                  : "border-muted/15 bg-surface/70 text-muted hover:border-muted/30 hover:text-foreground"
              }`}
            >
              {league}
            </button>
          ))}
        </div>

        <div className="mx-auto mb-4 w-full max-w-[920px]">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              <SearchIcon />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search teams..."
              className="w-full rounded-xl border border-muted/15 bg-surface pl-10 pr-4 py-3 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent/50"
            />
          </div>
        </div>

        <div className="mx-auto mb-5 w-full max-w-[920px] 2xl:hidden">
          <TeamFilterPanel
            title={filterTitle}
            groups={panelGroups}
            selectedGroups={selectedGroupNames}
            emptyStateText={filterEmptyStateText}
            isLoading={!isLeagueFilterMode && isGroupsLoading}
            layout="grid"
            onClearAll={handleFilterClearAll}
            onToggleGroup={handleFilterToggle}
          />
        </div>

        <div className="relative">
          <aside className="absolute right-0 top-0 hidden w-[250px] 2xl:block">
            <div className="sticky top-6">
              <TeamFilterPanel
                title={filterTitle}
                groups={panelGroups}
                selectedGroups={selectedGroupNames}
                emptyStateText={filterEmptyStateText}
                isLoading={!isLeagueFilterMode && isGroupsLoading}
                layout="stack"
                onClearAll={handleFilterClearAll}
                onToggleGroup={handleFilterToggle}
              />
            </div>
          </aside>

          <div className="mx-auto w-full max-w-[920px]">
            {teamsError && !isLoading && (
              <div className="surface-note-warning mb-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm">
                <p>{teamsError}</p>
                <button
                  type="button"
                  onClick={fetchTeams}
                  className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent/90"
                >
                  Retry
                </button>
              </div>
            )}

            {visibleTeams.length === 0 ? (
              <div className="mb-6 flex min-h-[520px] items-center justify-center rounded-2xl border border-muted/10 bg-surface/40 px-6 py-16 text-center text-muted">
                <p>
                  No teams found.
                  {searchQuery ? " Try a different search." : " You can skip this step for now."}
                </p>
              </div>
            ) : (
              <div className="mb-6 grid min-h-[520px] max-h-[520px] grid-cols-1 gap-4 overflow-y-auto px-1 py-1 custom-scrollbar content-start sm:grid-cols-2 lg:grid-cols-3">
                {visibleTeams.map((team) => {
                  const isSelected = selectedTeams.includes(team.id);

                  return (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => toggleTeam(team.id)}
                      className={`relative flex min-h-[164px] flex-col items-center justify-center gap-3 rounded-2xl border px-4 py-5 text-center transition-all ${
                        isSelected
                          ? "border-accent bg-accent/10 surface-accent-choice"
                          : "border-muted/15 bg-surface hover:border-muted/30"
                      }`}
                    >
                      {isSelected && (
                        <span className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white">
                          <CheckIcon />
                        </span>
                      )}

                      <div className="relative flex h-14 w-14 items-center justify-center">
                        {team.logo ? (
                          <img
                            src={team.logo}
                            alt={team.name}
                            className="h-14 w-14 object-contain"
                            onError={(event) => {
                              const image = event.target as HTMLImageElement;
                              image.style.display = "none";

                              const fallback = image.nextElementSibling as HTMLElement | null;
                              if (fallback) {
                                fallback.style.display = "flex";
                              }
                            }}
                          />
                        ) : null}

                        <div
                          className={`h-11 w-11 items-center justify-center rounded-full bg-muted/15 text-xs font-semibold text-muted ${
                            team.logo ? "hidden" : "flex"
                          }`}
                        >
                          {team.shortName}
                        </div>
                      </div>

                      <div>
                        <span className="block text-sm font-semibold leading-tight text-foreground">
                          {team.name}
                        </span>
                        <span className="mt-1 block text-xs text-muted">{team.league}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedTeams.length > 0 && (
              <p className="mb-3 text-center text-sm font-medium text-accent">
                {selectedTeams.length} team{selectedTeams.length !== 1 ? "s" : ""} selected
              </p>
            )}

            <button
              type="button"
              onClick={handleComplete}
              disabled={isSubmitting}
              className="w-full rounded-lg bg-accent py-3 font-medium text-white transition-all hover:bg-accent-hover disabled:opacity-40"
            >
              {isSubmitting
                ? "Finishing..."
                : selectedTeams.length > 0
                  ? `Complete Setup (${selectedTeams.length} ${selectedTeams.length === 1 ? "team" : "teams"})`
                  : "Skip for now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OnboardingProgress({ currentStep }: { currentStep: number }) {
  const steps = [1, 2, 3];

  return (
    <div className="mb-8 flex items-center justify-center gap-2">
      {steps.map((step) => (
        <div
          key={step}
          className={`h-1.5 w-10 rounded-full transition-colors ${
            step <= currentStep ? "bg-accent" : "bg-muted/30"
          }`}
        />
      ))}
    </div>
  );
}
