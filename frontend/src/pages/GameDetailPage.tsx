/**
 * SportSync - Game Detail Page
 *
 * Full ESPN game view with:
 * - Live score header with team logos, records, and status
 * - Tab navigation: Play-by-Play, Box Score, Game Leaders, Game Info
 * - Real ESPN data: actual plays, player stats, game leaders
 * - 10s auto-refresh for live games
 */
import { memo, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Navbar from "../components/Navbar";
import LiveBadge from "../components/LiveBadge";
import Footer from "../components/Footer";
import apiClient from "../api/client";
import { API } from "../constants";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const loadedHeadshotSources = new Set<string>();
const failedHeadshotChains = new Set<string>();
const nbaRosterCache = new Map<string, any[]>();
const nbaAthleteStatCache = new Map<string, Record<string, number> | null>();

/* ── Inline SVG Icons ── */
const IconBack = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
);
const IconPlayByPlay = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>
);
const IconBoxScore = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>
);
const IconLeaders = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 010-5C7 4 6 9 6 9z"/><path d="M18 9h1.5a2.5 2.5 0 000-5C17 4 18 9 18 9z"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/></svg>
);
const IconInfo = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
);
const IconVenue = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/></svg>
);
const IconOdds = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
);
const IconTV = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>
);
const IconClock = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
);

/* Helper to extract headshot URL — ESPN sometimes returns {href, alt} object */
function getHeadshotUrl(headshot: unknown): string {
  if (!headshot) return "";
  if (typeof headshot === "string") return headshot;
  if (typeof headshot === "object" && headshot !== null && "href" in headshot) {
    return (headshot as { href: string }).href;
  }
  return "";
}

function getTeamLogoUrl(team: any): string {
  const directLogo = cleanValue(String(team?.logo || ""));
  if (directLogo) return directLogo;

  const logos = Array.isArray(team?.logos) ? team.logos : [];
  const pickByRel = (relName: string) =>
    logos.find(
      (logo: any) =>
        Array.isArray(logo?.rel) &&
        logo.rel.includes(relName) &&
        !logo.rel.includes("dark") &&
        cleanValue(String(logo?.href || "")),
    )?.href;

  return cleanValue(
    String(
      pickByRel("scoreboard") ||
        pickByRel("default") ||
        pickByRel("primary_logo_on_white_color") ||
        logos.find(
          (logo: any) =>
            Array.isArray(logo?.rel) &&
            !logo.rel.includes("dark") &&
            cleanValue(String(logo?.href || "")),
        )?.href ||
        logos.find((logo: any) => cleanValue(String(logo?.href || "")))?.href ||
        "",
    ),
  );
}

function normalizeEncodingArtifacts(value: string): string {
  return value
    .replace(/Ã¢â‚¬â„¢|â€™/g, "'")
    .replace(/Ã‚Â·|Â·/g, "·")
    .replace(/â€”/g, "—")
    .replace(/â€“/g, "–")
    .replace(/Â/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDisplayEncoding(value: string): string {
  return normalizeEncodingArtifacts(value)
    .replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢|Ã¢â‚¬â„¢|â€™|’|â€˜/g, "'")
    .replace(/Ãƒâ€šÃ‚Â·|Ã‚Â·|Â·|•|â€¢/g, "·")
    .replace(/Ã¢â‚¬â€|â€”|—/g, "—")
    .replace(/Ã¢â‚¬â€œ|â€“|–/g, "–")
    .replace(/Ã¢â‚¬Â¦|â€¦|…/g, "…")
    .replace(/Â/g, "")
    .replace(/�/g, "")
    .trim();
}

function normalizeSafeDisplay(value: string): string {
  return normalizeDisplayEncoding(value)
    .replace(/\u00c2/g, "")
    .replace(/\u00b7/g, "|")
    .replace(/\u2022/g, "|")
    .replace(/â€¢/g, "|")
    .replace(/\u2014|\u2013/g, "-")
    .replace(/â€”|â€“/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/â€¦/g, "...")
    .replace(/ï¿½/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanValue(value?: string | null): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) return "";
  const normalizedClean = normalizeSafeDisplay(trimmed)
    .replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢|Ã¢â‚¬â„¢|â€™|’|‘/g, "'")
    .replace(/Ãƒâ€šÃ‚Â·|Ã‚Â·|Â·|•|●|â€¢/g, "|")
    .replace(/Ã¢â‚¬â€|â€”|—|Ã¢â‚¬â€œ|â€“|–/g, "-")
    .replace(/Ã¢â‚¬Â¦|â€¦|…/g, "...")
    .replace(/Ã‚|Â|ï¿½/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = normalizedClean.toLowerCase();
  if (normalized === "null" || normalized === "undefined" || normalized === "n/a") {
    return "";
  }
  return normalizedClean;
}

function sanitizeStatLine(value?: string | null): string {
  const cleaned = cleanValue(value);
  if (!cleaned) return "";

  return cleaned
    .split("·")
    .map((segment) => segment.trim())
    .filter((segment) => segment && !/---/.test(segment) && !/^[-–—]+$/.test(segment))
    .join(" · ");
}

function sanitizeDisplayStatLine(value?: string | null): string {
  const cleaned = cleanValue(value);
  if (!cleaned) return "";

  return cleaned
    .replace(/\s+\?\s+/g, " · ")
    .replace(/\s*·\s*/g, " · ")
    .replace(/\s*•\s*/g, " · ")
    .split("·")
    .map((segment) => segment.trim())
    .filter((segment) => segment && !/---/.test(segment) && !/^\?+$/.test(segment) && !/^[-–—]+$/.test(segment))
    .join(" · ");
}

function sanitizeSafeDisplayStatLine(value?: string | null): string {
  const cleaned = sanitizeDisplayStatLine(value) || cleanValue(value);
  if (!cleaned) return "";

  return cleaned
    .replace(/\s+\?\s+/g, " | ")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\s*Â·\s*/g, " | ")
    .replace(/\s*â€¢\s*/g, " | ")
    .replace(/\s*·\s*/g, " | ")
    .replace(/\s*•\s*/g, " | ")
    .split("|")
    .map((segment) => segment.trim())
    .filter((segment) => segment && !/---/.test(segment) && !/^\?+$/.test(segment) && !/^[-â€“â€”]+$/.test(segment))
    .join(" | ");
}

