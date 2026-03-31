/**
 * SportSync - Game Detail Page
 *
 * Full ESPN game view with:
 * - Live score header with team logos, records, and status
 * - Tab navigation: Play-by-Play, Box Score, Game Leaders, Game Info
 * - Real ESPN data: actual plays, player stats, game leaders
 * - 5s auto-refresh for live games
 */
import { memo, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Navbar from "../components/Navbar";
import LiveBadge from "../components/LiveBadge";
import Footer from "../components/Footer";
import PredictionWidget from "../components/PredictionWidget";
import apiClient from "../api/client";
import { API } from "../constants";
import type {
  BoxScoreTeam,
  DerivedLeadersPayload,
  DerivedTeamLeaders,
  DisplayPlay,
  EspnAthlete,
  EspnAthleteStatsPayload,
  EspnAthleteStatRow,
  EspnBoxscorePlayerTeam,
  EspnCompetition,
  EspnCompetitor,
  EspnLeaderCategory,
  EspnLineScore,
  EspnLogo,
  EspnPlayRecord,
  EspnStatistic,
  EspnStatisticGroup,
  EspnStatusBlob,
  EspnSummary,
  EspnSummaryLeaderGroup,
  EspnTeamBlob,
  GameData,
  GameDetailResponse,
  GamePredictionResponse,
  Leader,
  Play,
  PlayerStat,
  ResolvedPlayTeam,
  TeamDetail,
} from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const LIVE_GAME_REFRESH_MS = 5000;
const loadedHeadshotSources = new Set<string>();
const failedHeadshotChains = new Map<string, number>();
const FAILED_HEADSHOT_RETRY_MS = 30000;
const nbaRosterCache = new Map<string, EspnAthlete[]>();
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

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function getTeamLogoUrl(team: EspnTeamBlob | Record<string, unknown> | null | undefined): string {
  const directLogo = cleanValue(String(team?.logo || ""));
  if (directLogo) return directLogo;

  const logos = Array.isArray(team?.logos) ? (team.logos as EspnLogo[]) : [];
  const pickByRel = (relName: string) =>
    logos.find(
      (logo: EspnLogo) =>
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
          (logo: EspnLogo) =>
            Array.isArray(logo?.rel) &&
            !logo.rel.includes("dark") &&
            cleanValue(String(logo?.href || "")),
        )?.href ||
        logos.find((logo: EspnLogo) => cleanValue(String(logo?.href || "")))?.href ||
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

void sanitizeStatLine;
void sanitizeSafeDisplayStatLine;

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

function normalizeText(text: string): string {
  return normalizeDisplayEncoding(text).replace(/\s+/g, " ").trim();
}

function isOfficialHeadshotUrl(url: string): boolean {
  const cleanUrl = cleanValue(url).toLowerCase();
  return (
    cleanUrl.includes("a.espncdn.com/i/headshots/") ||
    cleanUrl.includes("img.mlbstatic.com/mlb-photos/image/upload") ||
    cleanUrl.includes("resources.premierleague.com/premierleague/photos/players/")
  );
}

const GENERIC_INFERRED_PLAY_ACTORS = new Set([
  "shot clock",
  "shot clock violation",
  "team",
  "timeout",
  "jump ball",
  "foul",
  "official timeout",
  "tv timeout",
  "full timeout",
  "delay of game",
  "defensive three seconds",
  "defensive 3 seconds",
  "defensive 3",
]);

function buildHeadshotSources(src: string, name: string, league?: string, teamName?: string): string[] {
  const cleanSrc = cleanValue(src);
  const cleanName = cleanValue(name);
  const cleanLeague = cleanValue(league);
  const cleanLeagueKey = cleanLeague.toUpperCase();
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
  params.set("placeholder", "false");
  const proxyUrl = params.toString()
    ? `${API_BASE_URL}${API.ESPN_HEADSHOT}?${params.toString()}`
    : "";

  const fallbackParams = new URLSearchParams();
  if (cleanName) fallbackParams.set("name", cleanName);
  if (cleanLeague) fallbackParams.set("league", cleanLeague);
  if (cleanTeamName) fallbackParams.set("team", cleanTeamName);
  fallbackParams.set("placeholder", "false");
  const proxyFallbackUrl = fallbackParams.toString()
    ? `${API_BASE_URL}${API.ESPN_HEADSHOT}?${fallbackParams.toString()}`
    : "";

  const isPremierLeagueHeadshot = cleanSrc.includes("resources.premierleague.com/premierleague");
  const prefersDirectOfficialHeadshot = isOfficialHeadshotUrl(cleanSrc);

  if (!cleanSrc) {
    add(proxyUrl);
    add(proxyFallbackUrl);
    return sources;
  }

  if (prefersDirectOfficialHeadshot || isPremierLeagueHeadshot || cleanLeagueKey === "MLB") {
    add(cleanSrc);
    add(proxyUrl);
    add(proxyFallbackUrl);
    return sources;
  }

  add(proxyUrl);
  add(proxyFallbackUrl);
  add(cleanSrc);

  try {
    const parsed = new URL(cleanSrc);
    if (parsed.hostname.includes("espncdn.com") && parsed.pathname === "/combiner/i") {
      const imgPath = parsed.searchParams.get("img");
      if (imgPath) {
        add(`https://a.espncdn.com${imgPath}`);
        add(`https://a.espncdn.com/combiner/i?img=${encodeURIComponent(imgPath)}&w=160&h=160`);
      }
    }
  } catch {
    // Ignore malformed URLs and fall back to the original source list.
  }

  return sources;
}

function parsePlayAthletes(text: string): string[] {
  const normalizedText = normalizeText(text);
  const versusMatch = normalizedText.match(/[\u2013\u2014-]\s*(.+?)\s+vs\s+(.+)$/i);
  if (versusMatch) {
    return [versusMatch[1], versusMatch[2]].map((part) => cleanValue(part));
  }

  const pitchesToMatch = normalizedText.match(/^(.+?)\s+pitches to\s+(.+)$/i);
  if (pitchesToMatch) {
    return [pitchesToMatch[1], pitchesToMatch[2]].map((part) => cleanValue(part));
  }

  return [];
}

function extractLeadAthlete(text: string): string {
  const normalizedText = normalizeText(text);
  const leadMatch = normalizedText.match(
    /^(.+?)\s+(?:pitches?\s+to|struck out|singled|doubled|tripled|homered|grounded|flied|lined|popped|walked|hit by pitch|reached|stole|advanced|scored|fouled|bunted|sacrificed|tagged|picked off|grounds|flies|lines|pops|pass|scrambles?|sacked|punts?|kicks?|kneels?|spikes?|right end|left end|right tackle|left tackle|right guard|left guard|up the middle|offensive rebound|defensive rebound|makes|misses|turnover|jump shot|tip shot|layup|dunk)\b/i,
  );
  return cleanValue(leadMatch?.[1]);
}

function isUsableInferredAthleteName(name: string): boolean {
  const cleanedName = cleanValue(name);
  if (!cleanedName) return false;

  if (GENERIC_INFERRED_PLAY_ACTORS.has(cleanedName.toLowerCase())) {
    return false;
  }

  return /[A-Z]/.test(cleanedName);
}

function formatGenericPlayText(text: string, teamLabel: string): string {
  const displayText = normalizeText(text);
  const normalized = displayText.toLowerCase();
  const cleanTeamLabel = cleanValue(teamLabel);

  if (!cleanTeamLabel) {
    return displayText;
  }

  if (normalized === "shot clock turnover" || normalized === "shot clock violation turnover") {
    return `${cleanTeamLabel} shot clock turnover`;
  }

  if (normalized === "team turnover" || normalized === "turnover") {
    return `${cleanTeamLabel} turnover`;
  }

  return displayText;
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
  const hasOfficialSource = useMemo(() => imageSources.some((source) => isOfficialHeadshotUrl(source)), [imageSources]);

  useEffect(() => {
    if (!imageSources.length) {
      setResolvedSrc("");
      setIsReady(true);
      return;
    }

    let cancelled = false;
    setResolvedSrc("");
    setIsReady(false);

    const failedAt = failedHeadshotChains.get(sourceKey) ?? 0;
    if (failedAt && Date.now() - failedAt < FAILED_HEADSHOT_RETRY_MS && !hasOfficialSource) {
      setIsReady(true);
      return;
    }
    failedHeadshotChains.delete(sourceKey);

    const resolveCandidate = (index: number) => {
      if (cancelled) return;
      if (index >= imageSources.length) {
        failedHeadshotChains.set(sourceKey, Date.now());
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
  }, [imageSources, sourceKey, hasOfficialSource]);

  const isSoccerLeague = league === "EPL";
  const imageSizingClass =
    renderMode === "badge"
      ? "h-full w-full object-contain p-[14%]"
      : isSoccerLeague
        ? "scale-[1.05] object-cover object-top"
        : "scale-[1.16] object-cover object-center";

  if (!resolvedSrc) {
    if (!isReady) {
      return (
        <div className={`${className} surface-avatar-loading`}>
          <div className="surface-avatar-inner" />
          <div className="surface-avatar-gloss animate-pulse" />
          <div className="relative opacity-45">
            <PersonSVG size={18} />
          </div>
        </div>
      );
    }

    const initials = getInitials(alt);
    return (
      <div className={`${className} surface-avatar-ready`}>
        {initials ? (
          <>
            <div className="surface-avatar-inner" />
            <span className="surface-avatar-initials text-[12px] font-semibold tracking-[0.08em]">{initials}</span>
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
    <div className={`${className} surface-avatar-image`}>
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
type Tab = "feed" | "game" | "teamA" | "teamB";

const DIRECT_ESPN_SUMMARY_PATHS: Record<string, string> = {
  NFL: "football/nfl",
  NBA: "basketball/nba",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
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

function parseGameStatus(statusObj: EspnStatusBlob | null | undefined): { status: string; statusDetail: string } {
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

function isGenericUpcomingLabel(value?: string): boolean {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return true;
  return [
    "scheduled",
    "match scheduled",
    "game scheduled",
    "upcoming",
    "not started",
    "tba",
    "tbd",
    "to be announced",
    "pre-match",
    "pregame",
  ].includes(normalized);
}

function formatScheduledLabel(scheduledAt?: string): string {
  const kickoff = new Date(scheduledAt || "");
  if (Number.isNaN(kickoff.getTime())) {
    return "";
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const parts = formatter.formatToParts(kickoff);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const month = values.month || "";
  const day = values.day || "";
  const hour = values.hour || "";
  const minute = values.minute || "00";
  const dayPeriod = values.dayPeriod || "";
  const timeZoneName = values.timeZoneName || "";

  if (!month || !day || !hour) {
    return formatter.format(kickoff).replace(",", " -");
  }

  const timeCore = `${hour}:${minute}${dayPeriod ? ` ${dayPeriod}` : ""}`;
  return `${month}/${day} - ${timeCore}${timeZoneName ? ` ${timeZoneName}` : ""}`;
}

function parseTeamLeaderItems(leadersRaw: EspnLeaderCategory[]): TeamDetail["leaders"] {
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

function parseTeamStats(statsRaw: EspnStatistic[]): TeamDetail["stats"] {
  return (statsRaw || []).map((stat) => ({
    name: String(stat.displayValue || stat.name || ""),
    label: String(stat.name || ""),
    abbreviation: String(stat.abbreviation || ""),
  }));
}

function parseLineScoreValue(line: EspnLineScore | null | undefined): number {
  const candidates = [
    line?.value,
    line?.displayValue,
    line?.score,
    line?.points,
    line?.runs,
  ];

  for (const candidate of candidates) {
    const cleaned = cleanValue(String(candidate ?? ""));
    if (!cleaned) continue;

    const match = cleaned.match(/-?\d+/);
    if (match) {
      return Number(match[0]);
    }
  }

  return 0;
}

function buildGameDataFromSummary(summary: EspnSummary, league: string, eventId: string): GameData | null {
  const header = summary?.header || {};
  const competition = (header.competitions || [])[0] || ({} as EspnCompetition);
  const competitors = asArray<EspnCompetitor>(competition.competitors);
  if (!competitors.length) return null;

  let homeDetail: TeamDetail | null = null;
  let awayDetail: TeamDetail | null = null;

  for (const competitor of competitors) {
    const team = competitor.team || {};
    const teamInfo: TeamDetail = {
      id: String(team.id || ""),
      name: String(team.displayName || team.shortDisplayName || ""),
      abbreviation: String(team.abbreviation || ""),
      logo: getTeamLogoUrl(team),
      color: String(team.color || ""),
      record: String(((competitor.records || [])[0] || {}).summary || ""),
      score: String(competitor.score || "0"),
      leaders: parseTeamLeaderItems(competitor.leaders || []),
      stats: parseTeamStats(competitor.statistics || []),
        linescores: (competitor.linescores || []).map((line) => parseLineScoreValue(line)),
    };

    if (competitor.homeAway === "home") {
      homeDetail = teamInfo;
    } else {
      awayDetail = teamInfo;
    }
  }

  if (!homeDetail || !awayDetail) {
    const fallbackTeams = competitors.map((competitor) => {
      const team = competitor.team || {};
      return {
        id: String(team.id || ""),
        name: String(team.displayName || team.shortDisplayName || ""),
        abbreviation: String(team.abbreviation || ""),
        logo: getTeamLogoUrl(team),
        color: String(team.color || ""),
        record: String(((competitor.records || [])[0] || {}).summary || ""),
        score: String(competitor.score || "0"),
        leaders: parseTeamLeaderItems(competitor.leaders || []),
        stats: parseTeamStats(competitor.statistics || []),
        linescores: (competitor.linescores || []).map((line) => parseLineScoreValue(line)),
      } satisfies TeamDetail;
    });

    homeDetail = homeDetail || fallbackTeams[0] || null;
    awayDetail = awayDetail || fallbackTeams[1] || fallbackTeams[0] || null;
  }

  if (!homeDetail || !awayDetail) {
    return null;
  }

  const venue = competition.venue || summary?.gameInfo?.venue || {};
  const oddsSource = (summary?.odds || competition.odds || [])[0] || null;
  const broadcastsSource = [
    ...asArray<{ names?: string[] }>(summary?.broadcasts),
    ...asArray<{ names?: string[] }>(competition.broadcasts),
  ];
  const { status, statusDetail } = parseGameStatus(competition.status || {});

  return {
    id: String(eventId),
    homeTeam: String(homeDetail.name || ""),
    awayTeam: String(awayDetail.name || ""),
    homeAbbr: String(homeDetail.abbreviation || ""),
    awayAbbr: String(awayDetail.abbreviation || ""),
    homeScore: Number(homeDetail.score || 0),
    awayScore: Number(awayDetail.score || 0),
    homeBadge: String(homeDetail.logo || ""),
    awayBadge: String(awayDetail.logo || ""),
    status,
    statusDetail,
    league,
    dateEvent: String(competition.date || "").slice(0, 10),
    scheduledAt: String(competition.date || ""),
    strVenue: String(venue.fullName || venue.displayName || ""),
    strEvent: `${awayDetail.name || ""} at ${homeDetail.name || ""}`,
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
    broadcasts: broadcastsSource.flatMap((broadcast) => broadcast?.names || []).filter(Boolean),
  };
}

function parseSummaryBoxScore(summary: EspnSummary): BoxScoreTeam[] {
  const boxPlayers = asArray<EspnBoxscorePlayerTeam>(summary?.boxscore?.players);
  if (!boxPlayers.length) {
    const boxTeams = asArray<EspnBoxscorePlayerTeam>(summary?.boxscore?.teams);
    return boxTeams.map((teamBox) => {
      const teamInfo = teamBox.team || {};
      const stats: Record<string, string> = {};
      const labels: string[] = [];

      for (const stat of asArray<EspnStatistic>(teamBox.statistics)) {
        const label = cleanValue(
          stat.label || stat.shortDisplayName || stat.displayName || stat.abbreviation || stat.name || "",
        );
        const value = cleanValue(String(stat.displayValue || stat.value || ""));
        if (!label || !value) continue;
        stats[label] = value;
        if (!labels.includes(label)) {
          labels.push(label);
        }
      }

      return {
        teamName: String(teamInfo.displayName || ""),
        teamAbbr: String(teamInfo.abbreviation || ""),
        teamLogo: getTeamLogoUrl(teamInfo),
        players: stats && Object.keys(stats).length
          ? [{
              name: "Team Totals",
              shortName: "Team Totals",
              headshot: teamInfo.logo || "",
              position: "",
              stats,
            }]
          : [],
        labels,
      };
    }).filter((team: BoxScoreTeam) => team.players.length > 0);
  }

  return boxPlayers.map((teamBox) => {
    const teamInfo = teamBox.team || {};
    const teamStats = asArray<EspnStatisticGroup>(teamBox.statistics);
    const players: PlayerStat[] = [];
    const labels: string[] = [];
    for (const statGroup of teamStats) {
      const groupLabels = (statGroup.labels || []).map((label) => cleanValue(String(label))).filter(Boolean);
      for (const label of groupLabels) {
        if (!labels.includes(label)) {
          labels.push(label);
        }
      }
      for (const athleteEntry of statGroup.athletes || []) {
        const athlete = athleteEntry.athlete || {};
        const stats: Record<string, string> = {};
        (athleteEntry.stats || []).forEach((value, index) => {
          const label = groupLabels[index];
          if (label) stats[label] = cleanValue(String(value));
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
      labels,
    };
  });
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

function registerTeamLeaders(
  target: Record<string, DerivedTeamLeaders>,
  teamInfo: EspnTeamBlob | null | undefined,
  leaders: DerivedTeamLeaders,
) {
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

function buildMlbBatterLeader(
  teamInfo: EspnTeamBlob | null | undefined,
  section: EspnStatisticGroup | null | undefined,
): { leader: Leader; teamLeader: DerivedTeamLeaders[number] } | null {
  const labels = (section?.labels || []).map((label) => cleanValue(String(label)));
  const athletes = asArray<EspnAthleteStatRow>(section?.athletes);
  if (!labels.length || !athletes.length) return null;

  let bestEntry: EspnAthleteStatRow | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const athleteEntry of athletes) {
    const stats = (athleteEntry?.stats || []).map((value) => cleanValue(String(value)));
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
  const stats = (bestEntry.stats || []).map((value) => cleanValue(String(value)));
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

function buildMlbPitcherLeader(
  teamInfo: EspnTeamBlob | null | undefined,
  section: EspnStatisticGroup | null | undefined,
): { leader: Leader; teamLeader: DerivedTeamLeaders[number] } | null {
  const labels = (section?.labels || []).map((label) => cleanValue(String(label)));
  const athletes = asArray<EspnAthleteStatRow>(section?.athletes);
  if (!labels.length || !athletes.length) return null;

  let bestEntry: EspnAthleteStatRow | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const athleteEntry of athletes) {
    const stats = (athleteEntry?.stats || []).map((value) => cleanValue(String(value)));
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
  const stats = (bestEntry.stats || []).map((value) => cleanValue(String(value)));
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

function deriveMlbFallbackLeaders(summary: EspnSummary): DerivedLeadersPayload {
  const byTeamKey: Record<string, DerivedTeamLeaders> = {};
  const leaders: Leader[] = [];
  const boxPlayers = asArray<EspnBoxscorePlayerTeam>(summary?.boxscore?.players);

  for (const teamBox of boxPlayers) {
    const teamInfo = teamBox?.team || {};
    const teamLeaders: DerivedTeamLeaders = [];
    const sections = asArray<EspnStatisticGroup>(teamBox?.statistics);

    const battingSection = sections.find((section) =>
      isMlbBattingSection((section?.labels || []).map((label) => String(label))),
    );
    const pitchingSection = sections.find((section) =>
      isMlbPitchingSection((section?.labels || []).map((label) => String(label))),
    );

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

async function fetchNbaRoster(teamId: string): Promise<EspnAthlete[]> {
  const cacheKey = cleanValue(teamId);
  if (!cacheKey) return [];
  if (nbaRosterCache.has(cacheKey)) {
    return nbaRosterCache.get(cacheKey) || [];
  }

  let athletes: EspnAthlete[] = [];
  try {
    const response = await apiClient.get(`${API.ESPN_NBA_ROSTER}/${encodeURIComponent(cacheKey)}`);
    athletes = Array.isArray(response.data?.athletes) ? (response.data.athletes as EspnAthlete[]) : [];
  } catch {
    athletes = [];
  }
  nbaRosterCache.set(cacheKey, athletes);
  return athletes;
}

function readNbaStatValue(payload: EspnAthleteStatsPayload | null | undefined, statName: string): number {
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

  let payload: EspnAthleteStatsPayload | null = null;
  try {
    const response = await apiClient.get(
      `${API.ESPN_NBA_ATHLETE_STATS}/${seasonYear}/${seasonType}/${encodeURIComponent(cleanId)}`,
    );
    payload = response.data?.available ? (response.data.data as EspnAthleteStatsPayload) : null;
  } catch {
    payload = null;
  }

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

async function deriveNbaFallbackLeaders(summary: EspnSummary): Promise<DerivedLeadersPayload> {
  const headerSeason = summary?.header?.season || {};
  const competition = (summary?.header?.competitions || [])[0] || {};
  const competitors = asArray<EspnCompetitor>(competition?.competitors);
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
    competitors.map(async (competitor) => {
      const teamInfo = competitor?.team || {};
      const roster = await fetchNbaRoster(String(teamInfo?.id || ""));
      if (!roster.length) return;

      const athleteRows = (
        await Promise.all(
          roster.map(async (athlete) => ({
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

async function deriveFallbackLeaders(summary: EspnSummary, league: string): Promise<DerivedLeadersPayload> {
  if (league === "MLB") {
    return deriveMlbFallbackLeaders(summary);
  }
  if (league === "NBA") {
    return deriveNbaFallbackLeaders(summary);
  }
  if (league === "EPL") {
    const trackedStats = [
      { name: "possessionPct", label: "Possession", suffix: "%" },
      { name: "totalShots", label: "Shots", suffix: "" },
      { name: "shotsOnTarget", label: "On Goal", suffix: "" },
      { name: "saves", label: "Saves", suffix: "" },
    ] as const;
    const leaders: Leader[] = [];
    const byTeamKey: Record<string, DerivedTeamLeaders> = {};

    for (const teamBox of asArray<EspnBoxscorePlayerTeam>(summary?.boxscore?.teams)) {
      const teamInfo = teamBox?.team || {};
      const teamLeaders: DerivedTeamLeaders = [];
      const statMap = new Map<string, EspnStatistic>();
      for (const stat of asArray<EspnStatistic>(teamBox?.statistics)) {
        const name = cleanValue(stat?.name || "").toLowerCase();
        if (name) statMap.set(name, stat);
      }

      for (const definition of trackedStats) {
        const stat = statMap.get(definition.name.toLowerCase());
        if (!stat) continue;
        let value = cleanValue(String(stat.displayValue || stat.value || ""));
        if (!value) continue;
        if (definition.suffix && !value.includes(definition.suffix)) {
          value = `${value}${definition.suffix}`;
        }

        const leader: Leader = {
          team: String(teamInfo.displayName || ""),
          teamAbbr: String(teamInfo.abbreviation || ""),
          category: definition.label,
          name: String(teamInfo.displayName || teamInfo.shortDisplayName || ""),
          value,
          headshot: teamInfo.logo || "",
        };
        leaders.push(leader);
        teamLeaders.push({
          category: definition.label,
          name: leader.name,
          value,
          headshot: leader.headshot,
        });
      }

      registerTeamLeaders(byTeamKey, teamInfo, teamLeaders);
    }

    return { leaders, byTeamKey };
  }
  return { leaders: [], byTeamKey: {} };
}

function parseSummaryLeaders(summary: EspnSummary): Leader[] {
  const leaderGroups = asArray<EspnSummaryLeaderGroup>(summary?.leaders);
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

function parseSummaryPlays(summary: EspnSummary): Play[] {
  const rawPlays = [...asArray<EspnPlayRecord>(summary?.plays)];
  if (!rawPlays.length && summary?.drives) {
    for (const drive of summary.drives.previous || []) {
      rawPlays.push(...(drive?.plays || []));
    }
  }

  return rawPlays.reverse().map((play) => {
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

void DIRECT_ESPN_SUMMARY_PATHS;
void shiftActivityDateParam;
void buildGameDataFromSummary;
void parseSummaryBoxScore;
void resolveDerivedTeamLeaders;
void mergeLeaders;
void mergeTeamLeaderItems;
void deriveFallbackLeaders;
void parseSummaryLeaders;
void parseSummaryPlays;

export default function GameDetailPage() {
  const { slug, id } = useParams<{ slug?: string; id?: string }>();
  const navigate = useNavigate();
  const routeValue = slug ?? id ?? "";
  const eventId = useMemo(() => {
    const cleanSlug = cleanValue(routeValue);
    const match = cleanSlug.match(/(\d+)$/);
    return match?.[1] || cleanSlug;
  }, [routeValue]);
  const leagueParam = useMemo(() => {
    const cleanSlug = cleanValue(routeValue);
    return cleanValue(cleanSlug.split("-")[0]).toUpperCase();
  }, [routeValue]);
  const dateParam = "";
  const [activeTab, setActiveTab] = useState<Tab>("feed");
  const [initializedGameId, setInitializedGameId] = useState("");
  const gameKey = `${eventId || ""}:${leagueParam || ""}:${dateParam || ""}`;

  const { data, isLoading } = useQuery<GameDetailResponse>({
    queryKey: ["espn-game", eventId, leagueParam, dateParam],
    queryFn: async () => {
      if (!eventId) {
        return { game: null, plays: [], boxScore: [], leaders: [], error: "Game not found" };
      }

      try {
        const params = leagueParam ? { league: leagueParam } : undefined;
        const res = await apiClient.get(`${API.ESPN_GAME}/${eventId}`, { params });
        if (res.data?.game) return res.data;
      } catch {
        /* Fall through to the empty-state response below. */
      }

      return { game: null, plays: [], boxScore: [], leaders: [], error: "Game not found" };
    },
    enabled: !!eventId,
    placeholderData: (previousData) => previousData,
    staleTime: 5000,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => query.state.data?.game?.status === "live" ? LIVE_GAME_REFRESH_MS : false,
  });

  const { data: prediction } = useQuery<GamePredictionResponse | null>({
    queryKey: ["game-prediction", eventId, leagueParam],
    queryFn: async () => {
      if (!eventId) return null;
      try {
        const params = leagueParam ? { league: leagueParam } : undefined;
        const response = await apiClient.get<GamePredictionResponse>(`${API.PREDICT}/${eventId}`, { params });
        return response.data;
      } catch {
        return null;
      }
    },
    enabled: !!eventId,
    staleTime: 10000,
    refetchOnWindowFocus: false,
    refetchInterval: () => (data?.game?.status === "live" ? LIVE_GAME_REFRESH_MS : false),
  });

  useEffect(() => {
    if (!eventId || initializedGameId === gameKey) return;
    if (!data?.game) return;

    if (data.game.status === "upcoming") {
      setActiveTab("game");
    } else if (data.plays.length > 0) {
      setActiveTab("feed");
    } else {
      setActiveTab("game");
    }

    setInitializedGameId(gameKey);
  }, [eventId, gameKey, initializedGameId, data?.game, data?.plays.length]);

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
  const displayStatusDetail =
    game.status === "upcoming" && isGenericUpcomingLabel(game.statusDetail)
      ? formatScheduledLabel(game.scheduledAt) || game.statusDetail
      : game.statusDetail;
  const lineScoreColumnCount = Math.max(home.linescores?.length || 0, away.linescores?.length || 0);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "feed", label: "Feed", icon: <IconPlayByPlay /> },
    { key: "game", label: "Game", icon: <IconBoxScore /> },
    { key: "teamA", label: "Team A", icon: <IconLeaders /> },
    { key: "teamB", label: "Team B", icon: <IconInfo /> },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* ── Sticky Game Header ── */}
      <div className="sticky top-14 z-30 border-b border-muted/15" style={{
              background: `linear-gradient(135deg, #${home.color || '1a1a2e'}22, var(--background) 50%, #${away.color || '1a1a2e'}22)`,
        backdropFilter: 'blur(16px)',
      }}>
        <div className="max-w-4xl mx-auto px-4 py-4">
          {/* Back + Status bar */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
            >
              <IconBack />
              <span>Back</span>
            </button>
            {isLive ? (
              <div className="flex items-center gap-2">
                <LiveBadge />
                <span className="text-accent text-sm font-bold">{game.statusDetail}</span>
              </div>
            ) : (
              <span className="text-sm font-medium text-muted">
                {game.status === "final" ? "FINAL" : displayStatusDetail}
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
          {lineScoreColumnCount > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[11px] text-center">
                <thead>
                  <tr className="text-muted">
                    <th className="text-left py-0.5 pr-3 font-medium w-10">Team</th>
                    {Array.from({ length: lineScoreColumnCount }, (_, i) => (
                      <th key={i} className="px-1.5 py-0.5 font-medium min-w-[24px]">{i + 1}</th>
                    ))}
                    <th className="px-2 py-0.5 font-bold">T</th>
                  </tr>
                </thead>
                <tbody className="text-foreground-base">
                  <tr>
                    <td className="text-left py-0.5 pr-3 font-medium text-foreground">{away.abbreviation}</td>
                    {Array.from({ length: lineScoreColumnCount }, (_, i) => (
                      <td key={i} className="px-1.5 py-0.5">{away.linescores?.[i] ?? "-"}</td>
                    ))}
                    <td className="px-2 py-0.5 font-bold text-foreground">{game.awayScore}</td>
                  </tr>
                  <tr>
                    <td className="text-left py-0.5 pr-3 font-medium text-foreground">{home.abbreviation}</td>
                    {Array.from({ length: lineScoreColumnCount }, (_, i) => (
                      <td key={i} className="px-1.5 py-0.5">{home.linescores?.[i] ?? "-"}</td>
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
          {activeTab === "feed" && <PlaysTab plays={data.plays} game={game} />}
          {activeTab === "game" && (
            <GameOverviewTab
              game={game}
              displayStatusDetail={displayStatusDetail}
              prediction={prediction}
              boxScore={data.boxScore}
              leaders={data.leaders}
              homeDetail={home}
              awayDetail={away}
            />
          )}
          {activeTab === "teamA" && (
            <TeamFocusTab
              tabLabel="Team A"
              teamDetail={away}
              opponentDetail={home}
              league={game.league}
              boxScore={data.boxScore}
            />
          )}
          {activeTab === "teamB" && (
            <TeamFocusTab
              tabLabel="Team B"
              teamDetail={home}
              opponentDetail={away}
              league={game.league}
              boxScore={data.boxScore}
            />
          )}
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildResolvedTeams(game: GameData): ResolvedPlayTeam[] {
  return [
    {
      name: cleanValue(game.homeTeam),
      abbr: cleanValue(game.homeAbbr),
      logo: cleanValue(game.homeBadge),
      side: "home",
    },
    {
      name: cleanValue(game.awayTeam),
      abbr: cleanValue(game.awayAbbr),
      logo: cleanValue(game.awayBadge),
      side: "away",
    },
  ];
}

function matchesTeamReference(candidate: string, team: ResolvedPlayTeam): boolean {
  const normalizedCandidate = cleanValue(candidate).toLowerCase();
  if (!normalizedCandidate) return false;

  const normalizedName = team.name.toLowerCase();
  const normalizedAbbr = team.abbr.toLowerCase();

  return (
    (!!normalizedName &&
      (normalizedCandidate === normalizedName ||
        normalizedCandidate.includes(normalizedName) ||
        normalizedName.includes(normalizedCandidate))) ||
    (!!normalizedAbbr && normalizedCandidate === normalizedAbbr)
  );
}

function textContainsTeamReference(text: string, team: ResolvedPlayTeam): boolean {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return false;

  const loweredText = normalizedText.toLowerCase();
  if (team.name && loweredText.includes(team.name.toLowerCase())) {
    return true;
  }

  if (team.abbr) {
    const abbrPattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(team.abbr)}([^A-Za-z0-9]|$)`, "i");
    if (abbrPattern.test(normalizedText)) {
      return true;
    }
  }

  return false;
}

function resolvePlayTeam(play: Play, game: GameData): ResolvedPlayTeam | null {
  const teams = buildResolvedTeams(game);
  const candidates = [play.playTeamName, play.playTeamAbbr, play.team];

  for (const candidate of candidates) {
    for (const team of teams) {
      if (matchesTeamReference(candidate || "", team)) {
        return team;
      }
    }
  }

  const combinedText = normalizeText(play.text || play.shortText || "");
  for (const team of teams) {
    if (textContainsTeamReference(combinedText, team)) {
      return team;
    }
  }

  return null;
}

function isPeriodBoundaryPlay(text: string, playType: string): boolean {
  const normalized = `${normalizeText(text)} ${normalizeText(playType)}`.toLowerCase();
  return (
    normalized.includes("end game") ||
    normalized.includes("game end") ||
    normalized.includes("end of") ||
    normalized.includes("end period") ||
    normalized.includes("match ends") ||
    normalized.includes("match end") ||
    normalized.includes("first half ends") ||
    normalized.includes("second half ends") ||
    normalized.includes("first half begins") ||
    normalized.includes("second half begins") ||
    normalized.includes("game over") ||
    normalized.includes("final:") ||
    normalized.includes("middle of") ||
    normalized.includes("top of the") ||
    normalized.includes("bottom of the") ||
    normalized.includes("inning") ||
    normalized.includes("halftime") ||
    normalized.includes("half begins") ||
    normalized.includes("intermission") ||
    normalized.includes("start of") ||
    normalized.includes("beginning of")
  );
}

function buildDisplayPlay(play: Play, game: GameData): DisplayPlay {
  const resolvedTeam = resolvePlayTeam(play, game);
  const resolvedTeamName = resolvedTeam?.name || cleanValue(play.playTeamName || play.team);
  const resolvedTeamAbbr = resolvedTeam?.abbr || cleanValue(play.playTeamAbbr);
  const resolvedTeamLogo = resolvedTeam?.logo || cleanValue(play.playTeamLogo || play.teamLogo);
  const displayText = formatGenericPlayText(play.text || play.shortText || "", resolvedTeamAbbr || resolvedTeamName);
  const playType = normalizeText(play.playType || play.type || "");
  const parsedAthletes = parsePlayAthletes(displayText);
  const inferredLeadAthleteRaw = extractLeadAthlete(displayText);
  const inferredLeadAthlete = isUsableInferredAthleteName(inferredLeadAthleteRaw) ? inferredLeadAthleteRaw : "";
  const normalizedAthleteName = cleanValue(play.athleteName) || parsedAthletes[0] || inferredLeadAthlete || "";
  const normalizedAthlete2Name =
    cleanValue(play.athlete2Name) ||
    parsedAthletes.find((name) => name.toLowerCase() !== normalizedAthleteName.toLowerCase()) ||
    "";

  return {
    ...play,
    displayText,
    playType,
    playTeamName: resolvedTeamName,
    playTeamAbbr: resolvedTeamAbbr,
    playTeamLogo: resolvedTeamLogo,
    athleteName: normalizedAthleteName,
    athleteHeadshot: cleanValue(play.athleteHeadshot),
    athleteStats: sanitizeRenderedStatLine(play.athleteStats),
    athlete2Name: normalizedAthlete2Name,
    athlete2Headshot: cleanValue(play.athlete2Headshot),
    isMatchupEvent: isPeriodBoundaryPlay(displayText, playType),
  };
}

function PlayAvatarGroup({ play, game }: { play: DisplayPlay; game: GameData }) {
  const primaryName = play.athleteName;
  const secondaryName = play.athlete2Name;
  const primaryHeadshot = play.athleteHeadshot;
  const secondaryHeadshot = play.athlete2Headshot;
  const teamLogo = cleanValue(play.playTeamLogo || play.teamLogo);
  const teamName = cleanValue(play.playTeamName || play.team);
  const isPlayTeamHome = play.playTeamAbbr === cleanValue(game.homeAbbr);
  const primaryFallbackLogo =
    teamLogo ||
    (isPlayTeamHome ? cleanValue(game.homeBadge) : cleanValue(game.awayBadge)) ||
    cleanValue(game.awayBadge) ||
    cleanValue(game.homeBadge);
  const secondaryFallbackLogo = teamLogo || primaryFallbackLogo;

  if (play.isMatchupEvent) {
    return (
      <div className="flex h-[3.125rem] w-[4.375rem] items-center justify-center">
        <div className="flex items-center -space-x-2">
          <GameHeadshotImg
            src={cleanValue(game.awayBadge)}
            alt={game.awayAbbr || game.awayTeam}
            className="surface-avatar-ring z-10 h-10 w-10 rounded-full"
            fallbackSrc={cleanValue(game.homeBadge)}
            renderMode="badge"
          />
          <GameHeadshotImg
            src={cleanValue(game.homeBadge)}
            alt={game.homeAbbr || game.homeTeam}
            className="surface-avatar-ring h-10 w-10 rounded-full"
            fallbackSrc={cleanValue(game.awayBadge)}
            renderMode="badge"
          />
        </div>
      </div>
    );
  }

  if ((primaryName || primaryHeadshot) && (secondaryName || secondaryHeadshot)) {
    return (
      <div className="flex h-[3.125rem] w-[4.375rem] items-center justify-center">
        <div className="flex items-center -space-x-2">
          <GameHeadshotImg
            src={primaryHeadshot}
            alt={primaryName || teamName || "Player"}
            league={game.league}
            teamName={teamName}
            fallbackSrc={primaryFallbackLogo}
            className="surface-avatar-ring z-10 h-10 w-10 rounded-full"
          />
          <GameHeadshotImg
            src={secondaryHeadshot}
            alt={secondaryName || teamName || "Player"}
            league={game.league}
            teamName={teamName}
            fallbackSrc={secondaryFallbackLogo}
            className="surface-avatar-ring h-10 w-10 rounded-full"
          />
        </div>
      </div>
    );
  }

  if (primaryName || primaryHeadshot) {
    return (
      <div className="flex h-[3.125rem] w-[4.375rem] items-center justify-center">
        <GameHeadshotImg
          src={primaryHeadshot}
          alt={primaryName || teamName || "Player"}
          league={game.league}
          teamName={teamName}
          fallbackSrc={primaryFallbackLogo}
          className="surface-avatar-ring h-11 w-11 rounded-full"
        />
      </div>
    );
  }

  if (teamLogo) {
    return (
      <div className="flex h-[3.125rem] w-[4.375rem] items-center justify-center">
        <GameHeadshotImg
          src={teamLogo}
          alt={play.playTeamAbbr || teamName || game.homeAbbr || game.awayAbbr}
          className="surface-avatar-ring h-11 w-11 rounded-full"
          renderMode="badge"
        />
      </div>
    );
  }

  return (
    <div className="flex h-[3.125rem] w-[4.375rem] items-center justify-center">
      <div className="surface-avatar-image surface-avatar-ring flex h-11 w-11 items-center justify-center rounded-full">
        <IconClock />
      </div>
    </div>
  );
}

function PlaysTab({ plays, game }: { plays: Play[]; game: GameData }) {
  const displayPlays = useMemo(
    () => plays.map((play) => buildDisplayPlay(play, game)),
    [plays, game],
  );

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
          <span className="surface-live-badge rounded-full px-2 py-0.5 text-[10px] animate-pulse font-bold">LIVE</span>
        )}
      </h3>
      {displayPlays.map((play, idx) => {
        const playMeta = formatPlayMeta(play);
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
            <div className="grid grid-cols-[4.375rem_minmax(0,1fr)_4.5rem] gap-2.5 items-start">
              <div className="pt-0.5">
                <PlayAvatarGroup play={play} game={game} />
              </div>

              <div className="min-w-0 pt-0.5 pr-2">
                {!play.isMatchupEvent && play.playTeamName && (
                  <p className="text-[10px] text-muted/60 font-medium leading-tight mb-0.5 truncate">
                    {play.playTeamName}
                  </p>
                )}
                <p className={`text-[12px] leading-snug break-words ${play.scoringPlay ? "text-foreground font-medium" : "text-foreground-base"}`}>
                  {play.displayText}
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                  {playMeta && (
                    <span className="text-[10px] text-muted font-mono">{playMeta}</span>
                  )}
                  {play.athleteStats && (
                    <span className="text-[10px] text-accent font-medium">{play.athleteStats}</span>
                  )}
                </div>
              </div>

              <div className="pt-0.5 text-right">
                {scoreVisible && (
                  <>
                    <div className="flex items-center justify-end gap-1.5 text-[10px] leading-tight">
                      <span className="text-muted font-medium">{game.awayAbbr}</span>
                      <span className="font-bold tabular-nums min-w-[14px] text-right text-foreground">
                        {play.awayScore}
                      </span>
                    </div>
                    <div className="flex items-center justify-end gap-1.5 text-[10px] leading-tight mt-0.5">
                      <span className="text-muted font-medium">{game.homeAbbr}</span>
                      <span className="font-bold tabular-nums min-w-[14px] text-right text-foreground">
                        {play.homeScore}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Box Score Tab ── */
const BOX_SCORE_LABEL_PREFERENCES: Record<string, string[]> = {
  NBA: ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"],
  NFL: ["C/ATT", "YDS", "AVG", "TD", "INT", "SACKS", "QBR", "RTG", "CAR", "REC", "TGTS", "LONG"],
  MLB: ["H-AB", "AB", "R", "H", "RBI", "HR", "BB", "K", "#P", "AVG", "OBP", "SLG", "IP", "ER", "WHIP"],
  NHL: ["G", "A", "PTS", "SOG", "TOI", "+/-", "FW", "FL", "FO%", "PIM", "HT", "TK", "BS"],
  EPL: ["Possession", "SHOTS", "ON GOAL", "Saves", "Fouls", "Corner Kicks", "Accurate Passes", "Passes", "Pass Completion %"],
};

function buildStableBoxScoreLabels(boxScore: BoxScoreTeam[], league: string): string[] {
  const discoveredLabels: string[] = [];
  const addLabel = (label: string) => {
    const cleaned = cleanValue(label);
    if (cleaned && !discoveredLabels.includes(cleaned)) {
      discoveredLabels.push(cleaned);
    }
  };

  for (const team of boxScore) {
    for (const label of team.labels || []) {
      addLabel(label);
    }
    for (const player of team.players || []) {
      for (const label of Object.keys(player.stats || {})) {
        addLabel(label);
      }
    }
  }

  const orderedLabels: string[] = [];
  const preferred = BOX_SCORE_LABEL_PREFERENCES[cleanValue(league).toUpperCase()] || [];
  for (const preferredLabel of preferred) {
    if (discoveredLabels.includes(preferredLabel) && !orderedLabels.includes(preferredLabel)) {
      orderedLabels.push(preferredLabel);
    }
  }

  for (const label of discoveredLabels) {
    if (!orderedLabels.includes(label)) {
      orderedLabels.push(label);
    }
  }

  return orderedLabels;
}

function findMatchingBoxScoreTeam(boxScore: BoxScoreTeam[], teamDetail: TeamDetail): BoxScoreTeam | null {
  const teamAbbr = cleanValue(teamDetail.abbreviation).toUpperCase();
  const teamName = cleanValue(teamDetail.name).toLowerCase();
  return (
    boxScore.find((team) => cleanValue(team.teamAbbr).toUpperCase() === teamAbbr) ||
    boxScore.find((team) => cleanValue(team.teamName).toLowerCase() === teamName) ||
    null
  );
}

function SingleTeamBoxScoreSection({ team, league }: { team: BoxScoreTeam; league: string }) {
  const displayLabels = useMemo(() => buildStableBoxScoreLabels([team], league), [team, league]);

  return (
    <div className="overflow-hidden rounded-xl border border-muted/15 bg-surface">
      <div className="flex items-center justify-between border-b border-muted/10 px-4 py-3">
        <h4 className="text-sm font-semibold text-foreground">Player Box Score</h4>
        <span className="text-xs uppercase tracking-[0.18em] text-muted">{team.teamAbbr}</span>
      </div>
      <div className="overflow-x-auto overflow-y-hidden scrollbar-hide">
        <table className="min-w-full w-max table-fixed text-xs">
          <colgroup>
            <col className="w-[220px]" />
            {displayLabels.map((label) => (
              <col key={label} className="w-[72px]" />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-background/50">
              <th className="sticky left-0 z-10 min-w-[220px] bg-background/95 px-3 py-2 text-left font-medium text-muted">
                Player
              </th>
              {displayLabels.map((label) => (
                <th key={label} className="min-w-[72px] px-2 py-2 text-center font-medium text-muted">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-muted/8">
            {team.players.map((player, index) => (
              <tr key={`${player.name}-${index}`} className="transition-colors hover:bg-background/30">
                <td className="sticky left-0 z-10 bg-surface px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <GameHeadshotImg
                      src={getHeadshotUrl(player.headshot)}
                      alt={player.shortName || player.name}
                      league={league}
                      teamName={team.teamName}
                      className="h-6 w-6 flex-shrink-0 rounded-full"
                    />
                    <div className="min-w-0">
                      <p className="max-w-[110px] truncate text-xs font-medium text-foreground">
                        {player.shortName || player.name}
                      </p>
                      {player.position ? <p className="text-[9px] text-muted">{player.position}</p> : null}
                    </div>
                  </div>
                </td>
                {displayLabels.map((label) => (
                  <td key={label} className="px-2 py-1.5 text-center text-xs tabular-nums text-foreground-base">
                    {player.stats[label] || "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamFocusTab({
  tabLabel,
  teamDetail,
  opponentDetail,
  league,
  boxScore,
}: {
  tabLabel: string;
  teamDetail: TeamDetail;
  opponentDetail: TeamDetail;
  league: string;
  boxScore: BoxScoreTeam[];
}) {
  const teamBoxScore = useMemo(() => findMatchingBoxScoreTeam(boxScore, teamDetail), [boxScore, teamDetail]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-muted/15 bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">{tabLabel}</p>
            <h3 className="mt-2 text-xl font-semibold text-foreground">{teamDetail.name}</h3>
            <p className="mt-1 text-sm text-muted">Focused view against {opponentDetail.name}.</p>
          </div>
          <div className="grid min-w-[12rem] gap-3 text-sm sm:grid-cols-2">
            <InfoRow label="Record" value={teamDetail.record || "—"} />
            <InfoRow label="Score" value={teamDetail.score || "0"} />
          </div>
        </div>
      </div>

      {teamDetail.leaders.length > 0 ? (
        <div className="rounded-xl border border-muted/15 bg-surface p-5">
          <h4 className="mb-3 text-sm font-semibold text-foreground">Team Leaders</h4>
          <div className="grid gap-3 md:grid-cols-2">
            {teamDetail.leaders.map((leader) => (
              <div
                key={`${teamDetail.abbreviation}-${leader.category}-${leader.name}`}
                className="rounded-xl border border-muted/10 bg-background/45 p-4"
              >
                <div className="flex items-center gap-3">
                  <GameHeadshotImg
                    src={getHeadshotUrl(leader.headshot)}
                    alt={leader.name}
                    league={league}
                    teamName={teamDetail.name}
                    className="h-11 w-11 rounded-full"
                  />
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.18em] text-accent">{leader.category}</p>
                    <p className="truncate text-base font-semibold text-foreground">{leader.name}</p>
                  </div>
                </div>
                <p className="mt-3 text-sm font-medium text-foreground-base">{leader.value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {teamDetail.stats.length > 0 ? (
        <div className="rounded-xl border border-muted/15 bg-surface p-5">
          <h4 className="mb-3 text-sm font-semibold text-foreground">Team Stats</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teamDetail.stats.map((stat) => (
              <div
                key={`${teamDetail.abbreviation}-${stat.label}-${stat.name}`}
                className="rounded-xl border border-muted/10 bg-background/45 px-4 py-3"
              >
                <p className="text-xs uppercase tracking-[0.16em] text-muted">{stat.label || stat.abbreviation || "Stat"}</p>
                <p className="mt-2 text-base font-semibold text-foreground">{stat.name || "—"}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {teamBoxScore ? <SingleTeamBoxScoreSection team={teamBoxScore} league={league} /> : null}
    </div>
  );
}

function BoxScoreTab({ boxScore, league }: { boxScore: BoxScoreTeam[]; league: string }) {
  const [expandedTeam, setExpandedTeam] = useState<number>(0);
  const displayLabels = useMemo(() => buildStableBoxScoreLabels(boxScore, league), [boxScore, league]);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-foreground font-semibold text-lg">Box Score</h3>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {boxScore.map((team, i) => (
            <button
              key={team.teamAbbr}
              onClick={() => setExpandedTeam(i)}
              className={`flex items-center justify-between gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-colors min-w-[11rem] ${
                expandedTeam === i
                  ? "bg-accent text-white"
                  : "bg-surface border border-muted/20 text-muted hover:text-foreground"
              }`}
            >
              <span className="truncate">{team.teamName}</span>
              {team.teamLogo && (
                <GameHeadshotImg
                  src={team.teamLogo}
                  alt={team.teamAbbr || team.teamName}
                  className="w-5 h-5 rounded-full flex-shrink-0"
                  renderMode="badge"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {boxScore[expandedTeam] && (
        <div className="bg-surface border border-muted/15 rounded-xl overflow-hidden">
          <div className="overflow-x-auto overflow-y-hidden scrollbar-hide">
            <table className="min-w-full w-max table-fixed text-xs">
              <colgroup>
                <col className="w-[220px]" />
                {displayLabels.map((label) => (
                  <col key={label} className="w-[72px]" />
                ))}
              </colgroup>
              <thead>
                <tr className="bg-background/50">
                  <th className="text-left py-2 px-3 text-muted font-medium sticky left-0 bg-background/95 z-10 min-w-[220px]">
                    Player
                  </th>
                  {displayLabels.map((label) => (
                    <th key={label} className="py-2 px-2 text-muted font-medium text-center min-w-[72px]">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-muted/8">
                {boxScore[expandedTeam].players.map((player, i) => {
                  const hsUrl = getHeadshotUrl(player.headshot);
                  return (
                    <tr key={i} className="hover:bg-background/30 transition-colors">
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
                      {displayLabels.map((label) => (
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
  const matchesLeaderTeam = (player: Leader, teamDetail: TeamDetail) => {
    const leaderAbbr = cleanValue(player.teamAbbr).toUpperCase();
    const leaderTeam = cleanValue(player.team).toLowerCase();
    const teamAbbr = cleanValue(teamDetail.abbreviation).toUpperCase();
    const teamName = cleanValue(teamDetail.name).toLowerCase();
    return (leaderAbbr && leaderAbbr === teamAbbr) || (leaderTeam && leaderTeam === teamName);
  };
  const buildOrderedCategorySlots = (players: Leader[]) => {
    const remainingPlayers = [...players];
    const takeTeamLeader = (teamDetail: TeamDetail) => {
      const index = remainingPlayers.findIndex((player) => matchesLeaderTeam(player, teamDetail));
      return index >= 0 ? remainingPlayers.splice(index, 1)[0] : null;
    };

    // The sticky game header renders away on the left and home on the right,
    // so keep the leaders grid in that same visual order.
    const awayPlayer = takeTeamLeader(awayDetail);
    const homePlayer = takeTeamLeader(homeDetail);
    return [
      { key: `away-${categoryKey(players)}`, player: awayPlayer, isPlaceholder: !awayPlayer },
      { key: `home-${categoryKey(players)}`, player: homePlayer, isPlaceholder: !homePlayer },
      ...remainingPlayers.map((player, index) => ({
        key: `${cleanValue(player.category)}-${cleanValue(player.teamAbbr || player.team)}-${index}`,
        player,
        isPlaceholder: false,
      })),
    ];
  };

  function categoryKey(players: Leader[]): string {
    return cleanValue(players[0]?.category || "leader");
  }

  return (
    <div className="space-y-4">
      <h3 className="text-foreground font-semibold flex items-center gap-2">
        <IconLeaders /> Game Leaders
      </h3>
      {Array.from(categories.entries()).map(([category, players]) => (
        <div key={category} className="bg-surface border border-muted/15 rounded-2xl p-4 sm:p-5">
          <h4 className="text-xs text-accent font-medium mb-4 uppercase tracking-[0.18em]">{category}</h4>
          <div className="grid gap-3 md:grid-cols-2">
            {buildOrderedCategorySlots(players).map((slot) => {
              if (!slot.player) {
                return <div key={slot.key} className="hidden min-h-[1px] md:block" aria-hidden="true" />;
              }

              const player = slot.player;
              const hsUrl = getHeadshotUrl(player.headshot);
              const statSegments = splitLeaderValue(player.value);
              const renderTeamBadge = cleanValue(player.name).toLowerCase() === cleanValue(player.team).toLowerCase();
              return (
                <div
                  key={slot.key}
                  className="rounded-xl border border-muted/10 bg-background/45 p-4 shadow-[0_0_0_1px_var(--surface-outline-soft)] flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0 sm:flex-1">
                    <GameHeadshotImg
                      src={hsUrl}
                      alt={player.name}
                      league={league}
                      teamName={player.team}
                      className="w-12 h-12 rounded-full flex-shrink-0"
                      renderMode={renderTeamBadge ? "badge" : "headshot"}
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
function InfoTab({ game, displayStatusDetail }: { game: GameData; displayStatusDetail: string }) {
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
          <InfoRow label="Status" value={displayStatusDetail} />
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


function GameOverviewTab({
  game,
  displayStatusDetail,
  prediction,
  boxScore,
  leaders,
  homeDetail,
  awayDetail,
}: {
  game: GameData;
  displayStatusDetail: string;
  prediction: GamePredictionResponse | null | undefined;
  boxScore: BoxScoreTeam[];
  leaders: Leader[];
  homeDetail: TeamDetail;
  awayDetail: TeamDetail;
}) {
  return (
    <div className="space-y-4">
      {prediction ? (
        <PredictionWidget
          homeTeam={game.homeAbbr || game.homeTeam}
          awayTeam={game.awayAbbr || game.awayTeam}
          homeWinProb={prediction.home_win_prob}
          awayWinProb={prediction.away_win_prob}
          gameStatus={game.status}
          updatedAt={prediction.created_at}
        />
      ) : null}
      <LeadersTab leaders={leaders} homeDetail={homeDetail} awayDetail={awayDetail} league={game.league} />
      {boxScore.length > 0 ? <BoxScoreTab boxScore={boxScore} league={game.league} /> : null}
      <InfoTab game={game} displayStatusDetail={displayStatusDetail} />
    </div>
  );
}
