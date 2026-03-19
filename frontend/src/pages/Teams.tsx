import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiSearch } from "react-icons/fi";
import apiClient from "../api/client";
import Footer from "../components/Footer";
import Navbar from "../components/Navbar";
import TeamCard from "../components/TeamCard";
import { API, SUPPORTED_SPORTS } from "../constants";
import type { Team } from "../types";

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

export default function Teams() {
  const [activeLeague, setActiveLeague] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const { data: teams = [], isLoading } = useQuery<Team[]>({
    queryKey: ["teams", "all"],
    queryFn: async () => {
      const response = await apiClient.get(API.TEAMS, {
        params: { page: 1, page_size: 500 },
      });
      return (response.data as Record<string, unknown>[]).map(normalizeTeam);
    },
    staleTime: 300000,
  });

  const { data: savedTeams = [] } = useQuery<Team[]>({
    queryKey: ["savedTeams"],
    queryFn: async () => {
      const response = await apiClient.get(API.USER_TEAMS);
      return (response.data as Record<string, unknown>[]).map(normalizeTeam);
    },
  });

  const savedTeamIds = useMemo(
    () => new Set(savedTeams.map((team) => team.id)),
    [savedTeams],
  );

  const filteredTeams = useMemo(() => {
    const term = deferredSearch.trim().toLowerCase();

    return teams.filter((team) => {
      const leagueMatch = activeLeague === "ALL" || team.league === activeLeague;
      if (!leagueMatch) {
        return false;
      }
      if (!term) {
        return true;
      }
      return [team.name, team.city, team.league, team.shortName]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term));
    });
  }, [activeLeague, deferredSearch, teams]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-8">
        <section className="overflow-hidden rounded-[2rem] border border-muted/15 bg-surface px-6 py-6 shadow-[0_18px_60px_rgba(5,10,25,0.22)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <span className="inline-flex rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-accent">
                Team Directory
              </span>
              <div>
                <h1 className="text-3xl font-semibold text-foreground">Browse Every Club in One Place</h1>
                <p className="mt-2 text-sm text-muted">
                  Search across all supported leagues, follow the teams you care about, and jump straight into a full profile with schedule, roster, and trends.
                </p>
              </div>
            </div>

            <div className="w-full max-w-md">
              <label className="relative block">
                <FiSearch className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search teams, cities, or leagues..."
                  className="w-full rounded-2xl border border-muted/15 bg-background/80 py-3 pl-11 pr-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent/50"
                />
              </label>
            </div>
          </div>

          <div className="mt-6 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              type="button"
              onClick={() => setActiveLeague("ALL")}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                activeLeague === "ALL"
                  ? "bg-accent text-foreground shadow-[0_12px_28px_rgba(46,142,255,0.18)]"
                  : "border border-muted/15 text-muted hover:border-accent/30 hover:text-foreground"
              }`}
            >
              All
            </button>
            {SUPPORTED_SPORTS.map((sport) => (
              <button
                key={sport.id}
                type="button"
                onClick={() => setActiveLeague(sport.id)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  activeLeague === sport.id
                    ? "bg-accent text-foreground shadow-[0_12px_28px_rgba(46,142,255,0.18)]"
                    : "border border-muted/15 text-muted hover:border-accent/30 hover:text-foreground"
                }`}
              >
                {sport.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted">
              {filteredTeams.length} team{filteredTeams.length === 1 ? "" : "s"} ready to browse
            </p>
            <p className="text-xs uppercase tracking-[0.22em] text-muted">
              {activeLeague === "ALL" ? "All leagues" : activeLeague}
            </p>
          </div>

          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-48 animate-pulse rounded-3xl border border-muted/15 bg-surface" />
              ))}
            </div>
          ) : filteredTeams.length === 0 ? (
            <div className="rounded-3xl border border-muted/15 bg-surface px-6 py-16 text-center">
              <h2 className="text-xl font-semibold text-foreground">No teams matched that search</h2>
              <p className="mt-2 text-sm text-muted">
                Try a city, nickname, or switch the sport filter to widen the grid again.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredTeams.map((team) => (
                <TeamCard key={team.id} team={team} isFollowing={savedTeamIds.has(team.id)} />
              ))}
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