function getInitials(name: string): string {
  return cleanValue(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function sanitizeRenderedStatLine(value?: string | null): string {
  const cleaned = cleanValue(value);
  if (!cleaned) return "";

  return cleaned
    .replace(/\s*\?\s*/g, " | ")
    .replace(/\s*\|\s*/g, " | ")
    .split("|")
    .map((segment) => segment.trim())
    .filter((segment) => segment && !/---/.test(segment) && !/^\?+$/.test(segment) && !/^[-|]+$/.test(segment))
    .join(" | ");
}

function isOfficialHeadshotUrl(url: string): boolean {
  const cleanUrl = cleanValue(url).toLowerCase();
  return (
    cleanUrl.includes("a.espncdn.com/i/headshots/") ||
    cleanUrl.includes("img.mlbstatic.com/mlb-photos/image/upload") ||
    cleanUrl.includes("resources.premierleague.com/premierleague/photos/players/")
  );
}

function buildHeadshotSources(src: string, name: string, league?: string, teamName?: string): string[] {
  const cleanSrc = cleanValue(src);
  const cleanName = cleanValue(name);
  const cleanLeague = cleanValue(league);
  const cleanTeamName = cleanValue(teamName);
  if (!cleanSrc && !cleanName) return [];

  const sources: string[] = [];
  const add = (candidate: string) => {
    const cleanCandidate = cleanValue(candidate);
    if (cleanCandidate && !sources.includes(cleanCandidate)) {
      sources.push(cleanCandidate);
    }
  };

  const params = new URLSearchParams();
  if (cleanSrc) params.set("src", cleanSrc);
  if (cleanName) params.set("name", cleanName);
  if (cleanLeague) params.set("league", cleanLeague);
  if (cleanTeamName) params.set("team", cleanTeamName);
  const proxyUrl = params.toString()
    ? `${API_BASE_URL}${API.ESPN_HEADSHOT}?${params.toString()}`
    : "";

  const fallbackParams = new URLSearchParams();
  if (cleanName) fallbackParams.set("name", cleanName);
  if (cleanLeague) fallbackParams.set("league", cleanLeague);
  if (cleanTeamName) fallbackParams.set("team", cleanTeamName);
  const proxyFallbackUrl = fallbackParams.toString()
    ? `${API_BASE_URL}${API.ESPN_HEADSHOT}?${fallbackParams.toString()}`
    : "";

  const isPremierLeagueHeadshot = cleanSrc.includes("resources.premierleague.com/premierleague");
  const prefersDirectOfficialHeadshot = isOfficialHeadshotUrl(cleanSrc);

  if (!cleanSrc) {
    add(proxyFallbackUrl);
    add(proxyUrl);
    return sources;
  }

  if (isPremierLeagueHeadshot) {
    add(cleanSrc);
    add(proxyFallbackUrl);
    add(proxyUrl);
    return sources;
  }

  if (prefersDirectOfficialHeadshot) {
    add(cleanSrc);
  }

  add(proxyUrl);
  add(proxyFallbackUrl);

  if (isOfficialHeadshotUrl(cleanSrc) && !prefersDirectOfficialHeadshot) {
    add(cleanSrc);
  }

  return sources;
}

const PersonSVG = memo(function PersonSVG({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-muted/50" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
});

const GameHeadshotImg = memo(function GameHeadshotImg({
  src,
  alt,
  className,
  fallbackSrc,
  league,
  teamName,
  renderMode = "headshot",
}: {
  src: string;
  alt: string;
  className: string;
  fallbackSrc?: string;
  league?: string;
  teamName?: string;
  renderMode?: "headshot" | "badge";
}) {
  const cleanSrc = cleanValue(src);
  const cleanFallbackSrc = cleanValue(fallbackSrc);
  const imageSources = useMemo(
    () =>
      renderMode === "badge"
        ? [cleanSrc, cleanFallbackSrc].filter((value, index, array) => value && array.indexOf(value) === index)
        : buildHeadshotSources(cleanSrc, alt, league, teamName),
    [cleanSrc, cleanFallbackSrc, alt, league, teamName, renderMode],
  );
  const sourceKey = useMemo(
    () => imageSources.join("|") || `${renderMode}|${cleanValue(league)}|${cleanValue(teamName)}|${cleanValue(alt)}`,
    [imageSources, renderMode, league, teamName, alt],
  );
  const [resolvedSrc, setResolvedSrc] = useState("");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!imageSources.length) {
      setResolvedSrc("");
      setIsReady(true);
      return;
    }

    let cancelled = false;
    setResolvedSrc("");
    setIsReady(false);

    if (failedHeadshotChains.has(sourceKey)) {
      setIsReady(true);
      return;
    }

    const resolveCandidate = (index: number) => {
      if (cancelled) return;
      if (index >= imageSources.length) {
        failedHeadshotChains.add(sourceKey);
        setResolvedSrc("");
        setIsReady(true);
        return;
      }

      const candidate = imageSources[index];
      if (loadedHeadshotSources.has(candidate)) {
        setResolvedSrc(candidate);
        setIsReady(true);
        return;
      }

      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onload = () => {
        if (cancelled) return;
        loadedHeadshotSources.add(candidate);
        failedHeadshotChains.delete(sourceKey);
        setResolvedSrc(candidate);
        setIsReady(true);
      };
      img.onerror = () => resolveCandidate(index + 1);
      img.src = candidate;
    };

    resolveCandidate(0);
    return () => {
      cancelled = true;
    };
  }, [imageSources, sourceKey]);

  const isSoccerLeague = league === "EPL" || league === "MLS";
  const imageSizingClass =
    renderMode === "badge"
      ? "h-full w-full object-contain p-[14%]"
      : isSoccerLeague
        ? "scale-[1.05] object-cover object-top"
        : "scale-[1.16] object-cover object-center";

  if (!resolvedSrc) {
    if (!isReady) {
      return (
        <div className={`${className} relative overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(33,46,74,0.9),_rgba(16,21,34,0.98)_72%)] border border-[#2a3654] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]`}>
          <div className="absolute inset-[3px] rounded-full border border-[#334469]/40" />
          <div className="absolute inset-0 animate-pulse bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_55%)]" />
          <div className="relative opacity-45">
            <PersonSVG size={18} />
          </div>
        </div>
      );
    }

    const initials = getInitials(alt);
    return (
      <div className={`${className} relative overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(39,52,81,0.92),_rgba(18,24,39,0.98)_72%)] border border-[#2a3654] flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]`}>
        {initials ? (
          <>
            <div className="absolute inset-[3px] rounded-full border border-[#334469]/45" />
            <span className="relative text-[12px] font-semibold tracking-[0.08em] text-[#9eb1da]">{initials}</span>
          </>
        ) : cleanFallbackSrc && cleanFallbackSrc !== cleanSrc ? (
          <img src={cleanFallbackSrc} alt="" className="h-full w-full object-contain p-[14%]" loading="lazy" />
        ) : (
          <PersonSVG size={18} />
        )}
      </div>
    );
  }

  return (
    <div className={`${className} relative overflow-hidden bg-[#1b1f2a] border border-[#25304a] flex items-center justify-center`}>
      <img
        src={resolvedSrc}
        alt={alt}
        className={`${imageSizingClass} img-fade-in`}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </div>
  );
});

/* ── Type definitions ── */
interface Play {
  id: string;
  text: string;
  shortText?: string;
  type?: string;
  playType?: string;
  clock?: string;
  period?: number;
  periodText?: string;
  statusDetail?: string;
  scoreValue?: number;
  scoringPlay?: boolean;
  homeScore: string | number;
  awayScore: string | number;
  team?: string;
  teamLogo?: string;
  playTeamName?: string;
  playTeamAbbr?: string;
  playTeamLogo?: string;
  athleteName: string;
  athleteHeadshot: string;
  athleteStats?: string;
  athlete2Name?: string;
  athlete2Headshot?: string;
}

interface PlayerStat {
  name: string;
  shortName: string;
  headshot: unknown; // Can be string or {href, alt} object
  position: string;
  stats: Record<string, string>;
}

interface BoxScoreTeam {
  teamName: string;
  teamAbbr: string;
  teamLogo: string;
  players: PlayerStat[];
  labels: string[];
}

interface Leader {
  team: string;
  teamAbbr: string;
  category: string;
  name: string;
  value: string;
  headshot: unknown;
}

interface TeamDetail {
  id: string;
  name: string;
  abbreviation: string;
  logo: string;
  color: string;
  record: string;
  score: string;
  leaders: { category: string; name: string; value: string; headshot: unknown }[];
  stats: { name: string; label: string; abbreviation: string }[];
  linescores: number[];
}

interface GameData {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number;
  awayScore: number;
  homeBadge: string;
  awayBadge: string;
  status: string;
  statusDetail: string;
  league: string;
  dateEvent: string;
  strVenue: string;
  strEvent: string;
  homeDetail: TeamDetail;
  awayDetail: TeamDetail;
  venue: { name: string; city: string; state: string };
  odds: { details: string; overUnder: number; spread: number } | null;
  broadcasts: string[];
}

interface GameDetailResponse {
  game: GameData | null;
  plays: Play[];
  boxScore: BoxScoreTeam[];
  leaders: Leader[];
  error?: string;
}

type Tab = "plays" | "boxscore" | "leaders" | "info";

const DIRECT_ESPN_SUMMARY_PATHS: Record<string, string> = {
  NFL: "football/nfl",
  NBA: "basketball/nba",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
  MLS: "soccer/usa.1",
  EPL: "soccer/eng.1",
};

function normalizeActivityDateParam(value?: string | null): string {
  const clean = cleanValue(value);
  if (!clean) return "";
  if (/^\d{8}$/.test(clean)) return clean;
  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  }
  const digits = clean.replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : "";
}

function shiftActivityDateParam(dateParam: string, days: number): string {
  const normalized = normalizeActivityDateParam(dateParam);
  if (!normalized) return "";
  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(4, 6));
  const day = Number(normalized.slice(6, 8));
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10).replace(/-/g, "");
}

