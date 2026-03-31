/**
 * SportSync - LiveActivityFeed Component
 *
 * Scrollable play-by-play timeline. New plays slide in at top.
 * Each play is immutable once rendered — no flickering.
 * Plays are keyed by unique ID (gameId + text hash from backend).
 */
import { useState, useMemo, useRef, useEffect, useCallback, memo } from "react";
import { API } from "../constants";
import { normalizeConfiguredLoopbackUrl } from "../utils/http";

type FeedItem = {
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
  gameMatchup?: string;
  isSavedTeam?: boolean;
};

type SavedTeamSummary = {
  name: string;
  shortName?: string;
  league?: string;
  sport?: string;
};

type LiveActivityFeedProps = {
  items: FeedItem[];
  allItems?: FeedItem[];
  activityDate?: string;         // "" or undefined = today, "20260315" = specific date
  onDateChange?: (date: string) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  total?: number;
  loading?: boolean;
  error?: string;
  activeLeague?: string;         // controlled league filter from parent
  onLeagueChange?: (league: string) => void;  // notify parent of league change
  statusFilter?: "all" | "live" | "final";
  onStatusFilterChange?: (status: "all" | "live" | "final") => void;
  savedTeams?: SavedTeamSummary[];
};

type DisplayFeedItem = FeedItem & {
  displayText: string;
};

type PitchMatchup = {
  batterName: string;
  pitcherName: string;
};

const LEAGUE_ORDER = ["NFL", "NBA", "MLB", "NHL", "EPL"] as const;
const API_BASE_URL = (() => {
  const configured = String(import.meta.env.VITE_API_BASE_URL || "").trim();
  if (configured) {
    return normalizeConfiguredLoopbackUrl(configured);
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return "http://localhost:8000";
})();
const loadedHeadshotSources = new Set<string>();
const failedHeadshotChains = new Set<string>();

function isOfficialHeadshotUrl(url: string): boolean {
  const cleanUrl = cleanValue(url).toLowerCase();
  return (
    cleanUrl.includes("a.espncdn.com/i/headshots/") ||
    cleanUrl.includes("img.mlbstatic.com/mlb-photos/image/upload") ||
    cleanUrl.includes("resources.premierleague.com/premierleague/photos/players/")
  );
}

/** Convert "20260315" → "Mar 15" (same year) or "Mar 15, 2025" */
function formatDateLabel(yyyymmdd: string): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd;
  const y = parseInt(yyyymmdd.slice(0, 4));
  const m = parseInt(yyyymmdd.slice(4, 6)) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8));
  const date = new Date(y, m, d);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }),
  });
}