function parseGameStatus(statusObj: any): { status: string; statusDetail: string } {
  const type = statusObj?.type || {};
  const statusName = String(type.name || "");
  const statusDetail = String(type.shortDetail || type.detail || "");
  const state = String(type.state || "");

  if (state === "in" || statusName === "STATUS_IN_PROGRESS") {
    return { status: "live", statusDetail };
  }
  if (state === "post" || ["STATUS_FINAL", "STATUS_END", "STATUS_FULL_TIME"].includes(statusName)) {
    return { status: "final", statusDetail };
  }
  if (state === "pre" || statusName === "STATUS_SCHEDULED") {
    return { status: "upcoming", statusDetail };
  }

  const detailLower = statusDetail.toLowerCase();
  if (detailLower.includes("final") || detailLower.includes("ft")) {
    return { status: "final", statusDetail };
  }
  if (statusDetail.includes("'") || detailLower.includes("half") || detailLower.includes("ot")) {
    return { status: "live", statusDetail };
  }
  return { status: "upcoming", statusDetail };
}

function parseTeamLeaderItems(leadersRaw: any[]): TeamDetail["leaders"] {
  const leaders: TeamDetail["leaders"] = [];
  for (const leaderCat of leadersRaw || []) {
    const catLeaders = leaderCat?.leaders || [];
    if (!catLeaders.length) continue;
    const top = catLeaders[0] || {};
    const athlete = top.athlete || {};
    leaders.push({
      category: String(leaderCat.displayName || leaderCat.name || ""),
      name: String(athlete.displayName || ""),
      value: String(top.displayValue || ""),
      headshot: athlete.headshot || "",
    });
  }
  return leaders;
}

function parseTeamStats(statsRaw: any[]): TeamDetail["stats"] {
  return (statsRaw || []).map((stat) => ({
    name: String(stat.displayValue || stat.name || ""),
    label: String(stat.name || ""),
    abbreviation: String(stat.abbreviation || ""),
  }));
}

function buildGameDataFromSummary(summary: any, league: string, eventId: string): GameData | null {
  const header = summary?.header || {};
  const competition = (header.competitions || [])[0] || {};
  const competitors = competition.competitors || [];
  if (!competitors.length) return null;

  let home: any = {};
  let away: any = {};
  let homeDetail = {} as TeamDetail;
  let awayDetail = {} as TeamDetail;

  for (const competitor of competitors) {
    const team = competitor.team || {};
    const teamInfo = {
      id: String(team.id || ""),
      name: String(team.displayName || team.shortDisplayName || ""),
      abbreviation: String(team.abbreviation || ""),
      logo: getTeamLogoUrl(team),
      color: String(team.color || ""),
      record: String(((competitor.records || [])[0] || {}).summary || ""),
      score: String(competitor.score || "0"),
      leaders: parseTeamLeaderItems(competitor.leaders || []),
      stats: parseTeamStats(competitor.statistics || []),
      linescores: (competitor.linescores || []).map((line: any) => Number(line?.value || 0)),
    };

    if (competitor.homeAway === "home") {
      home = teamInfo;
      homeDetail = teamInfo;
    } else {
      away = teamInfo;
      awayDetail = teamInfo;
    }
  }

  const venue = competition.venue || summary?.gameInfo?.venue || {};
  const oddsSource = (summary?.odds || competition.odds || [])[0] || null;
  const broadcastsSource = summary?.broadcasts || competition.broadcasts || [];
  const { status, statusDetail } = parseGameStatus(competition.status || {});

  return {
    id: String(eventId),
    homeTeam: String(home.name || ""),
    awayTeam: String(away.name || ""),
    homeAbbr: String(home.abbreviation || ""),
    awayAbbr: String(away.abbreviation || ""),
    homeScore: Number(home.score || 0),
    awayScore: Number(away.score || 0),
    homeBadge: String(home.logo || ""),
    awayBadge: String(away.logo || ""),
    status,
    statusDetail,
    league,
    dateEvent: String(competition.date || "").slice(0, 10),
    strVenue: String(venue.fullName || venue.displayName || ""),
    strEvent: `${away.name || ""} at ${home.name || ""}`,
    homeDetail,
    awayDetail,
    venue: {
      name: String(venue.fullName || venue.displayName || ""),
      city: String(venue.address?.city || ""),
      state: String(venue.address?.state || ""),
    },
    odds: oddsSource
      ? {
          details: String(oddsSource.details || ""),
          overUnder: Number(oddsSource.overUnder || 0),
          spread: Number(oddsSource.spread || 0),
        }
      : null,
    broadcasts: broadcastsSource.flatMap((broadcast: any) => broadcast?.names || []).filter(Boolean),
  };
}

function parseSummaryBoxScore(summary: any): BoxScoreTeam[] {
  const boxPlayers = summary?.boxscore?.players || [];
  return boxPlayers.map((teamBox: any) => {
    const teamInfo = teamBox.team || {};
    const teamStats = teamBox.statistics || [];
    const players: PlayerStat[] = [];
    for (const statGroup of teamStats) {
      const labels = statGroup.labels || [];
      for (const athleteEntry of statGroup.athletes || []) {
        const athlete = athleteEntry.athlete || {};
        const stats: Record<string, string> = {};
        (athleteEntry.stats || []).forEach((value: string, index: number) => {
          const label = labels[index];
          if (label) stats[label] = value;
        });
        players.push({
          name: String(athlete.displayName || ""),
          shortName: String(athlete.shortName || athlete.displayName || ""),
          headshot: athlete.headshot || "",
          position: String(athlete.position?.abbreviation || ""),
          stats,
        });
      }
    }
    return {
      teamName: String(teamInfo.displayName || ""),
      teamAbbr: String(teamInfo.abbreviation || ""),
      teamLogo: getTeamLogoUrl(teamInfo),
      players,
      labels: teamStats[0]?.labels || [],
    };
  });
}

type DerivedTeamLeaders = TeamDetail["leaders"];

interface DerivedLeadersPayload {
  leaders: Leader[];
  byTeamKey: Record<string, DerivedTeamLeaders>;
}

function parseNumericStat(value: unknown): number {
  const cleaned = cleanValue(String(value ?? ""));
  if (!cleaned) return 0;
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function parseBaseballInningsToOuts(value: unknown): number {
  const cleaned = cleanValue(String(value ?? ""));
  if (!cleaned) return 0;

  const match = cleaned.match(/^(\d+)(?:\.(\d))?$/);
  if (!match) return Math.round(parseNumericStat(cleaned) * 3);

  const whole = Number(match[1] || 0);
  const partial = Number(match[2] || 0);
  return whole * 3 + partial;
}

function getLabeledStat(labels: string[], stats: string[], label: string): string {
  const index = labels.findIndex((item) => item === label);
  return index >= 0 ? cleanValue(stats[index]) : "";
}

function registerTeamLeaders(target: Record<string, DerivedTeamLeaders>, teamInfo: any, leaders: DerivedTeamLeaders) {
  if (!leaders.length) return;

  const keys = [
    cleanValue(String(teamInfo?.abbreviation || "")),
    cleanValue(String(teamInfo?.displayName || "")),
    cleanValue(String(teamInfo?.shortDisplayName || "")),
  ].filter(Boolean);

  for (const key of keys) {
    target[key] = leaders;
  }
}

function resolveDerivedTeamLeaders(teamDetail: TeamDetail, byTeamKey: Record<string, DerivedTeamLeaders>): DerivedTeamLeaders {
  const keys = [cleanValue(teamDetail.abbreviation), cleanValue(teamDetail.name)].filter(Boolean);
  for (const key of keys) {
    const leaders = byTeamKey[key];
    if (leaders?.length) return leaders;
  }
  return [];
}

function isMlbBattingSection(labels: string[]): boolean {
  const normalized = new Set(labels.map((label) => cleanValue(label).toUpperCase()));
  return normalized.has("H-AB") && normalized.has("RBI") && normalized.has("HR");
}

function isMlbPitchingSection(labels: string[]): boolean {
  const normalized = new Set(labels.map((label) => cleanValue(label).toUpperCase()));
  return normalized.has("IP") && normalized.has("ER") && normalized.has("K");
}

function buildMlbBatterLeader(teamInfo: any, section: any): { leader: Leader; teamLeader: DerivedTeamLeaders[number] } | null {
  const labels = (section?.labels || []).map((label: any) => cleanValue(String(label)));
  const athletes = section?.athletes || [];
  if (!labels.length || !athletes.length) return null;

  let bestEntry: any = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const athleteEntry of athletes) {
    const stats = (athleteEntry?.stats || []).map((value: any) => cleanValue(String(value)));
    const rbi = parseNumericStat(getLabeledStat(labels, stats, "RBI"));
    const hr = parseNumericStat(getLabeledStat(labels, stats, "HR"));
    const hits = parseNumericStat(getLabeledStat(labels, stats, "H"));
    const runs = parseNumericStat(getLabeledStat(labels, stats, "R"));
    const walks = parseNumericStat(getLabeledStat(labels, stats, "BB"));
    const strikeouts = parseNumericStat(getLabeledStat(labels, stats, "K"));
    const score = rbi * 8 + hr * 7 + hits * 4 + runs * 3 + walks - strikeouts * 0.15;

    if (score > bestScore) {
      bestScore = score;
      bestEntry = athleteEntry;
    }
  }

  if (!bestEntry) return null;

  const athlete = bestEntry.athlete || {};
  const stats = (bestEntry.stats || []).map((value: any) => cleanValue(String(value)));
  const hAb = getLabeledStat(labels, stats, "H-AB");
  const rbi = parseNumericStat(getLabeledStat(labels, stats, "RBI"));
  const hr = parseNumericStat(getLabeledStat(labels, stats, "HR"));
  const hits = parseNumericStat(getLabeledStat(labels, stats, "H"));
  const runs = parseNumericStat(getLabeledStat(labels, stats, "R"));

  const parts = [hAb];
  if (hr > 0) parts.push(`${hr} HR`);
  if (rbi > 0) parts.push(`${rbi} RBI`);
  if (hits > 0 && !parts.some((part) => part.includes("H"))) parts.push(`${hits} H`);
  if (runs > 0) parts.push(`${runs} R`);

  const value = parts.filter(Boolean).slice(0, 3).join(" | ") || hAb || `${hits} H`;
  const headshot = athlete.headshot || "";
  const name = String(athlete.displayName || athlete.shortName || "");

  return {
    leader: {
      team: String(teamInfo?.displayName || ""),
      teamAbbr: String(teamInfo?.abbreviation || ""),
      category: "Batting",
      name,
      value,
      headshot,
    },
    teamLeader: {
      category: "Batting",
      name,
      value,
      headshot,
    },
  };
}

function buildMlbPitcherLeader(teamInfo: any, section: any): { leader: Leader; teamLeader: DerivedTeamLeaders[number] } | null {
  const labels = (section?.labels || []).map((label: any) => cleanValue(String(label)));
  const athletes = section?.athletes || [];
  if (!labels.length || !athletes.length) return null;

  let bestEntry: any = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const athleteEntry of athletes) {
    const stats = (athleteEntry?.stats || []).map((value: any) => cleanValue(String(value)));
    const outs = parseBaseballInningsToOuts(getLabeledStat(labels, stats, "IP"));
    const strikeouts = parseNumericStat(getLabeledStat(labels, stats, "K"));
    const earnedRuns = parseNumericStat(getLabeledStat(labels, stats, "ER"));
    const walks = parseNumericStat(getLabeledStat(labels, stats, "BB"));
    const hitsAllowed = parseNumericStat(getLabeledStat(labels, stats, "H"));
    const score = strikeouts * 4 + outs * 1.75 - earnedRuns * 6 - walks * 1.5 - hitsAllowed * 0.75;

    if (score > bestScore) {
      bestScore = score;
      bestEntry = athleteEntry;
    }
  }

  if (!bestEntry) return null;

  const athlete = bestEntry.athlete || {};
  const stats = (bestEntry.stats || []).map((value: any) => cleanValue(String(value)));
  const inningsPitched = getLabeledStat(labels, stats, "IP");
  const strikeouts = parseNumericStat(getLabeledStat(labels, stats, "K"));
  const earnedRuns = parseNumericStat(getLabeledStat(labels, stats, "ER"));
  const hitsAllowed = parseNumericStat(getLabeledStat(labels, stats, "H"));

  const parts = [];
  if (inningsPitched) parts.push(`${inningsPitched} IP`);
  if (strikeouts > 0) parts.push(`${strikeouts} K`);
  parts.push(`${earnedRuns} ER`);
  if (hitsAllowed > 0) parts.push(`${hitsAllowed} H`);

  const value = parts.filter(Boolean).slice(0, 3).join(" | ");
  const headshot = athlete.headshot || "";
  const name = String(athlete.displayName || athlete.shortName || "");

  return {
    leader: {
      team: String(teamInfo?.displayName || ""),
      teamAbbr: String(teamInfo?.abbreviation || ""),
      category: "Pitching",
      name,
      value,
      headshot,
    },
    teamLeader: {
      category: "Pitching",
      name,
      value,
      headshot,
    },
  };
}

function deriveMlbFallbackLeaders(summary: any): DerivedLeadersPayload {
  const byTeamKey: Record<string, DerivedTeamLeaders> = {};
  const leaders: Leader[] = [];
  const boxPlayers = summary?.boxscore?.players || [];

  for (const teamBox of boxPlayers) {
    const teamInfo = teamBox?.team || {};
    const teamLeaders: DerivedTeamLeaders = [];
    const sections = teamBox?.statistics || [];

    const battingSection = sections.find((section: any) => isMlbBattingSection((section?.labels || []).map((label: any) => String(label))));
    const pitchingSection = sections.find((section: any) => isMlbPitchingSection((section?.labels || []).map((label: any) => String(label))));

    const battingLeader = buildMlbBatterLeader(teamInfo, battingSection);
    const pitchingLeader = buildMlbPitcherLeader(teamInfo, pitchingSection);

    for (const candidate of [battingLeader, pitchingLeader]) {
      if (!candidate) continue;
      leaders.push(candidate.leader);
      teamLeaders.push(candidate.teamLeader);
    }

    registerTeamLeaders(byTeamKey, teamInfo, teamLeaders);
  }

  return { leaders, byTeamKey };
}

function buildLeaderMergeKey(entry: { category: string; team?: string; teamAbbr?: string }): string {
  const teamKey = cleanValue(entry.teamAbbr || entry.team || "").toUpperCase();
  const categoryKey = cleanValue(entry.category).toUpperCase();
  return `${teamKey}::${categoryKey}`;
}

function mergeLeaders(primary: Leader[], fallback: Leader[]): Leader[] {
  if (!fallback.length) return primary;
  const merged = [...primary];
  const seen = new Set(primary.map((entry) => buildLeaderMergeKey(entry)));

  for (const entry of fallback) {
    const key = buildLeaderMergeKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }

  return merged;
}

function mergeTeamLeaderItems(
  primary: TeamDetail["leaders"],
  fallback: TeamDetail["leaders"],
): TeamDetail["leaders"] {
  if (!fallback.length) return primary;
  const merged = [...primary];
  const seen = new Set(primary.map((entry) => cleanValue(entry.category).toUpperCase()));

  for (const entry of fallback) {
    const key = cleanValue(entry.category).toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }

  return merged;
}