function normalizeTeamMatchValue(value: string): string {
  return (value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

function normalizeSavedTeamLeague(value?: string): string {
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

function formatDateInputValue(yyyymmdd?: string): string {
  const normalized = cleanValue(yyyymmdd);
  if (!normalized || normalized.length !== 8) return "";
  return `${normalized.slice(4, 6)}/${normalized.slice(6, 8)}/${normalized.slice(0, 4)}`;
}

function getTodayDateInputValue(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${month}/${day}/${year}`;
}

function getTodayActivityDate(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

void getTodayActivityDate;

/** Strip season stat totals like (10), (12) from play text */
function stripSeasonNumbers(text: string): string {
  return text.replace(/\s*\(\d+\)/g, "").trim();
}

function parseDateInputValue(value: string): string {
  const normalized = cleanValue(value).replace(/-/g, "/");
  const match = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";

  const [, monthRaw, dayRaw, yearRaw] = match;
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const year = Number(yearRaw);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return "";
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";

  const candidate = new Date(year, month - 1, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return "";
  }

  return `${yearRaw}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

/** Also accept YYYY-MM-DD from HTML date inputs */
function parseDateInputValueAny(value: string): string {
  const trimmed = cleanValue(value);
  // Try YYYY-MM-DD first
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  }
  return parseDateInputValue(trimmed);
}

function PersonSVG({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-muted/50" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
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

function normalizeText(text: string): string {
  return normalizeDisplayEncoding(text).replace(/\s+/g, " ").trim();
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

function ensureSentence(text: string): string {
  const trimmed = cleanValue(text).replace(/[.\s]+$/g, "");
  return trimmed ? `${trimmed}.` : "";
}

function expandInitialTokens(text: string): string {
  return text.replace(/\b([A-Z]{1,3})-([A-Z])\.([A-Za-z][A-Za-z'’-]+)\b/g, "$1-$2. $3")
    .replace(/\b([A-Z])\.([A-Za-z][A-Za-z'’-]+)\b/g, "$1. $2");
}

function stripLeadingParentheticalTags(text: string): string {
  let next = text;
  while (/^\([^)]{1,40}\)\s*/.test(next)) {
    next = next.replace(/^\([^)]{1,40}\)\s*/, "");
  }
  return next;
}

function formatNFLPlayText(text: string): string {
  let formatted = normalizeText(text);
  formatted = stripLeadingParentheticalTags(formatted);
  formatted = formatted.replace(/^(?:[A-Z]\.[A-Za-z'’-]+\s+and\s+)+[A-Z]\.[A-Za-z'’-]+\s+reported in as eligible\.\s*/i, "");
  formatted = formatted.replace(/\*\*\s*Injury Update:\s*[^.]+\.?/gi, "");
  formatted = formatted.replace(/\.PENALTY/gi, ". PENALTY");
  formatted = formatted.replace(/\bran ob\b/gi, "ran out of bounds");
  formatted = formatted.replace(/\bpushed ob\b/gi, "pushed out of bounds");
  formatted = formatted.replace(/\bdidn't try to advance\b/gi, "did not try to advance");
  formatted = expandInitialTokens(formatted).trim();

  const completionMatch = formatted.match(
    /^(.+?) pass (short|deep)?\s*(left|right|middle)? to (.+?) to ([A-Z]{2,3} \d+) for (-?\d+) yards?(?: \((.+?)\))?\.?(?:\s*(PENALTY.+))?$/i,
  );
  if (completionMatch) {
    const [, passer, depth, direction, target, spot, yards, tackler, extra] = completionMatch;
    const route = [cleanValue(depth), cleanValue(direction)].filter(Boolean).join("-");
    const yardLabel = Math.abs(Number(yards)) === 1 ? "yard" : "yards";
    return [
      `${passer}${route ? ` ${route}` : ""} pass to ${target} for ${yards} ${yardLabel} to ${spot}.`,
      cleanValue(tackler) ? `Tackle by ${tackler}.` : "",
      cleanValue(extra),
    ].filter(Boolean).join(" ");
  }

  const incompletionMatch = formatted.match(
    /^(.+?) pass incomplete (short|deep)?\s*(left|right|middle)?(?: intended for | to )(.+?)\.?(?:\s*(PENALTY.+))?$/i,
  );
  if (incompletionMatch) {
    const [, passer, depth, direction, target, extra] = incompletionMatch;
    const route = [cleanValue(depth), cleanValue(direction)].filter(Boolean).join("-");
    return [
      `${passer}${route ? ` ${route}` : ""} pass intended for ${target} was incomplete.`,
      cleanValue(extra),
    ].filter(Boolean).join(" ");
  }

  const fieldGoalMatch = formatted.match(/^(.+?) (\d+) yard field goal is GOOD\b.*$/i);
  if (fieldGoalMatch) {
    const [, kicker, distance] = fieldGoalMatch;
    return `${kicker} made a ${distance}-yard field goal.`;
  }

  const extraPointMatch = formatted.match(/^(.+?) extra point is GOOD\b.*$/i);
  if (extraPointMatch) {
    const [, kicker] = extraPointMatch;
    return `${kicker} made the extra point.`;
  }

  const timeoutMatch = formatted.match(/^Timeout #(\d+) by ([A-Z]{2,3}) at ([0-9:]+)\.?$/i);
  if (timeoutMatch) {
    const [, timeoutNumber, teamAbbr, clock] = timeoutMatch;
    return `${teamAbbr} timeout (#${timeoutNumber}) with ${clock} remaining.`;
  }

  const puntMatch = formatted.match(/^(.+?) punts (\d+) yards to (.+?)\.?$/i);
  if (puntMatch) {
    const [, punter, yards, destination] = puntMatch;
    return `${punter} punted ${yards} yards to ${destination}.`;
  }

  return formatted;
}

function normalizeShortNameToken(token: string): string {
  return cleanValue(token).replace(/\b([A-Z])\.(?=[A-Za-z])/g, "$1. ");
}

function resolveTeamInfo(item: FeedItem, candidateTeamName: string): Partial<FeedItem> {
  const candidate = cleanValue(candidateTeamName).toLowerCase();
  if (!candidate) return {};

  const homeTeam = cleanValue(item.homeTeam);
  const awayTeam = cleanValue(item.awayTeam);
  const matches = (teamName: string) => {
    const normalizedTeam = teamName.toLowerCase();
    return candidate === normalizedTeam || candidate.includes(normalizedTeam) || normalizedTeam.includes(candidate);
  };

  if (homeTeam && matches(homeTeam)) {
    return {
      playTeamName: homeTeam,
      playTeamAbbr: cleanValue(item.homeAbbr),
      playTeamLogo: cleanValue(item.homeBadge),
    };
  }

  if (awayTeam && matches(awayTeam)) {
    return {
      playTeamName: awayTeam,
      playTeamAbbr: cleanValue(item.awayAbbr),
      playTeamLogo: cleanValue(item.awayBadge),
    };
  }

  return {};
}

function extractParentheticalAthlete(text: string): string {
  const match = text.match(/\(([A-Z]\.[A-Za-z'’-]+)(?:[;)]|$)/);
  return normalizeShortNameToken(match?.[1] || "");
}

function parseNFLPresentation(text: string): Pick<DisplayFeedItem, "displayText" | "athleteName" | "athlete2Name"> {
  const raw = normalizeText(text);
  const cleanedText = formatNFLPlayText(raw);
  let athleteName = "";
  let athlete2Name = "";

  const interceptionMatch = raw.match(
    /^(?:\([^)]*\)\s*)?([A-Z]\.[A-Za-z'’-]+)\s+pass\b.*\bINTERCEPTED by ([A-Z]\.[A-Za-z'’-]+)/i,
  );
  if (interceptionMatch) {
    athleteName = normalizeShortNameToken(interceptionMatch[1]);
    athlete2Name = normalizeShortNameToken(interceptionMatch[2]);
  }

  if (!athleteName) {
    const passMatch = raw.match(
      /^(?:\([^)]*\)\s*)?([A-Z]\.[A-Za-z'’-]+)\s+pass\b.*?\b(?:intended for|to)\s+([A-Z]\.[A-Za-z'’-]+)/i,
    );
    if (passMatch) {
      athleteName = normalizeShortNameToken(passMatch[1]);
      athlete2Name = normalizeShortNameToken(passMatch[2]);
    }
  }

  if (!athleteName) {
    const sackMatch = raw.match(
      /^(?:\([^)]*\)\s*)?([A-Z]\.[A-Za-z'’-]+)\s+sacked\b.*\(([A-Z]\.[A-Za-z'’-]+)/i,
    );
    if (sackMatch) {
      athleteName = normalizeShortNameToken(sackMatch[1]);
      athlete2Name = normalizeShortNameToken(sackMatch[2]);
    }
  }

  if (!athleteName) {
    const rushMatch = raw.match(
      /^(?:\([^)]*\)\s*)?([A-Z]\.[A-Za-z'’-]+)\s+(?:scrambles?|right end|left end|right tackle|left tackle|right guard|left guard|up the middle|kneels?|spikes?)\b/i,
    );
    if (rushMatch) {
      athleteName = normalizeShortNameToken(rushMatch[1]);
      athlete2Name = extractParentheticalAthlete(raw);
    }
  }

  if (!athleteName) {
    const kickMatch = raw.match(/^([A-Z]\.[A-Za-z'’-]+)\s+(?:punts?|kicks?)\b/i);
    if (kickMatch) {
      athleteName = normalizeShortNameToken(kickMatch[1]);
      const returnerMatch = raw.match(/\.\s*([A-Z]\.[A-Za-z'’-]+)\b/i);
      athlete2Name = normalizeShortNameToken(returnerMatch?.[1] || "");
    }
  }

  if (!athleteName) {
    const scoringKickMatch = raw.match(/^([A-Z]\.[A-Za-z'’-]+)\s+(?:\d+\s+yard field goal|extra point)\b/i);
    if (scoringKickMatch) {
      athleteName = normalizeShortNameToken(scoringKickMatch[1]);
    }
  }

  if (!athlete2Name) {
    athlete2Name = extractParentheticalAthlete(raw);
  }

  if (athlete2Name === athleteName) {
    athlete2Name = "";
  }

  return {
    displayText: cleanedText,
    athleteName,
    athlete2Name,
  };
}

function formatEPLPlayText(text: string): string {
  let formatted = normalizeText(text);
  const goalMatch = formatted.match(
    /^Goal!\s+[^.]+\.\s+(.+?)\s+\((.+?)\)\s+(.+?)(?:\.\s+Assisted by (.+?))?\.?$/i,
  );
  if (goalMatch) {
    const [, scorer, teamName, actionText, assistText] = goalMatch;
    return [
      `Goal for ${teamName}: ${scorer}.`,
      ensureSentence(actionText),
      assistText ? `Assist: ${assistText}.` : "",
    ].filter(Boolean).join(" ");
  }

  const substitutionMatch = formatted.match(/^Substitution,\s+(.+?)\.\s+(.+?) replaces (.+?)\.?$/i);
  if (substitutionMatch) {
    const [, teamName, incoming, outgoing] = substitutionMatch;
    return `${incoming} replaced ${outgoing} for ${teamName}.`;
  }

  formatted = formatted.replace(
    /^(.+?)\s+\((.+?)\)\s+is shown the yellow card for (.+?)\.?$/i,
    "$1 received a yellow card for $3.",
  );
  formatted = formatted.replace(
    /^(.+?)\s+\((.+?)\)\s+is shown the red card for (.+?)\.?$/i,
    "$1 received a red card for $3.",
  );
  formatted = formatted.replace(/^First Half begins\.?$/i, "First half begins.");
  formatted = formatted.replace(/^Second Half begins\.?$/i, "Second half begins.");
  return formatted.trim();
}

function parseEPLPresentation(item: FeedItem, text: string): Partial<DisplayFeedItem> {
  const raw = normalizeText(text);
  const displayText = formatEPLPlayText(raw);
  let athleteName = "";
  let athlete2Name = "";
  let teamInfo: Partial<FeedItem> = {};

  const substitutionMatch = raw.match(/^Substitution,\s+(.+?)\.\s+(.+?) replaces (.+?)\.?$/i);
  if (substitutionMatch) {
    athleteName = cleanValue(substitutionMatch[2]);
    athlete2Name = cleanValue(substitutionMatch[3]);
    teamInfo = resolveTeamInfo(item, substitutionMatch[1]);
  }

  const goalMatch = raw.match(/^Goal!\s+[^.]+\.\s+(.+?)\s+\((.+?)\)\s+/i);
  if (!athleteName && goalMatch) {
    athleteName = cleanValue(goalMatch[1]);
    teamInfo = resolveTeamInfo(item, goalMatch[2]);
    const assistMatch = raw.match(/Assisted by (.+?)(?:\.|$)/i);
    athlete2Name = cleanValue(assistMatch?.[1] || "");
  }

  if (!athleteName) {
    const cardMatch = raw.match(/^(.+?)\s+\((.+?)\)\s+is shown the (yellow|red) card/i);
    if (cardMatch) {
      athleteName = cleanValue(cardMatch[1]);
      teamInfo = resolveTeamInfo(item, cardMatch[2]);
    }
  }

  if (!athleteName) {
    const genericPlayerMatch = raw.match(/^(?:[^.]+\.\s+)?(.+?)\s+\((.+?)\)\s+/i);
    if (genericPlayerMatch) {
      athleteName = cleanValue(genericPlayerMatch[1]);
      teamInfo = resolveTeamInfo(item, genericPlayerMatch[2]);
    }
  }

  return {
    displayText,
    athleteName,
    athlete2Name,
    ...teamInfo,
  };
}

function formatActivityMeta(item: FeedItem): string {
  const detail = cleanValue(item.statusDetail);
  if (item.status === "final") {
    return detail ? `${item.league} · ${detail} · Final` : `${item.league} · Final`;
  }
  return detail ? `${item.league} · ${detail}` : item.league;
}

function formatDisplayActivityMeta(item: FeedItem): string {
  return normalizeSafeDisplay(formatActivityMeta(item))
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\s*·\s*/g, " | ")
    .trim();
}

function isPitchCountRow(text: string): boolean {
  return /^pitch\s+\d+\s*:/i.test(normalizeText(text));
}

void formatDisplayActivityMeta;

function formatRenderedActivityMeta(item: FeedItem): string {
  const detail = cleanValue(item.statusDetail);
  const base = item.status === "final"
    ? (detail ? `${item.league} | ${detail} | Final` : `${item.league} | Final`)
    : (detail ? `${item.league} | ${detail}` : item.league);

  return normalizeSafeDisplay(base)
    .replace(/\s*\?\s*/g, " | ")
    .replace(/\s*\|\s*/g, " | ")
    .trim();
}

function parsePitchStarter(text: string): PitchMatchup | null {
  const match = normalizeText(text).match(/^(.+?)\s+pitches?\s+to\s+(.+)$/i);
  if (!match) return null;

  return {
    pitcherName: cleanValue(match[1]),
    batterName: cleanValue(match[2]),
  };
}

function buildPitchDisplayText(text: string, batterName: string, pitcherName: string): string {
  const normalizedText = normalizeText(text);
  if (!batterName && !pitcherName) return normalizedText;
  if (/\bvs\b/i.test(normalizedText)) return normalizedText;
  if (batterName && pitcherName) return `${normalizedText} - ${batterName} vs ${pitcherName}`;
  if (batterName) return `${normalizedText} - ${batterName}`;
  return normalizedText;
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
    /^(.+?)\s+(?:pitches?\s+to|struck out|singled|doubled|tripled|homered|grounded|flied|lined|popped|walked|hit by pitch|reached|stole|advanced|scored|fouled|bunted|sacrificed|tagged|picked off|grounds|flies|lines|pops|pass|scrambles?|sacked|punts?|kicks?|kneels?|spikes?|right end|left end|right tackle|left tackle|right guard|left guard|up the middle)\b/i,
  );
  return cleanValue(leadMatch?.[1]);
}

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

  if (isPremierLeagueHeadshot) {
    add(proxyUrl);
    add(proxyFallbackUrl);
    add(cleanSrc);
    return sources;
  }

  if (cleanLeagueKey === "MLB") {
    add(proxyUrl);
    add(proxyFallbackUrl);
    add(cleanSrc);
    return sources;
  }

  add(proxyUrl);
  add(proxyFallbackUrl);
  if (prefersDirectOfficialHeadshot) {
    add(cleanSrc);
  }

  if (isOfficialHeadshotUrl(cleanSrc) && !prefersDirectOfficialHeadshot) {
    add(cleanSrc);
  }

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

const HeadshotImg = memo(function HeadshotImg({
  src,
  alt,
  className,
  fallbackSrc,
  league,
  teamName,
}: {
  src: string;
  alt: string;
  className: string;
  fallbackSrc?: string;
  league?: string;
  teamName?: string;
}) {
  const imageSources = useMemo(
    () => buildHeadshotSources(src, alt, league, teamName),
    [src, alt, league, teamName],
  );
  const sourceKey = useMemo(
    () => imageSources.join("|") || `${cleanValue(league)}|${cleanValue(teamName)}|${cleanValue(alt)}`,
    [imageSources, league, teamName, alt],
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

  const isSoccerLeague = league === "EPL";
  const imageSizingClass = isSoccerLeague
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
        ) : fallbackSrc ? (
          <img src={fallbackSrc} alt="" className="h-full w-full object-contain p-1" loading="lazy" />
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
        className={`h-full w-full ${imageSizingClass} img-fade-in`}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </div>
  );
});

function isPeriodEnd(text: string, playType: string): boolean {
  const t = (text + " " + playType).toLowerCase();
  return (
    t.includes("end game") ||
    t.includes("game end") ||
    t.includes("end of") ||
    t.includes("end period") ||
    t.includes("match ends") ||
    t.includes("match end") ||
    t.includes("first half ends") ||
    t.includes("second half ends") ||
    t.includes("first half begins") ||
    t.includes("second half begins") ||
    t.includes("game over") ||
    t.includes("final:") ||
    t.includes("middle of") ||
    // MLB inning transitions
    t.includes("top of the") ||
    t.includes("bottom of the") ||
    t.includes("inning") ||
    // General period/half transitions
    t.includes("halftime") ||
    t.includes("half begins") ||
    t.includes("intermission") ||
    t.includes("start of") ||
    t.includes("beginning of")
  );
}

function isTeamVsTeamEvent(item: Pick<FeedItem, "league" | "text" | "playType" | "athleteName" | "athlete2Name" | "status">): boolean {
  if (isPeriodEnd(item.text, item.playType)) return true;

  const normalizedType = cleanValue(item.playType).toLowerCase();
  if (normalizedType.includes("scheduled game") || (item.status === "upcoming" && !cleanValue(item.athleteName) && !cleanValue(item.athlete2Name))) {
    return true;
  }

  if (item.league !== "NHL") return false;

  const normalizedText = normalizeText(item.text).toLowerCase();
  const hasAthletes = !!cleanValue(item.athleteName) || !!cleanValue(item.athlete2Name);

  if (hasAthletes) return false;

  return (
    normalizedText.includes("challenge") ||
    normalizedText.includes("review") ||
    normalizedText.includes("off-side") ||
    normalizedText.includes("offside") ||
    normalizedType.includes("challenge") ||
    normalizedType.includes("review") ||
    normalizedType.includes("stoppage")
  );
}

function isLowSignalActivity(item: Pick<FeedItem, "text" | "league" | "athleteName" | "athlete2Name">): boolean {
  const normalizedText = item.text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalizedText) return true;
  if (!cleanValue(item.athleteName) && !cleanValue(item.athlete2Name) && normalizedText === "foul") {
    return true;
  }

  if (/^.+?\s+pitches?\s+to\s+.+$/.test(normalizedText)) return true;
  if (/\bin\s+(left|center|right)\s+field[.!]?$/.test(normalizedText)) return true;
  if (/\bat\s+(first|second|third)\s+base[.!]?$/.test(normalizedText)) return true;
  if (/\bat\s+(shortstop|pitcher|catcher)[.!]?$/.test(normalizedText)) return true;
  if (/\bas designated hitter[.!]?$/.test(normalizedText)) return true;
  if (/\b(hit for|pinch[- ]hit for|pinch[- ]ran for|replaces|substitutes for)\b/.test(normalizedText)) return true;
  if (item.league === "MLB") {
    if (/\bran for\b/.test(normalizedText)) return true;
    if (/\b(catching|pitching|batting)\.?$/.test(normalizedText)) return true;
    if (/^pitch\s+\d+\s*:/.test(normalizedText) && !normalizedText.includes(" vs ") && !cleanValue(item.athlete2Name)) {
      return true;
    }
  }
  if (item.league === "EPL") {
    if (/\bfourth official has announced\b/.test(normalizedText)) return true;
    if (/^delay in match because\b/.test(normalizedText)) return true;
    if (/^delay over\b/.test(normalizedText)) return true;
    if (/\bwins a free kick\b/.test(normalizedText)) return true;
    if (/^corner,\s*/.test(normalizedText)) return true;
  }

  return false;
}


function secondarySharesPrimaryTeam(league: string, text: string, playType: string): boolean {
  const normalizedText = normalizeText(text).toLowerCase();
  const normalizedType = cleanValue(playType).toLowerCase();

  if (normalizedText.includes("assist:") || normalizedText.includes("assisted by")) {
    return true;
  }

  if (league === "NHL" && normalizedType.includes("goal") && normalizedText.includes("assists:")) {
    return true;
  }

  return false;
}

/* ── Memoized play row to prevent unnecessary re-renders ── */
const PlayRow = memo(function PlayRow({
  item,
  isNew,
  headshotLookup,
  athleteAliasLookup,
}: {
  item: DisplayFeedItem;
  isNew: boolean;
  headshotLookup: ReadonlyMap<string, string>;
  athleteAliasLookup: ReadonlyMap<string, string>;
}) {
  const displayText = item.displayText || item.text;
  const isMatchupEvent = isTeamVsTeamEvent({
    league: item.league,
    text: displayText,
    playType: item.playType,
    athleteName: item.athleteName,
    athlete2Name: item.athlete2Name,
    status: item.status,
  });
  const parsedAthletes = parsePlayAthletes(displayText);
  const leadAthleteFromText = extractLeadAthlete(item.text);
  const resolvedLeadAthleteFromText =
    cleanValue(athleteAliasLookup.get(leadAthleteFromText.toLowerCase())) || leadAthleteFromText;
  const normalizedAthleteName = cleanValue(item.athleteName) || parsedAthletes[0] || resolvedLeadAthleteFromText || "";
  const normalizedAthleteHeadshot = cleanValue(item.athleteHeadshot);
  const normalizedSecondaryAthleteName =
    cleanValue(item.athlete2Name) ||
    parsedAthletes.find((name) => name.toLowerCase() !== normalizedAthleteName.toLowerCase()) ||
    "";
  const normalizedAthlete2Headshot = cleanValue(item.athlete2Headshot);
  const hasNormalizedAthlete = !!normalizedAthleteName;
  const hasNormalizedAthlete2 =
    !!normalizedSecondaryAthleteName && normalizedSecondaryAthleteName !== normalizedAthleteName;
  const normalizedPlayTeamLogo = cleanValue(item.playTeamLogo);
  const normalizedHomeBadge = cleanValue(item.homeBadge);
  const normalizedAwayBadge = cleanValue(item.awayBadge);
  const isPlayTeamHome = item.playTeamAbbr === item.homeAbbr;
  const primaryTeamName =
    cleanValue(item.playTeamName) ||
    (isPlayTeamHome ? cleanValue(item.homeTeam) : cleanValue(item.awayTeam)) ||
    cleanValue(item.homeTeam) ||
    cleanValue(item.awayTeam);
  const primaryFallbackLogo =
    normalizedPlayTeamLogo || (isPlayTeamHome ? normalizedHomeBadge : normalizedAwayBadge);
  const secondaryUsesPrimaryTeam = secondarySharesPrimaryTeam(item.league, displayText, item.playType);
  const secondaryTeamName =
    secondaryUsesPrimaryTeam
      ? primaryTeamName
      : item.playTeamAbbr === item.homeAbbr
        ? cleanValue(item.awayTeam)
        : item.playTeamAbbr === item.awayAbbr
          ? cleanValue(item.homeTeam)
          : cleanValue(item.awayTeam) || cleanValue(item.homeTeam);
  const secondaryFallbackLogo =
    secondaryUsesPrimaryTeam
      ? primaryFallbackLogo
      : item.playTeamAbbr === item.homeAbbr
        ? normalizedAwayBadge
        : item.playTeamAbbr === item.awayAbbr
          ? normalizedHomeBadge
          : normalizedHomeBadge || normalizedAwayBadge;
  const lookupPrimaryHeadshot = normalizedAthleteName
    ? cleanValue(headshotLookup.get(normalizedAthleteName.toLowerCase()))
    : "";
  const lookupSecondaryHeadshot = normalizedSecondaryAthleteName
    ? cleanValue(headshotLookup.get(normalizedSecondaryAthleteName.toLowerCase()))
    : "";
  const resolvedPrimaryAthleteHeadshot = normalizedAthleteHeadshot || lookupPrimaryHeadshot;
  const directSecondaryHeadshot =
    normalizedSecondaryAthleteName &&
    normalizedAthlete2Headshot &&
    normalizedAthlete2Headshot !== resolvedPrimaryAthleteHeadshot
      ? normalizedAthlete2Headshot
      : "";
  const resolvedSecondaryAthleteHeadshot =
    lookupSecondaryHeadshot && lookupSecondaryHeadshot !== resolvedPrimaryAthleteHeadshot
      ? lookupSecondaryHeadshot
      : directSecondaryHeadshot;
  const hasPrimaryVisualHeadshot = !!resolvedPrimaryAthleteHeadshot;
  const hasSecondaryVisualHeadshot = !!resolvedSecondaryAthleteHeadshot;
  const shouldShowTeamLogoInLabel = !hasNormalizedAthlete && !!normalizedPlayTeamLogo;

  /* ── Avatar ── */
  let avatarEl: React.ReactNode;
  if (isMatchupEvent) {
    avatarEl = (
      <div className="flex h-[3.125rem] w-[4.375rem] items-center justify-center">
        <div className="flex items-center -space-x-2">
          <div className="surface-avatar-image surface-avatar-ring z-10 flex h-10 w-10 items-center justify-center rounded-full p-1">
            <img src={normalizedAwayBadge || normalizedPlayTeamLogo} alt="" className="h-full w-full object-contain" />
          </div>
          <div className="surface-avatar-image surface-avatar-ring flex h-10 w-10 items-center justify-center rounded-full p-1">
            <img src={normalizedHomeBadge || normalizedPlayTeamLogo} alt="" className="h-full w-full object-contain" />
          </div>
        </div>
      </div>
    );
  } else if ((hasNormalizedAthlete || hasPrimaryVisualHeadshot) && (hasNormalizedAthlete2 || hasSecondaryVisualHeadshot)) {
    avatarEl = (
      <div className="flex h-[3.125rem] w-[4.375rem] items-center justify-center">
        <div className="flex items-center -space-x-2">
          <HeadshotImg
            src={resolvedPrimaryAthleteHeadshot}
            alt={normalizedAthleteName || primaryTeamName || "Player"}
            fallbackSrc={primaryFallbackLogo}
            league={item.league}
            teamName={primaryTeamName}
            className="surface-avatar-ring z-10 h-10 w-10 rounded-full"
          />
          <HeadshotImg
            src={resolvedSecondaryAthleteHeadshot}
            alt={normalizedSecondaryAthleteName || secondaryTeamName || "Player"}
            fallbackSrc={secondaryFallbackLogo}
            league={item.league}
            teamName={secondaryTeamName}
            className="surface-avatar-ring h-10 w-10 rounded-full"
          />
        </div>
      </div>
    );
  } else if (hasNormalizedAthlete || hasPrimaryVisualHeadshot) {
    avatarEl = (
      <div className="flex h-[3.125rem] w-[4.375rem] items-center justify-center">
        <HeadshotImg
          src={resolvedPrimaryAthleteHeadshot}
          alt={normalizedAthleteName || primaryTeamName || "Player"}
          fallbackSrc={primaryFallbackLogo}
          league={item.league}
          teamName={primaryTeamName}
          className="surface-avatar-ring h-11 w-11 rounded-full"
        />
      </div>
    );
  } else if (normalizedPlayTeamLogo) {
    avatarEl = (
      <div className="flex h-[3.125rem] w-[4.375rem] items-center justify-center">
        <div className="surface-avatar-image surface-avatar-ring flex h-11 w-11 items-center justify-center rounded-full p-1">
          <img src={normalizedPlayTeamLogo} alt={item.playTeamAbbr} className="h-full w-full object-contain" loading="lazy" />
        </div>
      </div>
    );
  } else {
    avatarEl = (
      <div className="flex h-[3.125rem] w-[4.375rem] items-center justify-center">
        <div className="surface-avatar-image surface-avatar-ring flex h-11 w-11 items-center justify-center rounded-full"><PersonSVG size={18} /></div>
      </div>
    );
  }

  return (
    <div
      className={`grid grid-cols-[4.375rem_minmax(0,1fr)_4.5rem] gap-2.5 items-start px-3 py-3 transition-all duration-500 ease-out hover:bg-background/50 ${
        isNew
          ? "animate-slide-in bg-accent/8 border-l-2 border-l-accent"
          : "border-l-2 border-l-transparent"
      }`}
    >
      <div className="pt-0.5">{avatarEl}</div>

      <div className="min-w-0 pt-0.5 pr-2">
        {!isMatchupEvent && item.playTeamName && (
          <p className="text-[10px] text-muted/60 font-medium leading-tight mb-0.5 truncate flex items-center gap-1">
            {shouldShowTeamLogoInLabel && (
              <img src={normalizedPlayTeamLogo} alt="" className="w-3.5 h-3.5 rounded-full object-contain inline-block shrink-0" loading="lazy" />
            )}
            {item.playTeamName}
          </p>
        )}
        <p className={`text-[12px] text-foreground leading-snug break-words ${isNew ? "text-white" : ""}`}>
          {displayText}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-[10px] text-muted">
            {formatRenderedActivityMeta(item)}
          </span>
          {sanitizeRenderedStatLine(item.athleteStats) && (
            <span className="text-[10px] text-accent/70 font-medium">
              {sanitizeRenderedStatLine(item.athleteStats)}
            </span>
          )}
        </div>
      </div>

      <div className="text-right pt-0.5">
        <div className="flex items-center justify-end gap-1.5 text-[10px] leading-tight">
          <span className="text-muted font-medium">{item.awayAbbr}</span>
          <span className={`font-bold tabular-nums min-w-[14px] text-right ${isNew ? "text-accent" : "text-foreground"}`}>
            {item.awayScore}
          </span>
        </div>
        <div className="flex items-center justify-end gap-1.5 text-[10px] leading-tight mt-0.5">
          <span className="text-muted font-medium">{item.homeAbbr}</span>
          <span className={`font-bold tabular-nums min-w-[14px] text-right ${isNew ? "text-accent" : "text-foreground"}`}>
            {item.homeScore}
          </span>
        </div>
      </div>
    </div>
  );
});

export default function LiveActivityFeed({
  items,
  allItems,
  activityDate,
  onDateChange,
  hasMore,
  onLoadMore,
  total,
  loading,
  error,
  activeLeague,
  onLeagueChange,
  statusFilter: controlledStatusFilter,
  onStatusFilterChange,
  savedTeams = [],
}: LiveActivityFeedProps) {
  const [teamFilter, setTeamFilter] = useState<"all" | "my-teams">("all");
  // Use controlled league filter if parent provides it, otherwise local state
  const [localLeague, setLocalLeague] = useState<string>("ALL");
  const leagueFilter = activeLeague !== undefined ? activeLeague : localLeague;
  const setLeagueFilter = onLeagueChange || setLocalLeague;
  const [localStatusFilter, setLocalStatusFilter] = useState<"all" | "live" | "final">("all");
  const statusFilter = controlledStatusFilter ?? localStatusFilter;
  const setStatusFilter = onStatusFilterChange || setLocalStatusFilter;
  // Compute today's date fresh each render so it updates when midnight rolls over
  const todayInputValue = getTodayDateInputValue();
  const resolvedDateInputValue = useMemo(
    () => formatDateInputValue(activityDate) || todayInputValue,
    [activityDate, todayInputValue],
  );
  const [dateInputValue, setDateInputValue] = useState(resolvedDateInputValue);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoLoadSavedTeamsRef = useRef(false);
  const lastAutoLoadItemCountRef = useRef(0);
  const filterSourceItems = useMemo(
    () => (statusFilter === "all" ? items : (allItems?.length ? allItems : items)),
    [allItems, items, statusFilter],
  );

  useEffect(() => {
    setDateInputValue(resolvedDateInputValue);
  }, [resolvedDateInputValue]);

  const commitDateValue = useCallback((value: string) => {
    if (!onDateChange) return;
    if (!value) {
      onDateChange("");
      return;
    }
    const parsedDate = parseDateInputValueAny(value);
    if (!parsedDate) return;
    // Always pass the explicit date — never clear to "" (which fetches latest cached, not today)
    onDateChange(parsedDate);
  }, [onDateChange]);
  const headshotLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    const remember = (name: string, headshot: string) => {
      const cleanName = cleanValue(name);
      const cleanHeadshot = cleanValue(headshot);
      if (!cleanName || !cleanHeadshot) return;
      const key = cleanName.toLowerCase();
      if (!lookup.has(key)) lookup.set(key, cleanHeadshot);
    };

    for (const item of filterSourceItems) {
      const parsedNames = parsePlayAthletes(item.text);
      const primaryHeadshot = cleanValue(item.athleteHeadshot);
      const secondaryHeadshot = cleanValue(item.athlete2Headshot);
      remember(item.athleteName, primaryHeadshot);
      remember(item.athlete2Name, secondaryHeadshot);
      if (parsedNames[0]) remember(parsedNames[0], primaryHeadshot);
      if (parsedNames[1] && secondaryHeadshot && secondaryHeadshot !== primaryHeadshot) {
        remember(parsedNames[1], secondaryHeadshot);
      }
    }

    return lookup;
  }, [filterSourceItems]);
  const athleteAliasLookup = useMemo(() => {
    const aliasCounts = new Map<string, number>();
    const aliasNames = new Map<string, string>();
    const rememberAlias = (name: string) => {
      const cleanName = cleanValue(name);
      if (!cleanName) return;
      const parts = cleanName.split(/\s+/).filter(Boolean);
      if (parts.length < 2) return;
      const alias = parts[parts.length - 1].toLowerCase();
      aliasCounts.set(alias, (aliasCounts.get(alias) || 0) + 1);
      if (!aliasNames.has(alias)) {
        aliasNames.set(alias, cleanName);
      }
    };

    for (const item of filterSourceItems) {
      rememberAlias(item.athleteName);
      rememberAlias(item.athlete2Name);
      for (const parsedName of parsePlayAthletes(item.text)) {
        rememberAlias(parsedName);
      }
    }

    const lookup = new Map<string, string>();
    for (const [alias, count] of aliasCounts.entries()) {
      if (count === 1) {
        const fullName = aliasNames.get(alias);
        if (fullName) {
          lookup.set(alias, fullName);
        }
      }
    }
    return lookup;
  }, [filterSourceItems]);
  const displayItems = useMemo<DisplayFeedItem[]>(() => {
    const pitchContextByGame = new Map<string, PitchMatchup>();

    return [...filterSourceItems]
      .reverse()
      .map((item) => {
        const normalizedText = normalizeText(item.text);
        const cleanedText = stripSeasonNumbers(normalizedText);
        const pitchStarter = item.league === "MLB" ? parsePitchStarter(normalizedText) : null;
        const isPitchRow = item.league === "MLB" && isPitchCountRow(cleanedText);
        const isInningTransition = item.league === "MLB" && isPeriodEnd(cleanedText, item.playType);
        const leadAthleteAlias = extractLeadAthlete(cleanedText);
        const leadAthlete =
          cleanValue(athleteAliasLookup.get(leadAthleteAlias.toLowerCase())) || leadAthleteAlias;
        let displayText = cleanedText;
        let athleteName = item.athleteName;
        let athlete2Name = item.athlete2Name;

        if (item.league === "MLB") {
          if (pitchStarter) {
            const pitcherName = cleanValue(item.athleteName) || pitchStarter.pitcherName;
            const batterName = cleanValue(item.athlete2Name) || pitchStarter.batterName;
            if (batterName || pitcherName) {
              pitchContextByGame.set(item.gameId, { batterName, pitcherName });
            }
          } else if (isPitchRow) {
            const currentMatchup = pitchContextByGame.get(item.gameId);
            const parsedAthletes = parsePlayAthletes(normalizedText);
            const hasExplicitMatchup = /\bvs\b/i.test(normalizedText);
            const batterName = hasExplicitMatchup
              ? cleanValue(item.athleteName) || parsedAthletes[0] || currentMatchup?.batterName || ""
              : currentMatchup?.batterName || cleanValue(item.athleteName) || parsedAthletes[0] || "";
            const pitcherName = hasExplicitMatchup
              ? cleanValue(item.athlete2Name) || parsedAthletes[1] || currentMatchup?.pitcherName || ""
              : currentMatchup?.pitcherName || cleanValue(item.athlete2Name) || parsedAthletes[1] || "";

            athleteName = batterName || athleteName;
            athlete2Name = pitcherName || athlete2Name;
            displayText = buildPitchDisplayText(normalizedText, batterName, pitcherName);

            if (batterName || pitcherName) {
              pitchContextByGame.set(item.gameId, {
                batterName: batterName || currentMatchup?.batterName || "",
                pitcherName: pitcherName || currentMatchup?.pitcherName || "",
              });
            }
          } else if (isInningTransition || item.playType === "Play Result" || leadAthlete) {
            pitchContextByGame.delete(item.gameId);
          }
        }

        if (item.league === "NFL") {
          const parsedNFL = parseNFLPresentation(normalizedText);
          displayText = parsedNFL.displayText || displayText;
          athleteName = parsedNFL.athleteName || athleteName;
          athlete2Name = parsedNFL.athlete2Name || athlete2Name;
        }

        if (item.league === "EPL") {
          const parsedEPL = parseEPLPresentation(item, normalizedText);
          displayText = parsedEPL.displayText || displayText;
          athleteName = parsedEPL.athleteName || athleteName;
          athlete2Name = parsedEPL.athlete2Name || athlete2Name;
          item = {
            ...item,
            playTeamName: parsedEPL.playTeamName || item.playTeamName,
            playTeamAbbr: parsedEPL.playTeamAbbr || item.playTeamAbbr,
            playTeamLogo: parsedEPL.playTeamLogo || item.playTeamLogo,
          };
        }

        return {
          ...item,
          athleteName,
          athlete2Name,
          displayText,
        };
      })
      .reverse();
  }, [filterSourceItems, athleteAliasLookup]);

  // Track which IDs are "new" for entry animation
  const knownIdsRef = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const prevKnown = knownIdsRef.current;
    const freshIds = new Set<string>();
    for (const item of filterSourceItems) {
      if (!prevKnown.has(item.id)) freshIds.add(item.id);
    }
    if (freshIds.size > 0) {
      setNewIds(freshIds);
      const timer = setTimeout(() => setNewIds(new Set()), 800);
      for (const id of freshIds) prevKnown.add(id);
      return () => clearTimeout(timer);
    }
  }, [filterSourceItems]);

  const filtered = useMemo(() => {
    let result = displayItems.filter((i) => !isLowSignalActivity(i));
    if (teamFilter === "my-teams") {
      result = result.filter((item) =>
        item.isSavedTeam || savedTeams.some((team) =>
          matchesSavedTeamSide({ name: item.homeTeam, shortName: item.homeAbbr || "" }, item.league, team) ||
          matchesSavedTeamSide({ name: item.awayTeam, shortName: item.awayAbbr || "" }, item.league, team)
        )
      );
    }
    // When parent handles league filtering server-side, skip client-side league filter
    if (leagueFilter !== "ALL" && !onLeagueChange) result = result.filter((i) => i.league === leagueFilter);
    if (statusFilter !== "all") result = result.filter((i) => i.status === statusFilter);
    return result;
  }, [displayItems, teamFilter, leagueFilter, statusFilter, onLeagueChange, savedTeams]);

  useEffect(() => {
    if (teamFilter !== "my-teams") {
      autoLoadSavedTeamsRef.current = false;
      lastAutoLoadItemCountRef.current = 0;
      return;
    }

    if (!hasMore || !onLoadMore || loading) {
      return;
    }

    if (autoLoadSavedTeamsRef.current && lastAutoLoadItemCountRef.current === items.length) {
      return;
    }

    autoLoadSavedTeamsRef.current = true;
    lastAutoLoadItemCountRef.current = items.length;
    const timer = window.setTimeout(() => {
      onLoadMore();
    }, 120);

    return () => window.clearTimeout(timer);
  }, [hasMore, items.length, loading, onLoadMore, teamFilter]);

  return (
    <section>
      {/* ── Header: Title + date picker ── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-2 mr-auto">
          <h2 className="text-lg font-semibold text-foreground whitespace-nowrap">
            {activityDate ? `Activity — ${formatDateLabel(activityDate)}` : "Live Activity"}
          </h2>
          <input
            type="text"
            inputMode="numeric"
            value={dateInputValue}
            placeholder="mm/dd/yyyy"
            onChange={(e) => {
              setDateInputValue(e.target.value);
            }}
            onBlur={() => {
              if (!dateInputValue.trim()) {
                commitDateValue("");
                setDateInputValue(resolvedDateInputValue);
                return;
              }

              const parsedDate = parseDateInputValue(dateInputValue);
              if (!parsedDate) {
                setDateInputValue(resolvedDateInputValue);
                return;
              }

              const normalizedValue = formatDateInputValue(parsedDate);
              setDateInputValue(normalizedValue);
              if (normalizedValue !== resolvedDateInputValue) {
                commitDateValue(normalizedValue);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const parsedDate = parseDateInputValue(dateInputValue);
                if (!parsedDate) {
                  setDateInputValue(resolvedDateInputValue);
                  (e.currentTarget as HTMLInputElement).blur();
                  return;
                }

                const normalizedValue = formatDateInputValue(parsedDate);
                setDateInputValue(normalizedValue);
                commitDateValue(normalizedValue);
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            className="bg-surface border border-muted/20 rounded-lg px-2 py-1 text-xs text-foreground w-[120px] focus:outline-none focus:border-accent/50"
            title="Browse plays from a specific date"
          />

          {(total != null && total > 0) && (
            <span className="text-[10px] text-muted font-medium whitespace-nowrap">
              {leagueFilter !== "ALL"
                ? `${items.length.toLocaleString()} ${leagueFilter} plays of ${total.toLocaleString()}`
                : statusFilter !== "all"
                  ? `${filtered.length.toLocaleString()} ${statusFilter} plays`
                  : `${items.length.toLocaleString()} of ${total.toLocaleString()}`}
            </span>
          )}
        </div>

        {/* Filters visible ONLY on small screens (below lg) — stacked above */}
        <div className="flex items-center gap-1.5 flex-wrap lg:hidden">
          {/* League pills */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setLeagueFilter("ALL")}
              className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                leagueFilter === "ALL" ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              All
            </button>
            {LEAGUE_ORDER.map((l) => (
              <button
                key={l}
                onClick={() => setLeagueFilter(leagueFilter === l ? "ALL" : l)}
                className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                  leagueFilter === l ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Status pills */}
          <div className="flex items-center gap-0.5 border-l border-muted/15 pl-1.5 ml-0.5">
            {(["all", "live", "final"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s && s !== "all" ? "all" : s)}
                className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                  statusFilter === s
                    ? s === "live"
          ? "surface-feed-alert"
                      : "bg-accent/15 text-accent"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {s === "all" ? "All" : s === "live" ? "Live" : "Final"}
              </button>
            ))}
          </div>

          {/* Team toggle */}
          <div className="flex gap-0.5 bg-surface rounded-lg p-0.5 border border-muted/10 ml-0.5">
            <button
              onClick={() => setTeamFilter("all")}
              className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
                teamFilter === "all" ? "bg-accent text-white" : "text-muted hover:text-foreground"
              }`}
            >
              All Games
            </button>
            <button
              onClick={() => setTeamFilter("my-teams")}
              className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
                teamFilter === "my-teams" ? "bg-accent text-white" : "text-muted hover:text-foreground"
              }`}
            >
              My Teams
            </button>
          </div>
        </div>
      </div>

      {/* ── Main content: full-width plays + absolutely positioned sidebar ── */}
      <div className="relative">
        {/* ── Scrollable play timeline — full width, matches Headlines above ── */}
        <div
          ref={scrollRef}
          className="bg-surface border border-muted/20 rounded-xl min-h-[420px] lg:min-h-[520px] max-h-[600px] overflow-y-auto custom-scrollbar"
        >
          {error && items.length > 0 && (
          <div className="surface-feed-warning sticky top-0 z-10 px-4 py-2 text-[11px]">
              {error} Showing the last loaded plays.
            </div>
          )}

          {/* Loading spinner — takes priority over empty state */}
          {loading && items.length === 0 ? (
            <div className="min-h-[420px] lg:min-h-[520px] p-8 flex flex-col items-center justify-center gap-2">
              <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-muted">
                Loading{leagueFilter !== "ALL" ? ` ${leagueFilter}` : ""} plays{activityDate ? ` for ${formatDateLabel(activityDate)}` : ""}...
              </p>
              {activityDate && <p className="text-[10px] text-muted/60">First load of a historical date may take 10-15s</p>}
            </div>
          ) : error && items.length === 0 ? (
            <div className="min-h-[420px] lg:min-h-[520px] p-8 flex flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-warning">{error}</p>
              <p className="max-w-md text-xs text-muted">
                Live activity is still warming up. Please try again in a moment.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="min-h-[420px] lg:min-h-[520px] p-8 text-center text-muted text-sm flex items-center justify-center">
              <div className="space-y-1">
                <p>{(() => {
                  // Check if selected date is in the future
                  if (activityDate && activityDate.length === 8) {
                    const y = Number(activityDate.slice(0, 4));
                    const m = Number(activityDate.slice(4, 6)) - 1;
                    const d = Number(activityDate.slice(6, 8));
                    const selected = new Date(y, m, d);
                    const now = new Date();
                    now.setHours(0, 0, 0, 0);
                    if (selected > now) {
                      return `These games haven't been played yet. Check back on ${formatDateLabel(activityDate)}.`;
                    }
                  }
                  return teamFilter === "my-teams"
                    ? "No activity for your saved teams" + (activityDate ? ` on ${formatDateLabel(activityDate)}.` : " right now.")
                    : leagueFilter !== "ALL"
                      ? `No ${leagueFilter} plays` + (activityDate ? ` on ${formatDateLabel(activityDate)}.` : " right now.")
                      : activityDate
                        ? `No plays found for ${formatDateLabel(activityDate)}.`
                        : "No live activity right now. Check back during game time.";
                })()}</p>
                {teamFilter === "my-teams" && (
                  <p className="text-xs text-muted/70">Switch to All Games to see the full feed.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="divide-y divide-muted/8">
              {filtered.map((item, i) => (
                <div key={item.id} className="box-row-enter" style={{ animationDelay: `${Math.min(i, 15) * 30}ms` }}>
                <PlayRow
                  item={item}
                  isNew={newIds.has(item.id)}
                  headshotLookup={headshotLookup}
                  athleteAliasLookup={athleteAliasLookup}
                />
                </div>
              ))}
            </div>
          )}

          {/* Load More button — only when filtered results exist */}
          {hasMore && filtered.length > 0 && statusFilter === "all" && (
            <div className="p-4 text-center border-t border-muted/10">
              <button
                onClick={onLoadMore}
                disabled={loading}
                className="px-8 py-2.5 rounded-lg text-sm font-semibold bg-accent/10 text-accent hover:bg-accent/20 transition-all disabled:opacity-50 border border-accent/20 hover:border-accent/40"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    Loading...
                  </span>
                ) : (
                  `Load More (${((total || 0) - items.length).toLocaleString()} remaining)`
                )}
              </button>
            </div>
          )}
        </div>

        {/* ── Right sidebar filters — absolutely positioned in empty space beyond content ── */}
        <div className="hidden lg:flex flex-col gap-3 w-[140px] absolute -right-[155px] top-0">
          {/* League pills */}
          <div className="bg-surface border border-muted/20 rounded-xl p-2.5">
            <p className="text-[9px] text-muted font-semibold uppercase tracking-wider mb-1.5">League</p>
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => setLeagueFilter("ALL")}
                className={`px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors text-left ${
                  leagueFilter === "ALL" ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground hover:bg-muted/5"
                }`}
              >
                All
              </button>
              {LEAGUE_ORDER.map((l) => (
                <button
                  key={l}
                  onClick={() => setLeagueFilter(leagueFilter === l ? "ALL" : l)}
                  className={`px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors text-left ${
                    leagueFilter === l ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground hover:bg-muted/5"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Status pills */}
          <div className="bg-surface border border-muted/20 rounded-xl p-2.5">
            <p className="text-[9px] text-muted font-semibold uppercase tracking-wider mb-1.5">Status</p>
            <div className="flex flex-col gap-0.5">
              {(["all", "live", "final"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(statusFilter === s && s !== "all" ? "all" : s)}
                  className={`px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors text-left ${
                    statusFilter === s
                      ? s === "live"
          ? "surface-feed-alert"
                        : "bg-accent/15 text-accent"
                      : "text-muted hover:text-foreground hover:bg-muted/5"
                  }`}
                >
                  {s === "all" ? "All" : s === "live" ? "Live" : "Final"}
                </button>
              ))}
            </div>
          </div>

          {/* Team toggle */}
          <div className="bg-surface border border-muted/20 rounded-xl p-2.5">
            <p className="text-[9px] text-muted font-semibold uppercase tracking-wider mb-1.5">Teams</p>
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => setTeamFilter("all")}
                className={`px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors text-left ${
                  teamFilter === "all" ? "bg-accent text-white" : "text-muted hover:text-foreground hover:bg-muted/5"
                }`}
              >
                All Games
              </button>
              <button
                onClick={() => setTeamFilter("my-teams")}
                className={`px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors text-left ${
                  teamFilter === "my-teams" ? "bg-accent text-white" : "text-muted hover:text-foreground hover:bg-muted/5"
                }`}
              >
                My Teams
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-slide-in {
          animation: slideIn 0.4s ease-out;
        }
      `}</style>
    </section>
  );
}