async function fetchJsonNoStore(url: string): Promise<any | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchNbaRoster(teamId: string): Promise<any[]> {
  const cacheKey = cleanValue(teamId);
  if (!cacheKey) return [];
  if (nbaRosterCache.has(cacheKey)) {
    return nbaRosterCache.get(cacheKey) || [];
  }

  const payload = await fetchJsonNoStore(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${encodeURIComponent(cacheKey)}/roster`,
  );
  const athletes = Array.isArray(payload?.athletes) ? payload.athletes : [];
  nbaRosterCache.set(cacheKey, athletes);
  return athletes;
}

function readNbaStatValue(payload: any, statName: string): number {
  const categories = payload?.splits?.categories || [];
  for (const category of categories) {
    for (const stat of category?.stats || []) {
      if (stat?.name === statName) {
        return Number(stat?.value || 0);
      }
    }
  }
  return 0;
}

function formatNbaLeaderValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value >= 10) {
    return value.toFixed(1).replace(/\.0$/, "");
  }
  return value.toFixed(1);
}

async function fetchNbaAthleteAverages(
  athleteId: string,
  seasonYear: number,
  seasonType: number,
): Promise<Record<string, number> | null> {
  const cleanId = cleanValue(athleteId);
  if (!cleanId) return null;

  const cacheKey = `${seasonYear}-${seasonType}-${cleanId}`;
  if (nbaAthleteStatCache.has(cacheKey)) {
    return nbaAthleteStatCache.get(cacheKey) || null;
  }

  const payload = await fetchJsonNoStore(
    `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${seasonYear}/types/${seasonType}/athletes/${encodeURIComponent(cleanId)}/statistics/0?lang=en&region=us`,
  );

  if (!payload) {
    nbaAthleteStatCache.set(cacheKey, null);
    return null;
  }

  const gamesPlayed = readNbaStatValue(payload, "gamesPlayed");
  if (!gamesPlayed) {
    nbaAthleteStatCache.set(cacheKey, null);
    return null;
  }

  const averages = {
    points: readNbaStatValue(payload, "points") / gamesPlayed,
    assists: readNbaStatValue(payload, "assists") / gamesPlayed,
    rebounds: readNbaStatValue(payload, "rebounds") / gamesPlayed,
    steals: readNbaStatValue(payload, "steals") / gamesPlayed,
    blocks: readNbaStatValue(payload, "blocks") / gamesPlayed,
  };

  nbaAthleteStatCache.set(cacheKey, averages);
  return averages;
}

async function deriveNbaFallbackLeaders(summary: any): Promise<DerivedLeadersPayload> {
  const headerSeason = summary?.header?.season || {};
  const competition = (summary?.header?.competitions || [])[0] || {};
  const competitors = competition?.competitors || [];
  const seasonYear = Number(headerSeason?.year || new Date(competition?.date || Date.now()).getUTCFullYear());
  const seasonType = Number(headerSeason?.type || 2);
  const categoryDefs = [
    { label: "Points", statKey: "points" },
    { label: "Assists", statKey: "assists" },
    { label: "Rebounds", statKey: "rebounds" },
    { label: "Steals", statKey: "steals" },
    { label: "Blocks", statKey: "blocks" },
  ] as const;
  const currentCategories = new Set<string>();

  for (const group of summary?.leaders || []) {
    for (const leaderCategory of group?.leaders || []) {
      currentCategories.add(cleanValue(leaderCategory?.displayName || leaderCategory?.name || "").toUpperCase());
    }
  }

  const missingCategories = categoryDefs.filter(
    (definition) => !currentCategories.has(definition.label.toUpperCase()),
  );
  if (!missingCategories.length) {
    return { leaders: [], byTeamKey: {} };
  }

  const leaders: Leader[] = [];
  const byTeamKey: Record<string, DerivedTeamLeaders> = {};

  await Promise.all(
    competitors.map(async (competitor: any) => {
      const teamInfo = competitor?.team || {};
      const roster = await fetchNbaRoster(String(teamInfo?.id || ""));
      if (!roster.length) return;

      const athleteRows = (
        await Promise.all(
          roster.map(async (athlete: any) => ({
            athlete,
            averages: await fetchNbaAthleteAverages(
              String(athlete?.id || ""),
              seasonYear,
              seasonType,
            ),
          })),
        )
      ).filter((entry) => entry.averages);

      if (!athleteRows.length) return;

      const teamLeaders: DerivedTeamLeaders = [];

      for (const definition of categoryDefs) {
        let bestEntry: (typeof athleteRows)[number] | null = null;
        let bestValue = Number.NEGATIVE_INFINITY;

        for (const entry of athleteRows) {
          const value = Number(entry.averages?.[definition.statKey] || 0);
          if (value > bestValue) {
            bestValue = value;
            bestEntry = entry;
          }
        }

        if (!bestEntry || !Number.isFinite(bestValue) || bestValue <= 0) {
          continue;
        }

        const name = cleanValue(bestEntry.athlete?.displayName || bestEntry.athlete?.shortName || "");
        const value = formatNbaLeaderValue(bestValue);
        const headshot = bestEntry.athlete?.headshot || "";
        const leader: Leader = {
          team: String(teamInfo?.displayName || ""),
          teamAbbr: String(teamInfo?.abbreviation || ""),
          category: definition.label,
          name,
          value,
          headshot,
        };

        leaders.push(leader);
        teamLeaders.push({
          category: definition.label,
          name,
          value,
          headshot,
        });
      }

      registerTeamLeaders(byTeamKey, teamInfo, teamLeaders);
    }),
  );

  return { leaders, byTeamKey };
}

async function deriveFallbackLeaders(summary: any, league: string): Promise<DerivedLeadersPayload> {
  if (league === "MLB") {
    return deriveMlbFallbackLeaders(summary);
  }
  if (league === "NBA") {
    return deriveNbaFallbackLeaders(summary);
  }
  return { leaders: [], byTeamKey: {} };
}

function parseSummaryLeaders(summary: any): Leader[] {
  const leaderGroups = summary?.leaders || [];
  const leaders: Leader[] = [];
  for (const leaderGroup of leaderGroups) {
    const teamInfo = leaderGroup.team || {};
    for (const leaderCategory of leaderGroup.leaders || []) {
      const top = (leaderCategory.leaders || [])[0];
      if (!top) continue;
      const athlete = top.athlete || {};
      leaders.push({
        team: String(teamInfo.displayName || ""),
        teamAbbr: String(teamInfo.abbreviation || ""),
        category: String(leaderCategory.displayName || leaderCategory.name || ""),
        name: String(athlete.displayName || ""),
        value: String(top.displayValue || ""),
        headshot: athlete.headshot || "",
      });
    }
  }
  return leaders;
}

function parseSummaryPlays(summary: any): Play[] {
  const rawPlays = [...(summary?.plays || [])];
  if (!rawPlays.length && summary?.drives) {
    for (const drive of summary.drives.previous || []) {
      rawPlays.push(...(drive?.plays || []));
    }
  }

  return rawPlays.reverse().map((play: any) => {
    const clock = play.clock || {};
    const period = play.period || {};
    const participants = play.participants || [];
    const athlete = participants[0]?.athlete || play.athlete || {};
    const secondaryAthlete = participants[1]?.athlete || {};
    const team = play.team || {};
    return {
      id: String(play.id || ""),
      text: String(play.text || play.description || ""),
      shortText: String(play.shortText || ""),
      type: String(play.type?.text || ""),
      clock: String(clock.displayValue || clock.value || ""),
      period: Number(period.number || 0),
      periodText: String(period.displayValue || ""),
      scoreValue: Number(play.scoreValue || 0),
      scoringPlay: Boolean(play.scoringPlay),
      homeScore: String(play.homeScore || ""),
      awayScore: String(play.awayScore || ""),
      team: String(team.displayName || ""),
      teamLogo: getTeamLogoUrl(team),
      playTeamName: String(team.displayName || ""),
      playTeamLogo: getTeamLogoUrl(team),
      athleteName: String(athlete.displayName || ""),
      athleteHeadshot: getHeadshotUrl(athlete.headshot || ""),
      athlete2Name: String(secondaryAthlete.displayName || ""),
      athlete2Headshot: getHeadshotUrl(secondaryAthlete.headshot || ""),
    };
  });
}

async function fetchDirectGameDetail(eventId: string, league: string, dateParam: string): Promise<GameDetailResponse | null> {
  const summaryPath = DIRECT_ESPN_SUMMARY_PATHS[league.toUpperCase()];
  if (!summaryPath) return null;

  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${summaryPath}/summary?event=${eventId}`, {
    cache: "no-store",
  });
  if (!response.ok) return null;
  const summary = await response.json();
  const game = buildGameDataFromSummary(summary, league.toUpperCase(), eventId);
  if (!game) return null;

  const summaryDateParam =
    normalizeActivityDateParam(dateParam) ||
    normalizeActivityDateParam(String(summary?.header?.competitions?.[0]?.date || ""));

  let plays: Play[] = [];
  const candidateDates = Array.from(
    new Set(
      [
        normalizeActivityDateParam(dateParam),
        summaryDateParam,
        shiftActivityDateParam(summaryDateParam, -1),
        shiftActivityDateParam(summaryDateParam, 1),
      ].filter(Boolean),
    ),
  );

  for (const candidateDate of candidateDates) {
    try {
      const activityResp = await apiClient.get(API.ESPN_ACTIVITY, {
        params: { league: league.toUpperCase(), date: candidateDate, limit: 20000 },
      });
      const rawActivities = Array.isArray(activityResp.data?.activities) ? activityResp.data.activities : [];
      const matchingActivities = rawActivities.filter((item: any) => String(item?.gameId || "") === String(eventId));
      if (matchingActivities.length) {
        plays = matchingActivities;
        break;
      }
    } catch {
      /* Try the next candidate day if this one fails. */
    }
  }

  if (!plays.length) {
    plays = parseSummaryPlays(summary);
  }

  let leaders = parseSummaryLeaders(summary);
  const derivedLeaders = await deriveFallbackLeaders(summary, league.toUpperCase());
  leaders = mergeLeaders(leaders, derivedLeaders.leaders);
  game.homeDetail = {
    ...game.homeDetail,
    leaders: mergeTeamLeaderItems(
      game.homeDetail.leaders,
      resolveDerivedTeamLeaders(game.homeDetail, derivedLeaders.byTeamKey),
    ),
  };
  game.awayDetail = {
    ...game.awayDetail,
    leaders: mergeTeamLeaderItems(
      game.awayDetail.leaders,
      resolveDerivedTeamLeaders(game.awayDetail, derivedLeaders.byTeamKey),
    ),
  };

  return {
    game,
    plays,
    boxScore: parseSummaryBoxScore(summary),
    leaders,
  };
}

export default function GameDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const leagueParam = cleanValue(searchParams.get("league")).toUpperCase();
  const dateParam = normalizeActivityDateParam(searchParams.get("date"));
  const [activeTab, setActiveTab] = useState<Tab>("plays");
  const [initializedGameId, setInitializedGameId] = useState("");
  const gameKey = `${id || ""}:${leagueParam || ""}:${dateParam || ""}`;

  const { data, isLoading } = useQuery<GameDetailResponse>({
    queryKey: ["espn-game", id, leagueParam, dateParam],
    queryFn: async () => {
      if (!id) {
        return { game: null, plays: [], boxScore: [], leaders: [], error: "Game not found" };
      }

      let directData: GameDetailResponse | null = null;
      if (leagueParam) {
        try {
          directData = await fetchDirectGameDetail(id, leagueParam, dateParam);
          if (directData?.game) return directData;
        } catch {
          directData = null;
        }
      }

      try {
        const params = leagueParam ? { league: leagueParam } : undefined;
        const res = await apiClient.get(`${API.ESPN_GAME}/${id}`, { params });
        if (res.data?.game) return res.data;
      } catch {
        /* Fall through to the direct ESPN summary fallback below. */
      }

      return directData ?? { game: null, plays: [], boxScore: [], leaders: [], error: "Game not found" };
    },
    enabled: !!id,
    placeholderData: (previousData) => previousData,
    refetchInterval: 10000, // 10s for near-real-time
  });

  useEffect(() => {
    if (!id || initializedGameId === gameKey) return;
    if (!data?.game) return;

    if (data.game.status === "upcoming") {
      setActiveTab("info");
    } else if (data.plays.length > 0) {
      setActiveTab("plays");
    } else if (data.boxScore.length > 0) {
      setActiveTab("boxscore");
    } else if (data.leaders.length > 0) {
      setActiveTab("leaders");
    } else {
      setActiveTab("info");
    }

    setInitializedGameId(gameKey);
  }, [id, gameKey, initializedGameId, data?.game, data?.plays.length, data?.boxScore.length, data?.leaders.length]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-4xl mx-auto px-4 py-4">
          {/* Skeleton header */}
          <div className="flex items-center gap-2 mb-4">
            <div className="w-5 h-5 skeleton-pulse rounded" />
            <div className="w-12 h-4 skeleton-pulse" />
          </div>
          {/* Skeleton score area */}
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-14 h-14 skeleton-pulse rounded-2xl" />
              <div>
                <div className="w-10 h-4 skeleton-pulse mb-1" />
                <div className="w-16 h-3 skeleton-pulse" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-8 skeleton-pulse" />
              <div className="w-4 h-6 skeleton-pulse" />
              <div className="w-10 h-8 skeleton-pulse" />
            </div>
            <div className="flex items-center gap-3 flex-1 justify-end">
              <div>
                <div className="w-10 h-4 skeleton-pulse mb-1" />
                <div className="w-16 h-3 skeleton-pulse" />
              </div>
              <div className="w-14 h-14 skeleton-pulse rounded-2xl" />
            </div>
          </div>
          {/* Skeleton tabs */}
          <div className="flex gap-1 mt-3">
            {[1,2,3,4].map(i => <div key={i} className="flex-1 h-9 skeleton-pulse rounded-lg" />)}
          </div>
          {/* Skeleton content */}
          <div className="mt-5 space-y-2">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-surface border border-muted/8">
                <div className="w-10 h-10 skeleton-pulse rounded-full flex-shrink-0" />
                <div className="flex-1">
                  <div className="w-24 h-3 skeleton-pulse mb-2" />
                  <div className="w-full h-4 skeleton-pulse mb-1" />
                  <div className="w-20 h-3 skeleton-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!data?.game) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <IconVenue />
          <p className="text-foreground text-lg font-medium">Game not found</p>
          <p className="text-muted text-sm">This game may not be available yet.</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-2 px-6 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const game = data.game;
  const isLive = game.status === "live";
  const home = game.homeDetail;
  const away = game.awayDetail;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "plays", label: "Play-by-Play", icon: <IconPlayByPlay /> },
    { key: "boxscore", label: "Box Score", icon: <IconBoxScore /> },
    { key: "leaders", label: "Leaders", icon: <IconLeaders /> },
    { key: "info", label: "Game Info", icon: <IconInfo /> },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* ── Sticky Game Header ── */}
      <div className="sticky top-14 z-30 border-b border-muted/15" style={{
        background: `linear-gradient(135deg, #${home.color || '1a1a2e'}22, #0B0E19 50%, #${away.color || '1a1a2e'}22)`,
        backdropFilter: 'blur(16px)',
      }}>
        <div className="max-w-4xl mx-auto px-4 py-4">
          {/* League + Status bar */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(-1)}
                className="text-muted hover:text-foreground transition-colors mr-1"
              >
                <IconBack />
              </button>
              <span className="text-sm font-medium text-accent">{game.league}</span>
              {game.broadcasts.length > 0 && (
                <span className="text-xs text-muted hidden sm:inline">· {game.broadcasts.join(", ")}</span>
              )}
            </div>
            {isLive ? (
              <div className="flex items-center gap-2">
                <LiveBadge />
                <span className="text-accent text-sm font-bold">{game.statusDetail}</span>
              </div>
            ) : (
              <span className="text-sm font-medium text-muted">
                {game.status === "final" ? "FINAL" : game.statusDetail}
              </span>
            )}
          </div>

          {/* ── Score & Teams ── */}
          <div className="flex items-center justify-between gap-2">
            {/* Away team */}
            <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
              <GameHeadshotImg
                src={game.awayBadge || away.logo}
                fallbackSrc={away.logo || game.awayBadge}
                alt={game.awayTeam}
                className="w-10 h-10 sm:w-14 sm:h-14 rounded-2xl flex-shrink-0"
                renderMode="badge"
              />
              <div className="min-w-0">
                <p className="text-foreground font-bold text-sm sm:text-base truncate">{game.awayAbbr}</p>
                {away.record && <p className="text-muted text-[10px] sm:text-xs">{away.record}</p>}
              </div>
            </div>

            {/* Scores */}
            <div className="flex items-center gap-3 px-2 sm:px-4 flex-shrink-0">
              <span className={`text-2xl sm:text-4xl font-black tabular-nums ${
                game.awayScore > game.homeScore ? "text-foreground" : "text-muted"
              }`}>
                {game.status === "upcoming" ? "" : game.awayScore}
              </span>
              <span className="text-muted text-lg font-light">
                {game.status === "upcoming" ? "VS" : "-"}
              </span>
              <span className={`text-2xl sm:text-4xl font-black tabular-nums ${
                game.homeScore > game.awayScore ? "text-foreground" : "text-muted"
              }`}>
                {game.status === "upcoming" ? "" : game.homeScore}
              </span>
            </div>

            {/* Home team */}
            <div className="flex items-center gap-2 sm:gap-3 flex-1 justify-end text-right min-w-0">
              <div className="min-w-0">
                <p className="text-foreground font-bold text-sm sm:text-base truncate">{game.homeAbbr}</p>
                {home.record && <p className="text-muted text-[10px] sm:text-xs">{home.record}</p>}
              </div>
              <GameHeadshotImg
                src={game.homeBadge || home.logo}
                fallbackSrc={home.logo || game.homeBadge}
                alt={game.homeTeam}
                className="w-10 h-10 sm:w-14 sm:h-14 rounded-2xl flex-shrink-0"
                renderMode="badge"
              />
            </div>
          </div>

          {/* ── Linescore ── */}
          {(home.linescores?.length > 0 || away.linescores?.length > 0) && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[11px] text-center">
                <thead>
                  <tr className="text-muted">
                    <th className="text-left py-0.5 pr-3 font-medium w-10">Team</th>
                    {(home.linescores || away.linescores || []).map((_, i) => (
                      <th key={i} className="px-1.5 py-0.5 font-medium min-w-[24px]">{i + 1}</th>
                    ))}
                    <th className="px-2 py-0.5 font-bold">T</th>
                  </tr>
                </thead>
                <tbody className="text-foreground-base">
                  <tr>
                    <td className="text-left py-0.5 pr-3 font-medium text-foreground">{away.abbreviation}</td>
                    {(away.linescores || []).map((s, i) => (
                      <td key={i} className="px-1.5 py-0.5">{s}</td>
                    ))}
                    <td className="px-2 py-0.5 font-bold text-foreground">{game.awayScore}</td>
                  </tr>
                  <tr>
                    <td className="text-left py-0.5 pr-3 font-medium text-foreground">{home.abbreviation}</td>
                    {(home.linescores || []).map((s, i) => (
                      <td key={i} className="px-1.5 py-0.5">{s}</td>
                    ))}
                    <td className="px-2 py-0.5 font-bold text-foreground">{game.homeScore}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* ── Tabs ── */}
          <div className="flex gap-1 mt-3">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                  activeTab === tab.key
                    ? "bg-accent text-white"
                    : "text-muted hover:text-foreground hover:bg-surface/50"
                }`}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab Content ── */}
      <main className="max-w-4xl mx-auto px-4 py-5 game-detail-enter">
        <div key={activeTab} className="tab-content-enter">
          {activeTab === "plays" && <PlaysTab plays={data.plays} game={game} />}
          {activeTab === "boxscore" && <BoxScoreTab boxScore={data.boxScore} league={game.league} />}
          {activeTab === "leaders" && <LeadersTab leaders={data.leaders} homeDetail={home} awayDetail={away} league={game.league} />}
          {activeTab === "info" && <InfoTab game={game} />}
        </div>
      </main>

      <Footer />
    </div>
  );
}

/* ── Play-by-Play Tab ── */
function formatPlayMeta(play: Play): string {
  const detail = cleanValue(play.statusDetail);
  if (detail) return detail;

  const periodText = cleanValue(play.periodText);
  const clock = cleanValue(play.clock);
  if (periodText && clock) return `${periodText} ${clock}`;
  return periodText || clock;
}

function hasScoreSnapshot(play: Play): boolean {
  return cleanValue(String(play.homeScore)) !== "" && cleanValue(String(play.awayScore)) !== "";
}

function PlayAvatarGroup({ play, game }: { play: Play; game: GameData }) {
  const primaryName = cleanValue(play.athleteName);
  const secondaryName = cleanValue(play.athlete2Name);
  const primaryHeadshot = cleanValue(play.athleteHeadshot);
  const secondaryHeadshot = cleanValue(play.athlete2Headshot);
  const teamLogo = cleanValue(play.playTeamLogo || play.teamLogo);
  const teamName = cleanValue(play.playTeamName || play.team);
  const primaryFallbackLogo = teamLogo || cleanValue(game.awayBadge) || cleanValue(game.homeBadge);
  const secondaryFallbackLogo = teamLogo || primaryFallbackLogo;

  if ((primaryName || primaryHeadshot) && (secondaryName || secondaryHeadshot)) {
    return (
      <div className="flex items-center -space-x-2.5 flex-shrink-0 mt-0.5">
        <GameHeadshotImg
          src={primaryHeadshot}
          alt={primaryName}
          league={game.league}
          teamName={teamName}
          fallbackSrc={primaryFallbackLogo}
          className="w-10 h-10 rounded-full"
        />
        <GameHeadshotImg
          src={secondaryHeadshot}
          alt={secondaryName}
          league={game.league}
          teamName={teamName}
          fallbackSrc={secondaryFallbackLogo}
          className="w-10 h-10 rounded-full"
        />
      </div>
    );
  }

  if (primaryName || primaryHeadshot) {
    return (
      <GameHeadshotImg
        src={primaryHeadshot}
        alt={primaryName}
        league={game.league}
        teamName={teamName}
        fallbackSrc={primaryFallbackLogo}
        className="w-10 h-10 rounded-full flex-shrink-0 mt-0.5"
      />
    );
  }

  if (teamLogo) {
    return (
      <GameHeadshotImg
        src={teamLogo}
        alt={teamName || game.homeAbbr || game.awayAbbr}
        className="w-10 h-10 rounded-full flex-shrink-0 mt-0.5"
        renderMode="badge"
      />
    );
  }

  return (
    <div className="w-10 h-10 rounded-full border border-muted/15 bg-background/70 flex items-center justify-center flex-shrink-0 mt-0.5">
      <IconClock />
    </div>
  );
}

function PlaysTab({ plays, game }: { plays: Play[]; game: GameData }) {
  if (plays.length === 0) {
    return (
      <div className="bg-surface border border-muted/15 rounded-xl p-8 text-center">
        <IconPlayByPlay />
        <p className="text-foreground font-medium mt-3">
          {game.status === "upcoming"
            ? "Play-by-play will be available once the game starts"
            : "No play-by-play data available for this game"}
        </p>
        <p className="text-muted text-sm mt-1">Check back during the game for live updates</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <h3 className="text-foreground font-semibold mb-3 flex items-center gap-2">
        <IconPlayByPlay /> Play-by-Play
        {game.status === "live" && (
          <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full animate-pulse font-bold">LIVE</span>
        )}
      </h3>
      {plays.map((play, idx) => {
        const playMeta = formatPlayMeta(play);
        const playTeamName = cleanValue(play.playTeamName || play.team);
                  const playStats = sanitizeRenderedStatLine(play.athleteStats);
        const scoreVisible = hasScoreSnapshot(play);
        return (
          <div
            key={play.id || idx}
            className={`rounded-lg px-3 py-3 transition-colors ${
              play.scoringPlay
                ? "bg-accent/8 border border-accent/15"
                : "bg-surface border border-muted/8 hover:border-muted/15"
            }`}
          >
            <div className="flex items-start gap-3">
              <PlayAvatarGroup play={play} game={game} />

              <div className="flex-1 min-w-0">
                {playTeamName && (
                  <p className="text-xs text-muted font-medium mb-0.5">{playTeamName}</p>
                )}
                <p className={`text-sm leading-snug ${play.scoringPlay ? "text-foreground font-medium" : "text-foreground-base"}`}>
                  {cleanValue(play.text || play.shortText)}
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                  {playMeta && (
                    <span className="text-[11px] text-muted font-mono">{playMeta}</span>
                  )}
                  {playStats && (
                    <span className="text-[11px] text-accent font-medium">{playStats}</span>
                  )}
                </div>
              </div>

              {scoreVisible && (
                <div className="flex-shrink-0 text-right pl-3">
                  <div className="text-[11px] text-muted font-medium">{game.awayAbbr}</div>
                  <div className="text-sm font-bold tabular-nums text-foreground">{play.awayScore}</div>
                  <div className="mt-1 text-[11px] text-muted font-medium">{game.homeAbbr}</div>
                  <div className="text-sm font-bold tabular-nums text-foreground">{play.homeScore}</div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Box Score Tab ── */
function BoxScoreTab({ boxScore, league }: { boxScore: BoxScoreTeam[]; league: string }) {
  const [expandedTeam, setExpandedTeam] = useState<number>(0);

  if (boxScore.length === 0) {
    return (
      <div className="bg-surface border border-muted/15 rounded-xl p-8 text-center">
        <IconBoxScore />
        <p className="text-foreground font-medium mt-3">Box score not available yet</p>
        <p className="text-muted text-sm mt-1">Stats will appear once the game is underway</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {boxScore.map((team, i) => (
          <button
            key={team.teamAbbr}
            onClick={() => setExpandedTeam(i)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              expandedTeam === i
                ? "bg-accent text-white"
                : "bg-surface border border-muted/20 text-muted hover:text-foreground"
            }`}
          >
            {team.teamLogo && (
              <GameHeadshotImg
                src={team.teamLogo}
                alt={team.teamAbbr || team.teamName}
                className="w-5 h-5 rounded-full flex-shrink-0"
                renderMode="badge"
              />
            )}
            {team.teamName}
          </button>
        ))}
      </div>

      {boxScore[expandedTeam] && (
        <div className="bg-surface border border-muted/15 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-background/50">
                  <th className="text-left py-2 px-3 text-muted font-medium sticky left-0 bg-background/95 z-10 min-w-[130px]">
                    Player
                  </th>
                  {boxScore[expandedTeam].labels.slice(0, 10).map((label) => (
                    <th key={label} className="py-2 px-2 text-muted font-medium text-center min-w-[36px]">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-muted/8">
                {boxScore[expandedTeam].players.map((player, i) => {
                  const hsUrl = getHeadshotUrl(player.headshot);
                  return (
                    <tr key={i} className="hover:bg-background/30 transition-colors box-row-enter" style={{ animationDelay: `${i * 30}ms` }}>
                      <td className="py-1.5 px-3 sticky left-0 bg-surface z-10">
                        <div className="flex items-center gap-2">
                          <GameHeadshotImg
                            src={hsUrl}
                            alt={player.shortName || player.name}
                            league={league}
                            teamName={boxScore[expandedTeam].teamName}
                            className="w-6 h-6 rounded-full flex-shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-foreground font-medium text-xs truncate max-w-[90px]">
                              {player.shortName || player.name}
                            </p>
                            {player.position && (
                              <p className="text-muted text-[9px]">{player.position}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      {boxScore[expandedTeam].labels.slice(0, 10).map((label) => (
                        <td key={label} className="py-1.5 px-2 text-center text-foreground-base text-xs tabular-nums">
                          {player.stats[label] || "-"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Leaders Tab ── */
function LeadersTab({ leaders, homeDetail, awayDetail, league }: { leaders: Leader[]; homeDetail: TeamDetail; awayDetail: TeamDetail; league: string }) {
  const fallbackLeaders: Leader[] = [
    ...(homeDetail.leaders || []).map((leader) => ({
      team: homeDetail.name,
      teamAbbr: homeDetail.abbreviation,
      category: leader.category,
      name: leader.name,
      value: leader.value,
      headshot: leader.headshot,
    })),
    ...(awayDetail.leaders || []).map((leader) => ({
      team: awayDetail.name,
      teamAbbr: awayDetail.abbreviation,
      category: leader.category,
      name: leader.name,
      value: leader.value,
      headshot: leader.headshot,
    })),
  ];
  const displayLeaders = leaders.length ? leaders : fallbackLeaders;

  if (displayLeaders.length === 0) {
    return (
      <div className="bg-surface border border-muted/15 rounded-xl p-8 text-center">
        <IconLeaders />
        <p className="text-foreground font-medium mt-3">Leaders not available yet</p>
        <p className="text-muted text-sm mt-1">Top performers will appear during the game</p>
      </div>
    );
  }

  const categories = new Map<string, Leader[]>();
  for (const l of displayLeaders) {
    const existing = categories.get(l.category) || [];
    existing.push(l);
    categories.set(l.category, existing);
  }

  const splitLeaderValue = (value: string) =>
    cleanValue(value)
      .split("|")
      .map((segment) => cleanValue(segment))
      .filter(Boolean);

  return (
    <div className="space-y-4">
      <h3 className="text-foreground font-semibold flex items-center gap-2">
        <IconLeaders /> Game Leaders
      </h3>
      {Array.from(categories.entries()).map(([category, players]) => (
        <div key={category} className="bg-surface border border-muted/15 rounded-2xl p-4 sm:p-5">
          <h4 className="text-xs text-accent font-medium mb-4 uppercase tracking-[0.18em]">{category}</h4>
          <div className="grid gap-3 md:grid-cols-2">
            {players.map((player, i) => {
              const hsUrl = getHeadshotUrl(player.headshot);
              const statSegments = splitLeaderValue(player.value);
              return (
                <div
                  key={i}
                  className="rounded-xl border border-muted/10 bg-background/45 p-4 shadow-[0_0_0_1px_rgba(80,120,255,0.04)] flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0 sm:flex-1">
                    <GameHeadshotImg
                      src={hsUrl}
                      alt={player.name}
                      league={league}
                      teamName={player.team}
                      className="w-12 h-12 rounded-full flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground font-semibold text-lg leading-tight truncate">{player.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-accent text-xs font-semibold uppercase tracking-[0.16em]">
                          {player.teamAbbr || player.team}
                        </span>
                        <span className="text-muted/60 text-xs">•</span>
                        <span className="text-muted text-xs truncate">{player.team}</span>
                      </div>
                    </div>
                  </div>

                  {statSegments.length > 0 ? (
                    <div className="flex flex-wrap gap-2 sm:max-w-[48%] sm:justify-end">
                      {statSegments.map((segment) => (
                        <span
                          key={`${player.name}-${segment}`}
                          className="rounded-full border border-accent/15 bg-accent/8 px-3 py-1.5 text-sm font-semibold text-foreground"
                        >
                          {segment}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-lg font-bold text-foreground sm:text-right">{player.value}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Game Info Tab ── */
function InfoTab({ game }: { game: GameData }) {
  return (
    <div className="space-y-4">
      <div className="bg-surface border border-muted/15 rounded-xl p-5">
        <h3 className="text-foreground font-semibold mb-3 flex items-center gap-2">
          <IconVenue /> Venue
        </h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <InfoRow label="Stadium" value={game.venue.name} />
          <InfoRow label="Location" value={[game.venue.city, game.venue.state].filter(Boolean).join(", ")} />
          <InfoRow label="Date" value={new Date(game.dateEvent + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} />
          <InfoRow label="Status" value={game.statusDetail} />
        </div>
      </div>

      {game.odds && (
        <div className="bg-surface border border-muted/15 rounded-xl p-5">
          <h3 className="text-foreground font-semibold mb-3 flex items-center gap-2">
            <IconOdds /> Odds
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <InfoRow label="Line" value={game.odds.details} />
            <InfoRow label="Over/Under" value={String(game.odds.overUnder)} />
          </div>
        </div>
      )}

      {game.broadcasts.length > 0 && (
        <div className="bg-surface border border-muted/15 rounded-xl p-5">
          <h3 className="text-foreground font-semibold mb-3 flex items-center gap-2">
            <IconTV /> Broadcast
          </h3>
          <div className="flex flex-wrap gap-2">
            {game.broadcasts.map((b, i) => (
              <span key={i} className="bg-background/50 border border-muted/20 text-foreground-base px-3 py-1.5 rounded-lg text-sm">
                {b}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted text-xs">{label}</span>
      <p className="text-foreground-base">{value || "—"}</p>
    </div>
  );
}

