import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type SyntheticEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import Hls from "hls.js";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import apiClient from "../api/client";
import { API, SUPPORTED_SPORTS } from "../constants";
import { useAuth } from "../context/AuthContext";
import type {
  ContentFormat,
  HighlightCacheEntry,
  HighlightInteraction,
  HighlightItem,
  HighlightVideoVariant,
  HighlightsResponse,
  SavedTeamResponse,
  ViewerQualityOption,
} from "../types";

type SportFilter = "ALL" | (typeof SUPPORTED_SPORTS)[number]["id"];
type SortMode = "POPULAR" | "RECENT" | "OLDEST";
type LayoutMode = "REELS" | "VIDEOS";

type HighlightCacheMap = Partial<Record<string, HighlightCacheEntry>>;
type PosterVariant = "WIDE" | "TALL" | "SQUARE";

const CACHE_KEY = "sportsync_highlights_feed_v14";
const CACHE_TTL_MS = 45_000;
const REQUEST_LIMIT = 120;
const WALL_PAGE_SIZE = 9;
const WATCH_HISTORY_KEY = "sportsync_highlights_watch_history_v1";
const SELECTED_DATE_KEY = "sportsync_highlights_selected_date_v1";
const FEATURED_MUTED_KEY = "sportsync_highlights_featured_muted_v1";
const FEATURED_VOLUME_KEY = "sportsync_highlights_featured_volume_v1";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const LEAGUE_LOGOS: Partial<Record<SportFilter, string>> = {
  NFL: "https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png",
  NBA: "https://a.espncdn.com/i/teamlogos/leagues/500/nba.png",
  MLB: "https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png",
  NHL: "https://a.espncdn.com/i/teamlogos/leagues/500/nhl.png",
  EPL: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png",
};
const SPORT_OPTIONS: ReadonlyArray<{ id: SportFilter; label: string; sport: string }> = [
  { id: "ALL", label: "All", sport: "All sports" },
  ...SUPPORTED_SPORTS.map((sport) => ({ id: sport.id, label: sport.label, sport: sport.sport })),
];
const SORT_OPTIONS: ReadonlyArray<{ id: SortMode; label: string }> = [
  { id: "POPULAR", label: "Most Popular" },
  { id: "RECENT", label: "Most Recent" },
  { id: "OLDEST", label: "Oldest" },
];

const warmedHighlightAssets = new Set<string>();

function clampFeaturedVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.72;
  }

  return Math.min(1, Math.max(0, value));
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
    // Ignore storage quota failures and keep the page interactive.
  }
}

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJson<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota failures and keep the page interactive.
  }
}

function parseTimestamp(value?: number | string | null): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value * 1000;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function getLocalDateValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getClipLocalDateValue(item: HighlightItem): string | null {
  const publishedTimestamp = typeof item.publishedTs === "number" && Number.isFinite(item.publishedTs)
    ? item.publishedTs * 1000
    : parseTimestamp(item.publishedAt);

  if (!publishedTimestamp) {
    return null;
  }

  return getLocalDateValue(new Date(publishedTimestamp));
}

function filterHighlightsForDate(items: HighlightItem[], selectedDateValue: string): HighlightItem[] {
  return items.filter((item) => {
    const clipDateValue = getClipLocalDateValue(item);
    return !clipDateValue || clipDateValue === selectedDateValue;
  });
}

function toHighlightsRequestDate(value: string): string {
  return value.replace(/-/g, "");
}

function formatSelectedDateLabel(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return "this day";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

function buildHighlightsCacheSlot(sport: SportFilter, dateValue: string): string {
  return `${sport}:${toHighlightsRequestDate(dateValue)}`;
}

function formatAbsoluteStamp(value?: string | null): string {
  const timestamp = parseTimestamp(value);
  if (!timestamp) {
    return "Fresh now";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function normalizeHighlightsDateValue(rawDateValue: string, todayDateValue: string): string | null {
  const trimmed = `${rawDateValue || ""}`.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }

  return trimmed > todayDateValue ? todayDateValue : trimmed;
}

function formatClipPublishedAt(value?: string | null, selectedDateValue?: string): string {
  const timestamp = parseTimestamp(value);
  if (!timestamp) {
    return "Fresh now";
  }

  const todayDateValue = getLocalDateValue();
  const requestedDateValue = selectedDateValue || todayDateValue;

  if (requestedDateValue === todayDateValue) {
    const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
    if (diffMinutes <= 1) {
      return "Just now";
    }
    if (diffMinutes < 60) {
      return `${diffMinutes} minutes ago`;
    }

    const diffHours = Math.max(1, Math.floor(diffMinutes / 60));
    return `${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`;
  }

  return formatAbsoluteStamp(value);
}

function isFreshGeneratedAt(value?: string | null): boolean {
  const timestamp = parseTimestamp(value);
  return Boolean(timestamp && Date.now() - timestamp < CACHE_TTL_MS);
}

function isPlayableClip(item: HighlightItem): boolean {
  return Boolean(item.videoUrl || item.hlsUrl || item.embedUrl);
}

function isEmbeddedOnlyClip(item?: HighlightItem | null): boolean {
  return Boolean(item?.embedUrl && !item?.videoUrl && !item?.hlsUrl);
}

function isLegacyBrokenPoster(url?: string | null): boolean {
  const raw = `${url || ""}`.trim().toLowerCase();
  if (!raw) {
    return false;
  }

  return raw.includes("espncdn.com/combiner") || raw.includes("/combiner/") || raw.includes("img=");
}

function isStaleCachedHighlight(item: HighlightItem): boolean {
  if (
    isLegacyBrokenPoster(item.posterUrl)
    || isLegacyBrokenPoster(item.widePosterUrl)
    || isLegacyBrokenPoster(item.squarePosterUrl)
    || isLegacyBrokenPoster(item.verticalPosterUrl)
  ) {
    return true;
  }

  return typeof item.videoVariants === "undefined";
}

function hasStaleCachedHighlights(items: HighlightItem[]): boolean {
  return items.some((item) => isStaleCachedHighlight(item));
}

function getSourceLabel(item: HighlightItem): string {
  return `${item.source || "Source"}`.trim() || "Source";
}

function getClipRuntimeLabel(item: HighlightItem): string {
  if (item.durationLabel) {
    return item.durationLabel;
  }

  const durationSeconds = Math.round(item.durationSeconds || 0);
  if (durationSeconds <= 0) {
    return "Not listed";
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatCountdownLabel(secondsRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(secondsRemaining));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getClipTypeLabel(item: HighlightItem): string {
  return `${item.typeLabel || ""}`.trim() || "Latest clip";
}

function normalizeClipText(value?: string | null): string {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getClipSummary(item: HighlightItem): string {
  const title = (item.title || "").trim();
  const description = (item.description || "").trim();
  const normalizedTitle = normalizeClipText(title);
  const normalizedDescription = normalizeClipText(description);

  if (
    description &&
    normalizedDescription &&
    normalizedDescription !== normalizedTitle &&
    !normalizedTitle.includes(normalizedDescription) &&
    !normalizedDescription.includes(normalizedTitle)
  ) {
    return description;
  }

  const teamTags = (item.teamTags || []).filter(Boolean);
  if (teamTags.length >= 2) {
    return `Featuring ${teamTags[0]} and ${teamTags[1]}.`;
  }
  if (teamTags.length === 1) {
    return `Featuring ${teamTags[0]}.`;
  }

  const sourceLabel = getSourceLabel(item);
  if (item.typeLabel && sourceLabel) {
    return `${item.typeLabel} from ${sourceLabel}.`;
  }
  if (item.typeLabel) {
    return `${item.typeLabel}.`;
  }
  if (sourceLabel) {
    return `Latest highlight from ${sourceLabel}.`;
  }

  return "";
}

function getPosterCandidates(item: HighlightItem, variant: PosterVariant): string[] {
  const candidateMap = {
    WIDE: [item.widePosterUrl, item.posterUrl, item.squarePosterUrl, item.verticalPosterUrl],
    TALL: [item.verticalPosterUrl, item.posterUrl, item.widePosterUrl, item.squarePosterUrl],
    SQUARE: [item.squarePosterUrl, item.posterUrl, item.widePosterUrl, item.verticalPosterUrl],
  } satisfies Record<PosterVariant, Array<string | null | undefined>>;

  const seen = new Set<string>();
  return candidateMap[variant].reduce<string[]>((resolvedCandidates, url) => {
    const resolved = resolveHighlightAssetUrl(url);
    if (!resolved || seen.has(resolved)) {
      return resolvedCandidates;
    }
    seen.add(resolved);
    resolvedCandidates.push(resolved);
    return resolvedCandidates;
  }, []);
}

function resolveHighlightAssetUrl(url?: string | null): string {
  const cleanUrl = `${url || ""}`.trim();
  if (!cleanUrl) {
    return "";
  }

  try {
    return new URL(cleanUrl, API_BASE_URL).toString();
  } catch {
    return cleanUrl;
  }
}

function sortVideoVariants(variants: HighlightVideoVariant[]): HighlightVideoVariant[] {
  return [...variants].sort((left, right) => {
    const leftIsSource = /source/i.test(left.label || "") || /mezzanine/i.test(left.id || "");
    const rightIsSource = /source/i.test(right.label || "") || /mezzanine/i.test(right.id || "");
    if (leftIsSource !== rightIsSource) {
      return leftIsSource ? 1 : -1;
    }

    const leftHeight = Number(left.height) || 0;
    const rightHeight = Number(right.height) || 0;
    if (rightHeight !== leftHeight) {
      return rightHeight - leftHeight;
    }

    const leftBitrate = Number(left.bitrate) || 0;
    const rightBitrate = Number(right.bitrate) || 0;
    return rightBitrate - leftBitrate;
  });
}

function buildProgressiveQualityOptions(
  variants?: HighlightVideoVariant[] | null,
  fallbackUrl?: string | null,
): ViewerQualityOption[] {
  const seenUrls = new Set<string>();
  const seenLabels = new Set<string>();
  const nextOptions: ViewerQualityOption[] = [];
  const sortedVariants = sortVideoVariants((variants || []).filter((variant) => Boolean(variant?.url)));
  const cleanFallback = `${fallbackUrl || ""}`.trim();
  const fallbackUsesEspnOrigin = /media\.video-origin\.espn\.com/i.test(cleanFallback);

  if (cleanFallback) {
    seenUrls.add(cleanFallback);
    seenLabels.add("original");
    nextOptions.push({
      id: "mp4-fallback",
      label: "Original",
      mode: "mp4",
      url: cleanFallback,
    });
  }

  for (const variant of sortedVariants) {
    const cleanUrl = `${variant.url || ""}`.trim();
    const cleanLabel = `${variant.label || ""}`.trim().toLowerCase();
    const usesEspnCdnVariant = /media\.video-cdn\.espn\.com/i.test(cleanUrl);
    if (fallbackUsesEspnOrigin && usesEspnCdnVariant) {
      continue;
    }

    if (!cleanUrl || seenUrls.has(cleanUrl) || (cleanLabel && seenLabels.has(cleanLabel))) {
      continue;
    }

    seenUrls.add(cleanUrl);
    if (cleanLabel) {
      seenLabels.add(cleanLabel);
    }
    nextOptions.push({
      id: `mp4-${variant.id}`,
      label: variant.label || `${variant.height || "HD"}p`,
      mode: "mp4",
      url: cleanUrl,
    });
  }

  return nextOptions;
}

function normalizeLookupValue(value?: string | null): string {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function parseVideoRatio(value?: string | null): number | null {
  const raw = `${value || ""}`.trim().toLowerCase();
  if (!raw) {
    return null;
  }

  if (raw.includes("vertical") || raw.includes("portrait")) {
    return 9 / 16;
  }

  const ratioMatch = raw.match(/(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)/);
  if (ratioMatch) {
    const width = Number(ratioMatch[1]);
    const height = Number(ratioMatch[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && height > 0) {
      return width / height;
    }
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  return null;
}

function getContentFormat(item: HighlightItem): ContentFormat {
  if (item.contentFormat === "REEL" || item.contentFormat === "VIDEO") {
    return item.contentFormat;
  }

  const ratio = parseVideoRatio(item.videoRatio);
  if (ratio && ratio < 0.92) {
    return "REEL";
  }

  if (!ratio && item.verticalPosterUrl && !item.widePosterUrl) {
    return "REEL";
  }

  return "VIDEO";
}

function getItemTeamKeys(item: HighlightItem): string[] {
  return (item.teamTags || [])
    .map((tag) => normalizeLookupValue(tag))
    .filter(Boolean);
}

function buildSavedTeamKeys(items: SavedTeamResponse[]): string[] {
  const keys = new Set<string>();
  items.forEach((item) => {
    const fullName = normalizeLookupValue(item.name || "");
    const shortName = normalizeLookupValue(item.short_name || "");
    const cityName = normalizeLookupValue(`${item.city || ""} ${item.name || ""}`);
    if (fullName) keys.add(fullName);
    if (shortName) keys.add(shortName);
    if (cityName) keys.add(cityName);
  });
  return [...keys];
}

function upsertWatchHistory(history: HighlightInteraction[], item: HighlightItem): HighlightInteraction[] {
  const now = Date.now();
  const nextEntry: HighlightInteraction = {
    id: item.id,
    league: item.league,
    teamTags: (item.teamTags || []).slice(0, 4),
    contentFormat: getContentFormat(item),
    lastOpenedAt: now,
    openCount: 1,
  };

  const existing = history.find((entry) => entry.id === item.id);
  const merged = existing
    ? {
        ...existing,
        league: item.league,
        teamTags: (item.teamTags || []).slice(0, 4),
        contentFormat: getContentFormat(item),
        lastOpenedAt: now,
        openCount: existing.openCount + 1,
      }
    : nextEntry;

  return [
    merged,
    ...history.filter((entry) => entry.id !== item.id),
  ].slice(0, 48);
}

function warmPosters(items: HighlightItem[]): void {
  if (typeof window === "undefined") {
    return;
  }

  items.forEach((item) => {
    [...getPosterCandidates(item, "WIDE"), ...getPosterCandidates(item, "TALL"), ...getPosterCandidates(item, "SQUARE")].forEach((url) => {
      if (!url || warmedHighlightAssets.has(url)) {
        return;
      }
      warmedHighlightAssets.add(url);
      const image = new Image();
      image.decoding = "async";
      image.src = url;
    });
  });
}

function buildQualityOptions(levels: Hls["levels"]): ViewerQualityOption[] {
  const uniqueLevels = [...levels]
    .map((level, index) => ({
      index,
      height: Number(level.height) || 0,
      bitrate: Number(level.bitrate) || 0,
    }))
    .sort((left, right) => {
      if (right.height !== left.height) {
        return right.height - left.height;
      }
      return right.bitrate - left.bitrate;
    })
    .filter((level, index, all) => all.findIndex((candidate) => candidate.height === level.height) === index);

  return [
    { id: "auto", label: "Auto", mode: "hls", level: "auto" },
    ...uniqueLevels.map((level) => ({
      id: `level-${level.index}`,
      label: level.height ? `${level.height}p` : `${Math.max(1, Math.round(level.bitrate / 1_000_000))} Mbps`,
      mode: "hls" as const,
      level: level.index,
    })),
  ];
}

function seekVideoSafely(video: HTMLVideoElement, time: number): void {
  if (!Number.isFinite(time) || time <= 0.15) {
    return;
  }

  try {
    if (typeof video.fastSeek === "function") {
      video.fastSeek(time);
      return;
    }
  } catch {
    // Fall through to a standard seek when fastSeek is not available or fails.
  }

  try {
    video.currentTime = time;
  } catch {
    // Ignore seek timing races until the media pipeline is ready enough to resume.
  }
}

function getPopularityScore(item: HighlightItem): number {
  if (typeof item.popularityScore === "number" && Number.isFinite(item.popularityScore)) {
    return item.popularityScore;
  }

  const title = `${item.title || ""} ${item.description || ""}`.toLowerCase();
  const typeLabel = `${item.typeLabel || ""}`.toLowerCase();
  const ageHours = Math.max(0, (Date.now() - parseTimestamp(item.publishedTs ?? item.publishedAt ?? null)) / 3_600_000);

  let score = Math.max(0, 132 - ageHours * 2.4);

  if (ageHours <= 6) score += 20;
  else if (ageHours <= 24) score += 10;
  else if (ageHours > 72) score -= 22;
  else if (ageHours > 168) score -= 56;

  if (typeLabel.includes("top plays")) score += 28;
  else if (typeLabel.includes("game highlights")) score += 22;
  else if (typeLabel.includes("clutch")) score += 20;
  else if (typeLabel.includes("highlights")) score += 15;
  else if (typeLabel.includes("recap")) score += 6;

  if (/(walk-off|game[- ]winner|game[- ]winning|buzzer|poster|slam|dunk|touchdown|pick-six|interception|home run|grand slam|hat trick|lights the lamp|goal|equalizer|overtime winner|shootout winner|comeback|go-ahead|game-tying|game-tying shot|game-tying goal|clutch|dagger|winner at the buzzer)/.test(title)) {
    score += 28;
  }

  if (/(best plays|top plays|game highlights|highlights)/.test(title)) {
    score += 10;
  }

  if (/(what have been the keys|reacts?|breaks down|analysis|interview|press conference|pregame|postgame|availability|preview|speaks after|discusses|podcast|storylines)/.test(title)) {
    score -= 28;
  }

  score += Math.min(item.teamTags?.length || 0, 3) * 3;

  if ((item.durationSeconds || 0) >= 20 && (item.durationSeconds || 0) <= 140) {
    score += 6;
  }

  if (item.videoUrl || item.hlsUrl || item.embedUrl) {
    score += 4;
  }

  return score;
}

function getHighlightAgeHours(item: HighlightItem): number {
  const timestamp = parseTimestamp(item.publishedTs ?? item.publishedAt ?? null);
  if (!timestamp) {
    return 10_000;
  }

  return Math.max(0, (Date.now() - timestamp) / 3_600_000);
}

function compareByPopularity(a: HighlightItem, b: HighlightItem): number {
  const popularityDiff = getPopularityScore(b) - getPopularityScore(a);
  if (Math.abs(popularityDiff) > 0.1) {
    return popularityDiff;
  }
  return parseTimestamp(b.publishedTs ?? b.publishedAt ?? null) - parseTimestamp(a.publishedTs ?? a.publishedAt ?? null);
}

function sortHighlights(items: HighlightItem[], sortMode: SortMode): HighlightItem[] {
  const next = [...items];

  if (sortMode === "RECENT") {
    next.sort((a, b) => {
      const diff = parseTimestamp(b.publishedTs ?? b.publishedAt ?? null) - parseTimestamp(a.publishedTs ?? a.publishedAt ?? null);
      return diff || compareByPopularity(a, b);
    });
    return next;
  }

  if (sortMode === "OLDEST") {
    next.sort((a, b) => {
      const diff = parseTimestamp(a.publishedTs ?? a.publishedAt ?? null) - parseTimestamp(b.publishedTs ?? b.publishedAt ?? null);
      if (diff !== 0) {
        return diff;
      }
      return compareByPopularity(a, b);
    });
    return next;
  }

  next.sort(compareByPopularity);
  return next;
}

function buildFeaturedHighlights(items: HighlightItem[], sport: SportFilter): HighlightItem[] {
  const popular = sortHighlights(items, "POPULAR");
  const freshFirst = popular.filter((item) => getHighlightAgeHours(item) <= 36);
  const pool = freshFirst.length
    ? uniqueQueue([...freshFirst, ...popular])
    : popular;

  if (sport !== "ALL") {
    const featuredCount = Math.min(3, Math.max(1, pool.length - 1));
    return pool.slice(0, featuredCount);
  }

  const featured: HighlightItem[] = [];
  const leagues = new Set<string>();

  for (const item of pool) {
    if (!leagues.has(item.league)) {
      featured.push(item);
      leagues.add(item.league);
    }
    if (featured.length === 5) {
      return featured;
    }
  }

  for (const item of pool) {
    if (featured.some((candidate) => candidate.id === item.id)) {
      continue;
    }
    featured.push(item);
    if (featured.length === 5) {
      break;
    }
  }

  return featured.slice(0, 5);
}

function getLaneContentFormat(layoutMode: LayoutMode): ContentFormat {
  return layoutMode === "REELS" ? "REEL" : "VIDEO";
}

function buildLaneEmptyState(
  layoutMode: LayoutMode,
  sport: SportFilter,
  selectedDateValue: string,
): { title: string; body: string } {
  const selectedDateLabel = formatSelectedDateLabel(selectedDateValue);
  if (selectedDateValue > getLocalDateValue()) {
    return {
      title: `No clips yet for ${selectedDateLabel}.`,
      body: "Future days stay empty until games happen and the providers actually publish fresh highlights.",
    };
  }

  if (layoutMode === "REELS") {
    if (sport === "ALL") {
      return {
        title: `No true reels are ready for ${selectedDateLabel}.`,
        body: "The free providers currently serving the feed are only returning standard sports videos for this date. This lane will fill automatically as soon as a real vertical reel shows up.",
      };
    }

    return {
      title: `No ${sport} reels are ready for ${selectedDateLabel}.`,
      body: `The current free providers for ${sport} are only returning standard videos for this date. When a true vertical ${sport} reel appears, it will land here automatically.`,
    };
  }

  return {
    title: `No playable videos are ready for ${selectedDateLabel}.`,
    body: "We are still polling the current providers for fresh standard clips on that day. Pick another date or hit refresh if you think the feed should already be there.",
  };
}

function filterHighlightsByLayout(items: HighlightItem[], layoutMode: LayoutMode): HighlightItem[] {
  const requiredFormat = getLaneContentFormat(layoutMode);
  return items.filter((item) => getContentFormat(item) === requiredFormat);
}

function uniqueQueue(items: HighlightItem[]): HighlightItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function buildRecommendationReason(
  item: HighlightItem,
  currentClip: HighlightItem,
  preferredSports: Set<string>,
  savedTeamKeys: Set<string>,
  watchHistory: HighlightInteraction[],
): string {
  const currentTeamKeys = new Set(getItemTeamKeys(currentClip));
  const itemTeamKeys = getItemTeamKeys(item);

  if (itemTeamKeys.some((tag) => savedTeamKeys.has(tag))) {
    return "Matches your saved teams";
  }

  if (itemTeamKeys.some((tag) => currentTeamKeys.has(tag))) {
    return "Keeps the same matchup thread";
  }

  if (preferredSports.has(item.league.toUpperCase())) {
    return "Fits your league focus";
  }

  if (watchHistory.some((entry) => entry.league === item.league)) {
    return `Because you keep opening ${item.league} clips`;
  }

  return "Trending in your feed";
}

function buildPersonalizedRecommendations({
  pool,
  currentClip,
  activeSport,
  preferredSports,
  savedTeamKeys,
  watchHistory,
}: {
  pool: HighlightItem[];
  currentClip: HighlightItem;
  activeSport: SportFilter;
  preferredSports: Set<string>;
  savedTeamKeys: Set<string>;
  watchHistory: HighlightInteraction[];
}): HighlightItem[] {
  const currentTeamKeys = new Set(getItemTeamKeys(currentClip));
  const historyByLeague = new Map<string, number>();
  const historyByTeam = new Map<string, number>();

  watchHistory.forEach((entry) => {
    historyByLeague.set(entry.league, (historyByLeague.get(entry.league) || 0) + entry.openCount);
    entry.teamTags.forEach((tag) => {
      const normalized = normalizeLookupValue(tag);
      if (!normalized) {
        return;
      }
      historyByTeam.set(normalized, (historyByTeam.get(normalized) || 0) + entry.openCount);
    });
  });

  return [...pool]
    .filter((item) => item.id !== currentClip.id)
    .sort((left, right) => {
      const scoreItem = (item: HighlightItem) => {
        const itemTeamKeys = getItemTeamKeys(item);
        let score = getPopularityScore(item);

        if (item.league === currentClip.league) score += 42;
        if (activeSport !== "ALL" && item.league === activeSport) score += 14;
        if (getContentFormat(item) === getContentFormat(currentClip)) score += 10;

        const sharedCurrentTeams = itemTeamKeys.filter((tag) => currentTeamKeys.has(tag)).length;
        score += sharedCurrentTeams * 18;

        const savedMatches = itemTeamKeys.filter((tag) => savedTeamKeys.has(tag)).length;
        score += savedMatches * 24;

        if (preferredSports.has(item.league.toUpperCase())) score += 16;

        score += (historyByLeague.get(item.league) || 0) * 6;
        score += itemTeamKeys.reduce((total, tag) => total + (historyByTeam.get(tag) || 0) * 5, 0);

        return score;
      };

      const diff = scoreItem(right) - scoreItem(left);
      if (diff !== 0) {
        return diff;
      }

      return compareByPopularity(left, right);
    })
    .slice(0, 8);
}

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function IconChevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {direction === "left" ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function IconFilter() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M7.5 3.5v4" />
      <path d="M16.5 3.5v4" />
      <path d="M3.5 10h17" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 6.5v11l9-5.5-9-5.5Z" />
    </svg>
  );
}

function IconVolume({ muted }: { muted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5 9.5h3.7L13 6v12l-4.3-3.5H5z" />
      {muted ? (
        <>
          <path d="m17 9 4 6" />
          <path d="m21 9-4 6" />
        </>
      ) : (
        <>
          <path d="M16.8 9.4a4.7 4.7 0 0 1 0 5.2" />
          <path d="M19.6 7a8.15 8.15 0 0 1 0 10" />
        </>
      )}
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M10.6 3.2h2.8l.5 2.2a6.9 6.9 0 0 1 1.8.75l2-1.05 1.98 1.98-1.05 2a6.9 6.9 0 0 1 .75 1.8l2.2.5v2.8l-2.2.5a6.9 6.9 0 0 1-.75 1.8l1.05 2-1.98 1.98-2-1.05a6.9 6.9 0 0 1-1.8.75l-.5 2.2h-2.8l-.5-2.2a6.9 6.9 0 0 1-1.8-.75l-2 1.05-1.98-1.98 1.05-2a6.9 6.9 0 0 1-.75-1.8l-2.2-.5v-2.8l2.2-.5a6.9 6.9 0 0 1 .75-1.8l-1.05-2 1.98-1.98 2 1.05a6.9 6.9 0 0 1 1.8-.75z" />
      <circle cx="12" cy="12" r="3.1" />
    </svg>
  );
}

function IconLeagueGlyph({
  sportId,
  className = "h-4 w-4",
}: {
  sportId: SportFilter;
  className?: string;
}) {
  const leagueLogo = LEAGUE_LOGOS[sportId];
  const [logoFailed, setLogoFailed] = useState(false);

  if (leagueLogo && !logoFailed) {
    return (
      <img
        src={leagueLogo}
        alt=""
        aria-hidden="true"
        className={`${className} object-contain`}
        loading="eager"
        referrerPolicy="no-referrer"
        onError={() => setLogoFailed(true)}
      />
    );
  }

  if (sportId === "ALL") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" className={className}>
        <rect x="4" y="4" width="6" height="6" rx="1.2" />
        <rect x="14" y="4" width="6" height="6" rx="1.2" />
        <rect x="4" y="14" width="6" height="6" rx="1.2" />
        <rect x="14" y="14" width="6" height="6" rx="1.2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16" />
      <path d="M4 12h16" />
      <path d="M7.5 7.5c2.2 1.2 6.8 1.2 9 0" />
      <path d="M7.5 16.5c2.2-1.2 6.8-1.2 9 0" />
    </svg>
  );
}

function HighlightPoster({
  item,
  variant,
  alt,
  className,
  loading = "lazy",
  fetchPriority = "auto",
}: {
  item: HighlightItem;
  variant: PosterVariant;
  alt: string;
  className: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
}) {
  const candidates = useMemo(() => getPosterCandidates(item, variant), [item, variant]);
  const candidateKey = useMemo(() => `${item.id}:${variant}:${candidates.join("|")}`, [candidates, item.id, variant]);
  const [candidateState, setCandidateState] = useState<{ key: string; index: number }>({
    key: candidateKey,
    index: 0,
  });
  const candidateIndex = candidateState.key === candidateKey ? candidateState.index : 0;
  const source = candidates[candidateIndex] || null;

  if (!source) {
    return (
                    <div className="highlights-hero-backdrop flex h-full w-full items-center justify-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/84 backdrop-blur-sm">
          <IconLeagueGlyph sportId={(item.league as SportFilter) || "ALL"} className="h-3.5 w-3.5" />
          <span>{item.league || "Clip"}</span>
        </div>
      </div>
    );
  }

  return (
    <img
      src={source}
      alt={alt}
      className={className}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => {
        setCandidateState((current) => {
          const currentIndex = current.key === candidateKey ? current.index : 0;
          return {
            key: candidateKey,
            index: currentIndex < candidates.length - 1 ? currentIndex + 1 : candidates.length,
          };
        });
      }}
    />
  );
}

function HighlightsSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[32px] border border-white/8 bg-surface/80 p-6">
          <div className="skeleton-pulse h-5 w-36" />
          <div className="mt-4 skeleton-pulse h-12 w-3/4" />
          <div className="mt-3 skeleton-pulse h-5 w-full" />
          <div className="mt-2 skeleton-pulse h-5 w-2/3" />
        </div>
        <div className="rounded-[32px] border border-white/8 bg-surface/80 p-6">
          <div className="skeleton-pulse h-5 w-24" />
          <div className="mt-4 flex gap-3 overflow-hidden">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="skeleton-pulse h-56 w-40 flex-none rounded-[24px]" />
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="skeleton-pulse h-[28rem] w-[18rem] flex-none rounded-[28px]" />
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-[28px] border border-white/8 bg-surface/75 p-4">
            <div className="skeleton-pulse aspect-[10/14] rounded-[22px]" />
            <div className="mt-4 skeleton-pulse h-4 w-24" />
            <div className="mt-3 skeleton-pulse h-8 w-full" />
            <div className="mt-2 skeleton-pulse h-5 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HighlightsPage() {
  const { user } = useAuth();
  const todayDateValue = getLocalDateValue();
  const layoutMode: LayoutMode = "VIDEOS";
  const [activeSport, setActiveSport] = useState<SportFilter>("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("POPULAR");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedDateValue, setSelectedDateValue] = useState<string>(() =>
    readSessionJson<string>(SELECTED_DATE_KEY, getLocalDateValue())
  );
  const [visibleWallCount, setVisibleWallCount] = useState(WALL_PAGE_SIZE);
  const [activeFeaturedIndex, setActiveFeaturedIndex] = useState(0);
  const [viewerClipId, setViewerClipId] = useState<string | null>(null);
  const [viewerQueueIds, setViewerQueueIds] = useState<string[]>([]);
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [featuredReady, setFeaturedReady] = useState(false);
  const [featuredPlaybackSeconds, setFeaturedPlaybackSeconds] = useState(0);
  const [featuredDurationSeconds, setFeaturedDurationSeconds] = useState<number | null>(null);
  const [featuredMuted, setFeaturedMuted] = useState<boolean>(() =>
    readSessionJson<boolean>(FEATURED_MUTED_KEY, true)
  );
  const [featuredVolume, setFeaturedVolume] = useState<number>(() =>
    clampFeaturedVolume(readSessionJson<number>(FEATURED_VOLUME_KEY, 0.72))
  );
  const [viewerQualityOptions, setViewerQualityOptions] = useState<ViewerQualityOption[]>([]);
  const [viewerQualitySelection, setViewerQualitySelection] = useState<string>("auto");
  const [viewerQualityOpen, setViewerQualityOpen] = useState(false);
  const [watchHistory, setWatchHistory] = useState<HighlightInteraction[]>(() =>
    readLocalJson<HighlightInteraction[]>(WATCH_HISTORY_KEY, [])
  );

  const featuredVideoRef = useRef<HTMLVideoElement | null>(null);
  const featuredHlsRef = useRef<Hls | null>(null);
  const featuredPlaybackRef = useRef<Record<string, number>>({});
  const featuredCurrentIdRef = useRef<string | null>(null);
  const featuredMutedRef = useRef(featuredMuted);
  const featuredVolumeRef = useRef(featuredVolume);
  const featuredLastAudibleVolumeRef = useRef(featuredVolume > 0.01 ? featuredVolume : 0.72);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const viewerPlaybackRef = useRef<Record<string, number>>({});
  const viewerResumeRef = useRef<{ clipId: string; time: number; shouldPlay: boolean } | null>(null);
  const cacheRef = useRef<HighlightCacheMap>(readSessionJson<HighlightCacheMap>(CACHE_KEY, {}));
  const lastTrackedClipIdRef = useRef<string | null>(null);
  const viewerScrollYRef = useRef(0);
  const viewerStartAtRef = useRef<{ clipId: string; time: number } | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  const commitDateInputValue = useCallback((input: HTMLInputElement) => {
    const nextDateValue = normalizeHighlightsDateValue(input.value, todayDateValue);
    if (!nextDateValue) {
      input.value = selectedDateValue;
      return;
    }

    input.value = nextDateValue;
    if (nextDateValue !== selectedDateValue) {
      setSelectedDateValue(nextDateValue);
    }
  }, [selectedDateValue, todayDateValue]);

  const toggleFeaturedMuted = useCallback((event?: SyntheticEvent) => {
    event?.preventDefault();
    event?.stopPropagation();

    setFeaturedMuted((current) => {
      if (current && featuredVolumeRef.current <= 0.01) {
        setFeaturedVolume(
          clampFeaturedVolume(featuredLastAudibleVolumeRef.current > 0.01 ? featuredLastAudibleVolumeRef.current : 0.72)
        );
      }
      return !current;
    });
  }, []);

  const handleFeaturedVolumeChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    const nextVolume = clampFeaturedVolume(Number(event.target.value) / 100);
    setFeaturedVolume(nextVolume);
    setFeaturedMuted(nextVolume <= 0.01);
  }, []);

  const highlightsQuery = useQuery<HighlightCacheEntry>({
    queryKey: ["highlights", activeSport, selectedDateValue],
    queryFn: async () => {
      const cacheSlot = buildHighlightsCacheSlot(activeSport, selectedDateValue);
      const rawCacheEntry = cacheRef.current[cacheSlot];
      const cacheEntry = rawCacheEntry && hasStaleCachedHighlights(rawCacheEntry.highlights)
        ? null
        : rawCacheEntry;

      if (rawCacheEntry && !cacheEntry) {
        const nextCache = { ...cacheRef.current };
        delete nextCache[cacheSlot];
        cacheRef.current = nextCache;
        writeSessionJson(CACHE_KEY, nextCache);
      }

      const shouldUseCache =
        cacheEntry &&
        Date.now() - cacheEntry.cachedAt < CACHE_TTL_MS &&
        isFreshGeneratedAt(cacheEntry.generatedAt);

      if (shouldUseCache) {
        return {
          ...cacheEntry,
          highlights: filterHighlightsForDate(cacheEntry.highlights, selectedDateValue),
        };
      }

      const requestHighlightsForLimit = async (limit: number) =>
        apiClient.get<HighlightsResponse>(API.SPORTS_HIGHLIGHTS, {
          params: {
            date: toHighlightsRequestDate(selectedDateValue),
            league: activeSport === "ALL" ? undefined : activeSport,
            limit,
          },
        });

      let response;
      try {
        response = await requestHighlightsForLimit(REQUEST_LIMIT);
      } catch (primaryError) {
        const errorStatus = typeof primaryError === "object" && primaryError && "response" in primaryError
          ? Number((primaryError as { response?: { status?: number } }).response?.status || 0)
          : 0;

        if (REQUEST_LIMIT > 60 && errorStatus === 422) {
          response = await requestHighlightsForLimit(60);
        } else {
          throw primaryError;
        }
      }

      const { data } = response;
      const nextHighlights = filterHighlightsForDate((data.highlights || []).filter(isPlayableClip), selectedDateValue);
      const nextGeneratedAt = data.generatedAt || new Date().toISOString();
      const nextEntry: HighlightCacheEntry = {
        cachedAt: Date.now(),
        generatedAt: nextGeneratedAt,
        highlights: nextHighlights,
      };

      cacheRef.current = {
        ...cacheRef.current,
        [cacheSlot]: nextEntry,
      };
      writeSessionJson(CACHE_KEY, cacheRef.current);
      return nextEntry;
    },
    initialData: () => {
      const cacheSlot = buildHighlightsCacheSlot(activeSport, selectedDateValue);
      const cacheEntry = cacheRef.current[cacheSlot];
      if (!cacheEntry || hasStaleCachedHighlights(cacheEntry.highlights)) {
        return undefined;
      }

      return {
        ...cacheEntry,
        highlights: filterHighlightsForDate(cacheEntry.highlights, selectedDateValue),
      };
    },
    staleTime: CACHE_TTL_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const savedTeamsQuery = useQuery<SavedTeamResponse[]>({
    queryKey: ["savedTeams"],
    queryFn: async () => {
      const { data } = await apiClient.get<SavedTeamResponse[]>(API.USER_TEAMS);
      return Array.isArray(data) ? data : [];
    },
    staleTime: 600_000,
    refetchOnWindowFocus: false,
  });

  const highlights = highlightsQuery.data?.highlights || [];
  const generatedAt = highlightsQuery.data?.generatedAt || null;
  const loading = highlightsQuery.isLoading;
  const error = highlightsQuery.error
    ? highlightsQuery.error instanceof Error
      ? highlightsQuery.error.message
      : "Could not load highlights right now."
    : null;
  const savedTeamKeys = useMemo(
    () => buildSavedTeamKeys(savedTeamsQuery.data || []),
    [savedTeamsQuery.data],
  );

  useEffect(() => {
    writeSessionJson(SELECTED_DATE_KEY, selectedDateValue);
  }, [selectedDateValue]);

  useEffect(() => {
    featuredMutedRef.current = featuredMuted;
    featuredVolumeRef.current = featuredVolume;
    if (featuredVolume > 0.01) {
      featuredLastAudibleVolumeRef.current = featuredVolume;
    }
    writeSessionJson(FEATURED_MUTED_KEY, featuredMuted);
    writeSessionJson(FEATURED_VOLUME_KEY, featuredVolume);

    const video = featuredVideoRef.current;
    if (!video) {
      return;
    }

    video.volume = featuredVolume;
    video.muted = featuredMuted || featuredVolume <= 0.01;
    video.defaultMuted = featuredMuted || featuredVolume <= 0.01;
    if (!video.muted && video.paused) {
      void video.play().catch(() => {
        // Keep the hero responsive even if autoplay stays blocked.
      });
    }
  }, [featuredMuted, featuredVolume]);

  useEffect(() => {
    if (dateInputRef.current && document.activeElement !== dateInputRef.current) {
      dateInputRef.current.value = selectedDateValue;
    }
  }, [selectedDateValue]);

  useEffect(() => {
    writeLocalJson(WATCH_HISTORY_KEY, watchHistory);
  }, [watchHistory]);

  const laneHighlights = useMemo(
    () => filterHighlightsByLayout(highlights, layoutMode),
    [highlights, layoutMode]
  );
  const activeFilterCount = useMemo(
    () =>
      Number(activeSport !== "ALL")
      + Number(sortMode !== "POPULAR")
      + Number(selectedDateValue !== todayDateValue),
    [activeSport, selectedDateValue, sortMode, todayDateValue]
  );

  const featuredHighlights = useMemo(
    () => buildFeaturedHighlights(laneHighlights, activeSport),
    [activeSport, laneHighlights]
  );

  useEffect(() => {
    if (!featuredHighlights.length) {
      setActiveFeaturedIndex(0);
      return;
    }

    setActiveFeaturedIndex((currentIndex) => {
      if (currentIndex < featuredHighlights.length) {
        return currentIndex;
      }
      return 0;
    });
  }, [featuredHighlights]);

  const featuredLead = featuredHighlights[activeFeaturedIndex] || null;
  const featuredPreviousPreview = useMemo(() => {
    if (featuredHighlights.length <= 1) {
      return null;
    }

    const nextIndex = (activeFeaturedIndex - 1 + featuredHighlights.length) % featuredHighlights.length;
    return featuredHighlights[nextIndex] || null;
  }, [activeFeaturedIndex, featuredHighlights]);
  const featuredNextPreview = useMemo(() => {
    if (featuredHighlights.length <= 1) {
      return null;
    }

    const nextIndex = (activeFeaturedIndex + 1) % featuredHighlights.length;
    return featuredHighlights[nextIndex] || null;
  }, [activeFeaturedIndex, featuredHighlights]);

  const sortedHighlights = useMemo(
    () => sortHighlights(laneHighlights, sortMode),
    [laneHighlights, sortMode]
  );

  const wallHighlights = useMemo(() => {
    const featuredIds = new Set(featuredHighlights.map((item) => item.id));
    return sortedHighlights.filter((item) => !featuredIds.has(item.id));
  }, [featuredHighlights, sortedHighlights]);
  const visibleWallHighlights = useMemo(
    () => wallHighlights.slice(0, visibleWallCount),
    [visibleWallCount, wallHighlights],
  );
  const canLoadMoreWallHighlights = visibleWallHighlights.length < wallHighlights.length;

  const featuredRemainingLabel = useMemo(() => {
    if (!featuredLead) {
      return "Clip";
    }

    const totalDuration =
      (featuredDurationSeconds && featuredDurationSeconds > 0 ? featuredDurationSeconds : null)
      ?? ((featuredLead.durationSeconds || 0) > 0 ? featuredLead.durationSeconds || 0 : null);

    if (!totalDuration) {
      return featuredLead.durationLabel || "Clip";
    }

    return formatCountdownLabel(totalDuration - featuredPlaybackSeconds);
  }, [featuredDurationSeconds, featuredLead, featuredPlaybackSeconds]);

  useEffect(() => {
    warmPosters([...featuredHighlights, ...wallHighlights.slice(0, Math.min(visibleWallCount + 6, wallHighlights.length))]);
  }, [featuredHighlights, visibleWallCount, wallHighlights]);

  useEffect(() => {
    setVisibleWallCount(WALL_PAGE_SIZE);
  }, [activeSport, layoutMode, selectedDateValue, sortMode, highlights]);

  useEffect(() => {
    const previousId = featuredCurrentIdRef.current;
    const previousVideo = featuredVideoRef.current;
    if (previousId && previousVideo && Number.isFinite(previousVideo.currentTime)) {
      featuredPlaybackRef.current[previousId] = previousVideo.currentTime;
    }

    featuredCurrentIdRef.current = featuredLead?.id || null;
    setFeaturedReady(false);
    setFeaturedPlaybackSeconds(featuredLead ? featuredPlaybackRef.current[featuredLead.id] || 0 : 0);
    setFeaturedDurationSeconds((featuredLead?.durationSeconds || 0) > 0 ? featuredLead?.durationSeconds || 0 : null);

    if (featuredHlsRef.current) {
      featuredHlsRef.current.destroy();
      featuredHlsRef.current = null;
    }

    if (!featuredLead || isEmbeddedOnlyClip(featuredLead)) {
      setFeaturedPlaybackSeconds(0);
      setFeaturedDurationSeconds(null);
      return;
    }

    const video = featuredVideoRef.current;
    if (!video) {
      return;
    }

    const pendingStart = featuredPlaybackRef.current[featuredLead.id] || 0;
    const progressiveOptions = buildProgressiveQualityOptions(featuredLead.videoVariants, featuredLead.videoUrl);
    const preferredFeaturedSource =
      progressiveOptions[0]?.url
      || featuredLead.videoUrl
      || "";
    const applyPendingStart = () => {
      if (pendingStart > 0.15) {
        try {
          video.currentTime = pendingStart;
        } catch {
          // Ignore seek errors until the stream is ready enough to resume.
        }
      }
    };

    video.pause();
    video.volume = featuredVolumeRef.current;
    video.muted = featuredMutedRef.current || featuredVolumeRef.current <= 0.01;
    video.defaultMuted = featuredMutedRef.current || featuredVolumeRef.current <= 0.01;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    video.removeAttribute("src");
    video.load();

    const handleLoadedMetadata = () => {
      applyPendingStart();
      setFeaturedDurationSeconds(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : ((featuredLead.durationSeconds || 0) > 0 ? featuredLead.durationSeconds || 0 : null));
      setFeaturedPlaybackSeconds(Number.isFinite(video.currentTime) ? video.currentTime : pendingStart);
      setFeaturedReady(true);
    };
    const handleCanPlay = () => {
      applyPendingStart();
      setFeaturedDurationSeconds(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : ((featuredLead.durationSeconds || 0) > 0 ? featuredLead.durationSeconds || 0 : null));
      setFeaturedPlaybackSeconds(Number.isFinite(video.currentTime) ? video.currentTime : pendingStart);
      setFeaturedReady(true);
      void video.play().catch(() => {
        // Keep the hero playable even if the browser blocks autoplay.
      });
    };
    const handleTimeUpdate = () => {
      featuredPlaybackRef.current[featuredLead.id] = video.currentTime;
      setFeaturedPlaybackSeconds(video.currentTime);
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setFeaturedDurationSeconds(video.duration);
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("timeupdate", handleTimeUpdate);

    const nativeHls = video.canPlayType("application/vnd.apple.mpegurl");
    if (preferredFeaturedSource) {
      video.src = preferredFeaturedSource;
      video.load();
    } else if (featuredLead.hlsUrl && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        capLevelToPlayerSize: false,
        startLevel: -1,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        backBufferLength: 120,
      });
      featuredHlsRef.current = hls;
      hls.loadSource(featuredLead.hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hls.levels.length) {
          const preferredLevel = hls.levels.reduce((bestIndex, level, index, levels) => {
            const bestLevel = levels[bestIndex];
            const levelHeight = Number(level.height) || 0;
            const bestHeight = Number(bestLevel.height) || 0;
            const levelBitrate = Number(level.bitrate) || 0;
            const bestBitrate = Number(bestLevel.bitrate) || 0;

            if (levelHeight > bestHeight) {
              return index;
            }
            if (levelHeight === bestHeight && levelBitrate > bestBitrate) {
              return index;
            }
            return bestIndex;
          }, 0);

          hls.startLevel = preferredLevel;
          hls.loadLevel = preferredLevel;
          hls.nextLevel = preferredLevel;
          hls.currentLevel = preferredLevel;
        }
        void video.play().catch(() => {
          // Keep the visual stable even if autoplay gets blocked by the browser.
        });
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) {
          return;
        }

        if (preferredFeaturedSource) {
          hls.destroy();
          featuredHlsRef.current = null;
          video.src = preferredFeaturedSource;
          video.load();
          return;
        }

        setFeaturedReady(false);
      });
    } else if (featuredLead.hlsUrl && nativeHls) {
      video.src = featuredLead.hlsUrl;
      video.load();
    } else {
      setFeaturedReady(false);
    }

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      if (featuredHlsRef.current) {
        featuredHlsRef.current.destroy();
        featuredHlsRef.current = null;
      }
    };
  }, [featuredLead]);

  useEffect(() => {
    const video = featuredVideoRef.current;
    if (!video || !featuredLead) {
      return;
    }

    if (viewerClipId) {
      featuredPlaybackRef.current[featuredLead.id] = video.currentTime;
      video.pause();
      return;
    }

    void video.play().catch(() => {
      // Keep the stage stable even if autoplay re-entry gets blocked.
    });
  }, [featuredLead, viewerClipId]);

  useEffect(() => {
    if (!featuredLead) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const video = featuredVideoRef.current;
      if (!video) {
        return;
      }

      if (Number.isFinite(video.currentTime)) {
        featuredPlaybackRef.current[featuredLead.id] = video.currentTime;
        setFeaturedPlaybackSeconds(video.currentTime);
      }

      if (Number.isFinite(video.duration) && video.duration > 0) {
        setFeaturedDurationSeconds(video.duration);
      }
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [featuredLead]);

  const viewerQueue = useMemo(() => {
    const byId = new Map(laneHighlights.map((item) => [item.id, item]));
    return viewerQueueIds
      .map((id) => byId.get(id))
      .filter((item): item is HighlightItem => Boolean(item));
  }, [laneHighlights, viewerQueueIds]);

  const viewerIndex = viewerQueue.findIndex((item) => item.id === viewerClipId);
  const viewerClip = viewerIndex >= 0 ? viewerQueue[viewerIndex] : null;
  const viewerFormat = viewerClip ? getContentFormat(viewerClip) : "VIDEO";
  const viewerUsesEmbed = isEmbeddedOnlyClip(viewerClip);
  const savedTeamKeySet = useMemo(() => new Set(savedTeamKeys), [savedTeamKeys]);
  const preferredSports = useMemo(
    () => new Set((user?.sports || []).map((sport) => sport.toUpperCase())),
    [user?.sports]
  );
  const personalizedRecommendations = useMemo(() => {
    if (!viewerClip) {
      return [];
    }

    return buildPersonalizedRecommendations({
      pool: sortedHighlights,
      currentClip: viewerClip,
      activeSport,
      preferredSports,
      savedTeamKeys: savedTeamKeySet,
      watchHistory,
    });
  }, [activeSport, preferredSports, savedTeamKeySet, sortedHighlights, viewerClip, watchHistory]);
  const recommendationRail = useMemo(() => {
    if (!viewerClip) {
      return [];
    }

    return uniqueQueue([
      ...personalizedRecommendations,
      ...viewerQueue.filter((item) => item.id !== viewerClip.id),
    ]).filter((item) => item.id !== viewerClip.id).slice(0, 12);
  }, [personalizedRecommendations, viewerClip, viewerQueue]);

  const laneEmptyState = useMemo(
    () => buildLaneEmptyState(layoutMode, activeSport, selectedDateValue),
    [activeSport, layoutMode, selectedDateValue]
  );

  useEffect(() => {
    if (viewerClipId && !laneHighlights.some((item) => item.id === viewerClipId)) {
      setViewerClipId(null);
      setViewerQueueIds([]);
    }
  }, [laneHighlights, viewerClipId]);

  useEffect(() => {
    if (!viewerClipId) {
      return;
    }

    viewerScrollYRef.current = window.scrollY;
    const previousOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    window.scrollTo({ top: 0, behavior: "auto" });

    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.scrollTo({ top: viewerScrollYRef.current, behavior: "auto" });
    };
  }, [viewerClipId]);

  useEffect(() => {
    if (!viewerClip) {
      lastTrackedClipIdRef.current = null;
      return;
    }

    if (lastTrackedClipIdRef.current === viewerClip.id) {
      return;
    }

    lastTrackedClipIdRef.current = viewerClip.id;
    setWatchHistory((previous) => upsertWatchHistory(previous, viewerClip));
  }, [viewerClip]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !viewerClip || !viewerQualityOptions.length) {
      return;
    }

    const selected = viewerQualityOptions.find((option) => option.id === viewerQualitySelection);
    if (!selected) {
      return;
    }

    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const wasPlaying = !video.paused && !video.ended;
    viewerPlaybackRef.current[viewerClip.id] = currentTime;
    viewerResumeRef.current = {
      clipId: viewerClip.id,
      time: currentTime,
      shouldPlay: wasPlaying,
    };

    const hls = hlsRef.current;
    if (selected.mode === "hls") {
      if (!hls) {
        return;
      }

      if (selected.level === "auto") {
        hls.loadLevel = -1;
        hls.nextLevel = -1;
        return;
      }

      hls.loadLevel = selected.level ?? -1;
      hls.nextLevel = selected.level ?? -1;
      return;
    }

    if (!selected.url) {
      return;
    }

    if (hls) {
      hls.destroy();
      hlsRef.current = null;
    }

    if (video.currentSrc === selected.url || video.src === selected.url) {
      return;
    }

    setViewerReady(false);

    let restored = false;
    const restorePlayback = () => {
      if (restored) {
        return;
      }

      restored = true;
      const pendingResume = viewerResumeRef.current?.clipId === viewerClip.id
        ? viewerResumeRef.current
        : null;
      seekVideoSafely(video, pendingResume?.time ?? currentTime);

      if (pendingResume?.shouldPlay ?? wasPlaying) {
        void video.play().catch(() => {
          // Keep controls usable even if autoplay is blocked.
        });
      }

      if (viewerResumeRef.current?.clipId === viewerClip.id) {
        viewerResumeRef.current = null;
      }
      setViewerReady(true);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("canplay", handleCanPlay);
    };
    const handleLoadedMetadata = () => restorePlayback();
    const handleCanPlay = () => restorePlayback();

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("canplay", handleCanPlay);
    video.src = selected.url;
    video.load();
  }, [viewerClip, viewerQualityOptions, viewerQualitySelection]);

  useEffect(() => {
    if (!viewerClip) {
      setViewerReady(false);
      setViewerError(null);
      setViewerQualityOptions([]);
      setViewerQualitySelection("auto");
      setViewerQualityOpen(false);
      viewerResumeRef.current = null;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    setViewerReady(false);
    setViewerError(null);
    setViewerQualityOptions([]);
    setViewerQualitySelection("auto");
    setViewerQualityOpen(false);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (isEmbeddedOnlyClip(viewerClip)) {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      setViewerError("This clip could not be played in the viewer.");
      return;
    }
    const playbackCache = viewerPlaybackRef.current;

    const clearPendingPlayback = () => {
      if (viewerStartAtRef.current?.clipId === viewerClip.id) {
        viewerStartAtRef.current = null;
      }
      if (viewerResumeRef.current?.clipId === viewerClip.id) {
        viewerResumeRef.current = null;
      }
    };
    const getPendingStart = () => {
      if (viewerStartAtRef.current?.clipId === viewerClip.id) {
        return Math.max(0, viewerStartAtRef.current.time);
      }

      if (viewerResumeRef.current?.clipId === viewerClip.id) {
        return Math.max(0, viewerResumeRef.current.time);
      }

      return playbackCache[viewerClip.id] ?? null;
    };
    const getShouldAutoPlay = () => {
      if (viewerResumeRef.current?.clipId === viewerClip.id) {
        return viewerResumeRef.current.shouldPlay;
      }

      return true;
    };
    const applyPendingStart = () => {
      const pendingStart = getPendingStart();
      if (pendingStart === null || pendingStart <= 0.1) {
        clearPendingPlayback();
        return;
      }

      seekVideoSafely(video, pendingStart);
      clearPendingPlayback();
    };

    video.pause();
    video.removeAttribute("src");
    video.load();

    const handleLoadedMetadata = () => {
      applyPendingStart();
      setViewerReady(true);
    };
    const handleCanPlay = () => {
      applyPendingStart();
      setViewerReady(true);
      if (getShouldAutoPlay()) {
        void video.play().catch(() => {
          // Playback may be blocked until explicit interaction; controls remain available.
        });
      }
    };
    const handleError = () => setViewerError("This clip could not be played in the viewer.");
    const handleTimeUpdate = () => {
      playbackCache[viewerClip.id] = video.currentTime;
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("error", handleError);
    video.addEventListener("timeupdate", handleTimeUpdate);

    const progressiveOptions = buildProgressiveQualityOptions(viewerClip.videoVariants, viewerClip.videoUrl);
    const nativeHls = video.canPlayType("application/vnd.apple.mpegurl");
    if (progressiveOptions.length) {
      const defaultOption = progressiveOptions[0];
      setViewerQualityOptions(progressiveOptions);
      setViewerQualitySelection(defaultOption.id);
      video.src = defaultOption.url || viewerClip.videoUrl || "";
      video.load();
    } else if (viewerClip.hlsUrl && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        capLevelToPlayerSize: true,
        startLevel: 0,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        backBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.loadSource(viewerClip.hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const nextOptions = buildQualityOptions(hls.levels);
        setViewerQualityOptions(nextOptions);
        setViewerQualitySelection("auto");
        hls.loadLevel = -1;
        hls.nextLevel = -1;
        void video.play().catch(() => {
          // Keep controls visible if autoplay is blocked.
        });
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) {
          return;
        }

        if (progressiveOptions.length) {
          const fallbackTime = Number.isFinite(video.currentTime) ? video.currentTime : getPendingStart() ?? 0;
          playbackCache[viewerClip.id] = fallbackTime;
          viewerResumeRef.current = {
            clipId: viewerClip.id,
            time: fallbackTime,
            shouldPlay: !video.paused && !video.ended,
          };
          hls.destroy();
          hlsRef.current = null;
          const fallbackOption = progressiveOptions[0];
          setViewerQualityOptions(progressiveOptions);
          setViewerQualitySelection(fallbackOption?.id || "auto");
          video.src = fallbackOption?.url || viewerClip.videoUrl || "";
          video.load();
          return;
        }

        setViewerError("This clip could not be played in the viewer.");
      });
    } else if (viewerClip.hlsUrl && nativeHls) {
      video.src = viewerClip.hlsUrl;
      video.load();
    } else {
      setViewerError("This clip does not have a playable source.");
    }

    return () => {
      if (Number.isFinite(video.currentTime)) {
        playbackCache[viewerClip.id] = video.currentTime;
      }
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("error", handleError);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [viewerClip]);

  const toggleViewerPlayback = useCallback(() => {
    if (viewerUsesEmbed) {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (video.paused || video.ended) {
      void video.play().catch(() => {
        // Keep the viewer usable even if the browser blocks playback.
      });
      return;
    }

    video.pause();
  }, [viewerUsesEmbed]);

  useEffect(() => {
    if (!viewerClipId) {
      return;
    }

    const handleKeydown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const targetTag = target?.tagName || "";
      const targetRole = target?.getAttribute("role") || "";

      if (event.key === "Escape") {
        setViewerClipId(null);
        setViewerQueueIds([]);
        return;
      }

      if (event.key === "ArrowRight" && viewerIndex >= 0 && viewerIndex < viewerQueue.length - 1) {
        viewerStartAtRef.current = null;
        setViewerClipId(viewerQueue[viewerIndex + 1].id);
      }

      if (event.key === "ArrowLeft" && viewerIndex > 0) {
        viewerStartAtRef.current = null;
        setViewerClipId(viewerQueue[viewerIndex - 1].id);
        return;
      }

      if (
        !viewerUsesEmbed
        && (event.key === " " || event.key === "Spacebar" || event.key === "Enter")
        && !["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(targetTag)
        && targetRole !== "slider"
        && !target?.isContentEditable
      ) {
        event.preventDefault();
        toggleViewerPlayback();
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [toggleViewerPlayback, viewerClipId, viewerIndex, viewerQueue, viewerUsesEmbed]);

  const openViewer = useCallback((queue: HighlightItem[], clipId: string, options?: { startTime?: number | null }) => {
    viewerStartAtRef.current =
      typeof options?.startTime === "number" && Number.isFinite(options.startTime)
        ? { clipId, time: options.startTime }
        : null;
    setViewerQueueIds(uniqueQueue(queue).map((item) => item.id));
    setViewerClipId(clipId);
  }, []);

  const closeViewer = useCallback(() => {
    viewerStartAtRef.current = null;
    setViewerClipId(null);
    setViewerQueueIds([]);
  }, []);

  const moveFeatured = useCallback((direction: -1 | 1) => {
    setActiveFeaturedIndex((currentIndex) => {
      if (!featuredHighlights.length) {
        return 0;
      }

      return (currentIndex + direction + featuredHighlights.length) % featuredHighlights.length;
    });
  }, [featuredHighlights.length]);

  const openFeaturedViewer = useCallback(() => {
    if (!featuredLead) {
      return;
    }

    openViewer(featuredHighlights, featuredLead.id, { startTime: 0 });
  }, [featuredHighlights, featuredLead, openViewer]);

  const moveViewer = useCallback((direction: -1 | 1) => {
    if (viewerIndex < 0) {
      return;
    }

    const nextIndex = viewerIndex + direction;
    if (nextIndex < 0 || nextIndex >= viewerQueue.length) {
      return;
    }

    viewerStartAtRef.current = null;
    setViewerClipId(viewerQueue[nextIndex].id);
  }, [viewerIndex, viewerQueue]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

      <main className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="highlights-orb-float highlights-orb-primary absolute left-[-9rem] top-20 h-72 w-72 rounded-full blur-3xl" />
          <div
            className="highlights-orb-float highlights-orb-secondary absolute right-[-11rem] top-44 h-80 w-80 rounded-full blur-3xl"
            style={{ animationDelay: "2.8s" }}
          />
          <div className="highlights-sheen absolute inset-0" />
        </div>

        <section className="relative mx-auto max-w-7xl px-6 pb-16 pt-4">
          <div className="mt-2">
            {loading ? (
              <HighlightsSkeleton />
            ) : (
              <>
                {error ? (
                  <div className="highlights-warning-card rounded-2xl px-4 py-3 text-sm">
                    {error}
                  </div>
                ) : null}

                {laneHighlights.length === 0 ? (
                  <div className="mt-6 rounded-[30px] border border-white/8 bg-surface/78 p-10 text-center">
                    <p className="text-lg font-medium text-foreground">{laneEmptyState.title}</p>
                    <p className="mt-3 text-sm leading-relaxed text-muted">
                      {laneEmptyState.body}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="relative highlights-reveal" style={{ animationDelay: "120ms" }}>
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-accent/90">
                            Top Clips
                          </p>
                          <div className="flex items-center gap-2">
                            <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-foreground-base transition-colors hover:border-accent/30 hover:text-foreground">
                              <IconCalendar />
                              <span className="sr-only">Highlight date</span>
                              <input
                                key={selectedDateValue}
                                ref={dateInputRef}
                                type="date"
                                defaultValue={selectedDateValue}
                                max={todayDateValue}
                                onBlur={(event) => {
                                  commitDateInputValue(event.currentTarget);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    commitDateInputValue(event.currentTarget);
                                    event.currentTarget.blur();
                                    return;
                                  }

                                  if (event.key === "Escape") {
                                    event.currentTarget.value = selectedDateValue;
                                    event.currentTarget.blur();
                                  }
                                }}
                                className="bg-transparent text-[11px] font-medium text-foreground-base outline-none [color-scheme:dark]"
                                aria-label="Pick highlights date"
                              />
                            </label>
                            <button
                              type="button"
              onClick={() => void highlightsQuery.refetch()}
                              title={generatedAt ? `Last updated ${formatAbsoluteStamp(generatedAt)}` : "Refresh highlights"}
                              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-foreground-base transition-colors hover:border-accent/30 hover:text-foreground"
                            >
                            <IconRefresh />
                            Refresh
                          </button>
                          <button
                            type="button"
                            onClick={() => setFiltersOpen((current) => !current)}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-foreground-base transition-colors hover:border-accent/30 hover:text-foreground"
                            aria-expanded={filtersOpen}
                          >
                            <IconFilter />
                            Filters
                            {activeFilterCount ? (
                              <span className="inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-accent/18 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                                {activeFilterCount}
                              </span>
                            ) : null}
                          </button>
                        </div>
                      </div>

                      <div className="relative w-full overflow-visible py-2 lg:py-4">
                        {featuredLead ? (
                          <div className="relative mx-auto flex w-full max-w-[96rem] items-center justify-center overflow-visible">
                            {featuredPreviousPreview ? (
                              <button
                                type="button"
                                onClick={() => moveFeatured(-1)}
                                className="highlights-preview-shell group/preview absolute left-0 top-1/2 z-0 hidden h-[72%] w-[13rem] -translate-y-1/2 overflow-hidden rounded-[28px] text-left transition-all duration-300 hover:-translate-y-1/2 hover:border-accent/24 lg:flex xl:w-[15rem] 2xl:w-[16.5rem]"
                                aria-label="Previous featured clip"
                              >
                                <div className="absolute inset-0">
                                  <HighlightPoster
                                    item={featuredPreviousPreview}
                                    variant="WIDE"
                                    alt={featuredPreviousPreview.title}
                                    className="h-full w-full object-cover opacity-100 transition-transform duration-500 group-hover/preview:scale-[1.03]"
                                    loading="eager"
                                    fetchPriority="high"
                                  />
                                </div>
                                <div className="highlights-preview-arrow absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[18px] text-white transition group-hover/preview:border-accent/30">
                                  <IconChevron direction="left" />
                                </div>
                                <div className="absolute inset-x-4 top-4 flex items-center justify-between gap-3">
                                  <span className="highlights-glass-chip inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/92">
                                    <IconLeagueGlyph sportId={featuredPreviousPreview.league as SportFilter} className="h-3.5 w-3.5" />
                                    {featuredPreviousPreview.league}
                                  </span>
                                </div>
                                <div className="absolute inset-x-4 bottom-4">
                                  <p className="highlights-preview-title line-clamp-2 text-sm font-semibold leading-snug text-white">
                                    {featuredPreviousPreview.title}
                                  </p>
                                </div>
                              </button>
                            ) : null}

                            <div
                              key={featuredLead.id}
                              className="relative z-10 mx-auto w-full motion-safe:animate-[highlightsCarouselSwap_0.42s_cubic-bezier(0.22,1,0.36,1)] lg:w-[calc(100%-12rem)] xl:w-[calc(100%-15rem)] 2xl:w-[calc(100%-17rem)]"
                            >
                              <div className="highlights-feature-shell overflow-hidden rounded-[30px]">
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={openFeaturedViewer}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      openFeaturedViewer();
                                    }
                                  }}
                                  className="group relative block w-full cursor-pointer overflow-hidden text-left aspect-[16/9] min-h-[13rem] sm:aspect-[16/8.75] sm:min-h-[17.5rem] lg:aspect-[16/8.7] lg:min-h-[24.5rem] xl:min-h-[25.5rem]"
                                >
                                  <div className="absolute inset-0 overflow-hidden bg-transparent">
                                    <HighlightPoster
                                      item={featuredLead}
                                      variant="WIDE"
                                      alt={featuredLead.title}
                                      className={`h-full w-full scale-[1.04] object-cover object-center transition-[opacity,transform] duration-300 group-hover:scale-[1.065] ${
                                        !isEmbeddedOnlyClip(featuredLead) && (featuredLead.hlsUrl || featuredLead.videoUrl) && featuredReady
                                          ? "opacity-0"
                                          : "opacity-100"
                                      }`}
                                      loading="eager"
                                      fetchPriority="high"
                                    />
                                    {!isEmbeddedOnlyClip(featuredLead) && (featuredLead.hlsUrl || featuredLead.videoUrl) ? (
                                      <video
                                        ref={featuredVideoRef}
                                        className={`absolute inset-0 h-full w-full scale-[1.04] object-cover object-center transition-opacity duration-300 ${featuredReady ? "opacity-100" : "opacity-0"}`}
                                        autoPlay
                                        muted={featuredMuted || featuredVolume <= 0.01}
                                        loop
                                        playsInline
                                      />
                                    ) : null}
                                  </div>
                                  <div className="highlights-feature-bottom-fade pointer-events-none absolute inset-x-0 bottom-0 h-[40%]" />

                                  <div className="absolute inset-x-5 top-5 flex flex-wrap items-center justify-between gap-3 sm:inset-x-7 sm:top-6 lg:inset-x-8 lg:top-7">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="highlights-glass-chip inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/92">
                                        <IconLeagueGlyph sportId={featuredLead.league as SportFilter} className="h-3.5 w-3.5" />
                                        {featuredLead.league}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap items-center justify-end gap-2">
                                      <span className="highlights-glass-chip highlights-glass-chip-strong rounded-full px-3 py-1 text-sm font-medium text-white">
                                        {featuredRemainingLabel}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="absolute inset-x-5 bottom-5 sm:inset-x-7 sm:bottom-6 lg:inset-x-8 lg:bottom-7">
                                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/76">
                                      <span>{formatClipPublishedAt(featuredLead.publishedAt || null, selectedDateValue)}</span>
                                    </div>
                                    <h3 className="mt-3 max-w-[50rem] text-[1.9rem] font-semibold leading-[0.98] tracking-tight text-white sm:text-[2.45rem] lg:text-[3rem]">
                                      {featuredLead.title}
                                    </h3>
                                    {getClipSummary(featuredLead) ? (
                                      <p className="mt-3 max-w-2xl line-clamp-2 text-sm leading-relaxed text-white/76 sm:text-[0.95rem]">
                                        {getClipSummary(featuredLead)}
                                      </p>
                                    ) : null}

                                    <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                                      {featuredLead.teamTags && featuredLead.teamTags.length ? (
                                        <div className="flex flex-wrap gap-2">
                                          {featuredLead.teamTags.slice(0, 3).map((tag) => (
                                            <span
                                              key={tag}
                                              className="highlights-glass-chip rounded-full px-3 py-1 text-xs text-white"
                                            >
                                              {tag}
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <div />
                                      )}

                                      <div
                                        className="highlights-glass-chip ml-auto inline-flex items-center gap-3 rounded-full px-3 py-1.5"
                                        onClick={(event) => event.stopPropagation()}
                                        onPointerDown={(event) => event.stopPropagation()}
                                      >
                                        <button
                                          type="button"
                                          onClick={toggleFeaturedMuted}
                                          className={`inline-flex items-center gap-2 rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] transition ${
                                            featuredMuted || featuredVolume <= 0.01
                                              ? "text-white/82 hover:text-white"
                                              : "highlights-volume-active"
                                          }`}
                                          aria-label={featuredMuted || featuredVolume <= 0.01 ? "Unmute top clips" : "Mute top clips"}
                                          title={featuredMuted || featuredVolume <= 0.01 ? "Unmute top clips" : "Mute top clips"}
                                        >
                                          <IconVolume muted={featuredMuted || featuredVolume <= 0.01} />
                                          <span>{featuredMuted || featuredVolume <= 0.01 ? "Muted" : "Sound On"}</span>
                                        </button>
                                        <div
                                          className="flex items-center gap-2 border-l border-white/10 pl-3"
                                          onClick={(event) => event.stopPropagation()}
                                          onPointerDown={(event) => event.stopPropagation()}
                                        >
                                          <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            step="1"
                                            value={Math.round(featuredVolume * 100)}
                                            onChange={handleFeaturedVolumeChange}
                                            onClick={(event) => event.stopPropagation()}
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onKeyDown={(event) => event.stopPropagation()}
                                            className="highlights-volume-slider h-1.5 w-24 cursor-pointer sm:w-28"
                                            aria-label="Top clips volume"
                                            title="Top clips volume"
                                          />
                                          <span className={`min-w-[2.35rem] text-right text-[11px] font-semibold tabular-nums ${
                                            featuredMuted || featuredVolume <= 0.01 ? "text-white/48" : "highlights-volume-value-active"
                                          }`}>
                                            {Math.round(featuredVolume * 100)}%
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {featuredNextPreview ? (
                              <button
                                type="button"
                                onClick={() => moveFeatured(1)}
                                className="highlights-preview-shell group/preview absolute right-0 top-1/2 z-0 hidden h-[72%] w-[13rem] -translate-y-1/2 overflow-hidden rounded-[28px] text-left transition-all duration-300 hover:-translate-y-1/2 hover:border-accent/24 lg:flex xl:w-[15rem] 2xl:w-[16.5rem]"
                                aria-label="Next featured clip"
                              >
                                <div className="absolute inset-0">
                                  <HighlightPoster
                                    item={featuredNextPreview}
                                    variant="WIDE"
                                    alt={featuredNextPreview.title}
                                    className="h-full w-full object-cover opacity-100 transition-transform duration-500 group-hover/preview:scale-[1.03]"
                                    loading="eager"
                                    fetchPriority="high"
                                  />
                                </div>
                                <div className="highlights-preview-arrow absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[18px] text-white transition group-hover/preview:border-accent/30">
                                  <IconChevron direction="right" />
                                </div>
                                <div className="absolute inset-x-4 top-4 flex items-center justify-end gap-3">
                                  <span className="highlights-glass-chip inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/92">
                                    <IconLeagueGlyph sportId={featuredNextPreview.league as SportFilter} className="h-3.5 w-3.5" />
                                    {featuredNextPreview.league}
                                  </span>
                                </div>
                                <div className="absolute inset-x-4 bottom-4 text-right">
                                  <p className="highlights-preview-title line-clamp-2 text-sm font-semibold leading-snug text-white">
                                    {featuredNextPreview.title}
                                  </p>
                                </div>
                              </button>
                            ) : null}

                          </div>
                        ) : null}

                        {featuredHighlights.length > 1 ? (
                          <>
                            <button
                              type="button"
                              onClick={() => moveFeatured(-1)}
                        className="highlights-mobile-arrow absolute left-1 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[20px] text-white transition hover:border-accent/30 lg:hidden"
                              aria-label="Previous featured clip"
                            >
                              <IconChevron direction="left" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveFeatured(1)}
                        className="highlights-mobile-arrow absolute right-1 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[20px] text-white transition hover:border-accent/30 lg:hidden"
                              aria-label="Next featured clip"
                            >
                              <IconChevron direction="right" />
                            </button>
                          </>
                        ) : null}

                      </div>
                    </div>

                    {filtersOpen ? (
                          <div className="highlights-flyout-surface absolute right-0 top-11 z-20 w-full max-w-[20rem] rounded-[20px] border border-white/10 px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-accent/90">
                            <IconFilter />
                            Filters
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveSport("ALL");
                                setSortMode("POPULAR");
                                setSelectedDateValue(todayDateValue);
                              }}
                              disabled={!activeFilterCount}
                              className={`inline-flex items-center rounded-full border px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] transition-all disabled:cursor-not-allowed disabled:opacity-45 ${
                                activeFilterCount
                                    ? "highlights-active-choice border-accent bg-accent text-white"
                                  : "border-white/10 bg-white/[0.03] text-foreground-base"
                              }`}
                            >
                              Clear All
                            </button>
                            <button
                              type="button"
                              onClick={() => setFiltersOpen(false)}
                              className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted transition-colors hover:text-foreground"
                            >
                              Done
                            </button>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <p className="min-w-[3.5rem] text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                              Date
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-foreground-base transition-all hover:border-accent/30 hover:text-foreground">
                                <IconCalendar />
                                <input
                                  key={selectedDateValue}
                                  type="date"
                                  defaultValue={selectedDateValue}
                                  max={todayDateValue}
                                  onBlur={(event) => {
                                    commitDateInputValue(event.currentTarget);
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      commitDateInputValue(event.currentTarget);
                                      event.currentTarget.blur();
                                      return;
                                    }

                                    if (event.key === "Escape") {
                                      event.currentTarget.value = selectedDateValue;
                                      event.currentTarget.blur();
                                    }
                                  }}
                                  className="min-w-[8.6rem] bg-transparent text-[11px] font-medium text-foreground-base outline-none [color-scheme:dark]"
                                  aria-label="Pick highlights date"
                                />
                              </label>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <p className="min-w-[3.5rem] text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                              League
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {SPORT_OPTIONS.map((sport) => (
                                <button
                                  key={sport.id}
                                  type="button"
                                  onClick={() => setActiveSport(sport.id)}
                                    className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                                    activeSport === sport.id
                                    ? "highlights-active-choice border-accent bg-accent text-white"
                                      : "border-white/10 bg-white/[0.03] text-foreground-base hover:border-accent/30 hover:text-foreground"
                                  }`}
                                  title={sport.sport}
                                >
                                  <IconLeagueGlyph sportId={sport.id} className="h-3.5 w-3.5" />
                                  <span>{sport.label}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <p className="min-w-[3.5rem] text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                              Sort
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {SORT_OPTIONS.map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => setSortMode(option.id)}
                                    className={`rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                                    sortMode === option.id
                                      ? "border-white/0 bg-white text-background"
                                      : "border-white/10 bg-transparent text-muted hover:border-accent/30 hover:text-foreground"
                                  }`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>

                        </div>
                      </div>
                    ) : null}
                  </>
                )}

                {/*
                {false ? (
                  <>
                <div className="highlights-reveal flex items-center justify-between gap-4" style={{ animationDelay: "120ms" }}>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-accent/90">
                      Popular Five
                    </p>
                    <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                      The clips most likely to pull you in right now
                    </h2>
                  </div>
                  <p className="max-w-sm text-sm leading-relaxed text-muted">
                    {layoutMode === "REELS"
                      ? activeSport === "ALL"
                        ? "Only true vertical clips qualify here. If the providers only have standard videos, this shelf stays empty on purpose."
                        : `Only real ${activeSport} reels qualify here, even if the wider feed has more standard videos available.`
                      : activeSport === "ALL"
                        ? "Balanced across sports when possible, then filled by the strongest overall standard videos."
                        : "Focused on the strongest standard videos inside the league you picked."}
                  </p>
                </div>

                {error ? (
                  <div className="highlights-warning-card mt-5 rounded-2xl px-4 py-3 text-sm">
                    {error}
                  </div>
                ) : null}

                {refreshing ? (
                  <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-muted">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                    Refreshing clips...
                  </div>
                ) : null}
                {laneHighlights.length === 0 ? (
                  <div className="mt-6 rounded-[30px] border border-white/8 bg-surface/78 p-10 text-center">
                    <p className="text-lg font-medium text-foreground">{laneEmptyState.title}</p>
                    <p className="mt-3 text-sm leading-relaxed text-muted">
                      {laneEmptyState.body}
                    </p>
                  </div>
                ) : layoutMode === "VIDEOS" ? (
                  <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                    {featuredLead ? (
                      <button
                        type="button"
                        onClick={() => openViewer(featuredHighlights, featuredLead.id)}
                className="highlights-reveal highlights-feature-card group relative min-h-[24rem] overflow-hidden rounded-[34px] text-left transition-all duration-300 hover:-translate-y-1 hover:border-accent/30"
                        style={{
                          animationDelay: "140ms",
                    backgroundImage: `var(--highlight-feature-image-overlay), url(${getWidePoster(featuredLead) || getTallPoster(featuredLead) || ""})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }}
                      >
                  <div className="highlights-feature-card-overlay absolute inset-0" />
                        <div className="absolute inset-x-6 top-6 flex items-center justify-between gap-3">
                          <div className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-black/28 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/88 backdrop-blur-sm">
                            <span className="text-accent">#1</span>
                            {featuredLead.league}
                            <span className="h-1 w-1 rounded-full bg-white/40" />
                            <span>{getContentFormat(featuredLead) === "REEL" ? "Reel" : "Video"}</span>
                          </div>
                          <div className="rounded-full bg-black/34 px-3 py-1 text-sm font-medium text-white/92 backdrop-blur-sm">
                            {featuredLead.durationLabel || "Clip"}
                          </div>
                        </div>

                        <div className="absolute inset-x-6 bottom-6">
                          <div className="flex items-center justify-between gap-3">
                            <div className="rounded-full border border-white/12 bg-black/28 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80 backdrop-blur-sm">
                              {featuredLead.typeLabel || "Latest clip"} • {formatClipPublishedAt(featuredLead.publishedAt || null, selectedDateValue)}
                            </div>
                    <div className="highlights-feature-card-play flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white transition-transform duration-300 group-hover:scale-105">
                              <IconPlay />
                            </div>
                          </div>

                          <h3 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-white">
                            {featuredLead.title}
                          </h3>
                          {getClipSummary(featuredLead) ? (
                            <p className="mt-3 max-w-2xl line-clamp-2 text-base leading-relaxed text-white/78">
                              {getClipSummary(featuredLead)}
                            </p>
                          ) : null}

                          {featuredLead.teamTags && featuredLead.teamTags.length ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {featuredLead.teamTags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full border border-white/12 bg-black/25 px-3 py-1 text-xs text-white/86 backdrop-blur-sm"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </button>
                    ) : null}

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                      {featuredSideClips.map((item, index) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => openViewer(featuredHighlights, item.id)}
                    className="highlights-reveal highlights-wall-card group relative min-h-[11.25rem] overflow-hidden rounded-[28px] text-left transition-all duration-300 hover:-translate-y-1 hover:border-accent/30"
                          style={{
                            animationDelay: `${180 + index * 40}ms`,
                        backgroundImage: `var(--highlight-wall-image-overlay), url(${getWidePoster(item) || getTallPoster(item) || ""})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }}
                        >
                      <div className="highlights-wall-card-overlay absolute inset-0" />
                      <div className="highlights-wall-card-bottom-fade absolute inset-x-0 bottom-0 h-24" />
                          <div className="absolute inset-x-4 top-4 flex items-center justify-between gap-3">
                            <div className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-black/28 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/88 backdrop-blur-sm">
                              <span className="text-accent">#{index + 2}</span>
                              {item.league}
                            </div>
                            <span className="rounded-full bg-black/34 px-3 py-1 text-xs font-medium text-white/92 backdrop-blur-sm">
                              {item.durationLabel || "Clip"}
                            </span>
                          </div>
                          <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/74">
                                {item.typeLabel || "Latest clip"} • {formatClipPublishedAt(item.publishedAt || null, selectedDateValue)}
                              </p>
                              <h3 className="mt-2 line-clamp-2 text-xl font-semibold leading-tight text-white">
                                {item.title}
                              </h3>
                            </div>
                        <div className="highlights-wall-card-play flex h-11 w-11 flex-none items-center justify-center rounded-full bg-accent text-white">
                              <IconPlay />
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                    {featuredHighlights.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openViewer(featuredHighlights, item.id)}
                    className={`highlights-reveal highlights-feature-card group relative h-[31rem] flex-none overflow-hidden rounded-[30px] text-left transition-all duration-300 hover:-translate-y-1 hover:border-accent/30 ${index === 0 ? "w-[22rem] sm:w-[24rem]" : "w-[18.25rem] sm:w-[19rem]"}`}
                        style={{
                          animationDelay: `${140 + index * 55}ms`,
                        backgroundImage: `var(--highlight-rail-image-overlay), url(${getTallPoster(item) || getWidePoster(item) || ""})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }}
                      >
                    <div className="highlights-feature-card-overlay absolute inset-0" />
                        <div className="absolute inset-x-5 top-5 flex items-center justify-between gap-3">
                          <div className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-black/28 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/88 backdrop-blur-sm">
                            <span className="text-accent">#{index + 1}</span>
                            {item.league}
                          </div>
                          <div className="rounded-full bg-black/34 px-3 py-1 text-sm font-medium text-white/92 backdrop-blur-sm">
                            {item.durationLabel || "Clip"}
                          </div>
                        </div>

                        <div className="absolute inset-x-5 bottom-5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="rounded-full border border-white/12 bg-black/28 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80 backdrop-blur-sm">
                              {item.typeLabel || "Latest clip"} • {formatClipPublishedAt(item.publishedAt || null, selectedDateValue)}
                            </div>
                      <div className="highlights-feature-card-play flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white transition-transform duration-300 group-hover:scale-105">
                              <IconPlay />
                            </div>
                          </div>

                          <h3 className="mt-4 text-2xl font-semibold leading-tight tracking-tight text-white">
                            {item.title}
                          </h3>
                          {getClipSummary(item) ? (
                            <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-white/78">
                              {getClipSummary(item)}
                            </p>
                          ) : null}

                          {item.teamTags && item.teamTags.length ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {item.teamTags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full border border-white/12 bg-black/25 px-3 py-1 text-xs text-white/86 backdrop-blur-sm"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
                */}

                {laneHighlights.length ? (
                  <>
                    <div className="mt-8 flex items-center justify-between gap-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-accent/90">
                        {layoutMode === "VIDEOS" ? "More Clips" : "More Reels"}
                      </p>
                      <div className="text-[11px] font-medium text-muted">
                        {generatedAt ? `Last updated ${formatAbsoluteStamp(generatedAt)}` : ""}
                      </div>
                    </div>

                    {wallHighlights.length ? (
                      <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                        {visibleWallHighlights.map((item, index) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => openViewer(wallHighlights, item.id)}
                className="highlights-reveal highlights-rail-card group flex h-full flex-col overflow-hidden rounded-[28px] text-left transition-all duration-300 hover:-translate-y-1 hover:border-accent/28"
                            style={{ animationDelay: `${200 + index * 35}ms` }}
                          >
                            <div className={`relative overflow-hidden bg-black/30 ${layoutMode === "VIDEOS" ? "aspect-[16/9]" : "aspect-[10/14]"}`}>
                              <HighlightPoster
                                item={item}
                                variant={layoutMode === "VIDEOS" ? "WIDE" : "TALL"}
                                alt={item.title}
                                className="absolute inset-0 h-full w-full object-cover opacity-34 transition-transform duration-500 group-hover:scale-[1.03]"
                                loading={index < 9 ? "eager" : "lazy"}
                                fetchPriority={index < 6 ? "high" : "auto"}
                              />
                              <HighlightPoster
                                item={item}
                                variant={layoutMode === "VIDEOS" ? "WIDE" : "TALL"}
                                alt=""
                                className="relative h-full w-full object-contain transition-transform duration-500 group-hover:scale-[1.02]"
                                loading={index < 9 ? "eager" : "lazy"}
                                fetchPriority={index < 6 ? "high" : "auto"}
                              />
                              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <div className="highlights-rail-play flex h-14 w-14 items-center justify-center rounded-full text-white opacity-0 transition-all duration-300 group-hover:scale-100 group-hover:opacity-100">
                                  <IconPlay />
                                </div>
                              </div>
                              <div className="absolute inset-x-4 top-4 flex items-center justify-between gap-3">
                                <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/26 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/86 backdrop-blur-sm">
                                  <IconLeagueGlyph sportId={item.league as SportFilter} className="h-3.5 w-3.5" />
                                  {item.league}
                                </div>
                                <div className="rounded-full bg-black/30 px-3 py-1 text-sm font-medium text-white/92 backdrop-blur-sm">
                                  {item.durationLabel || "Clip"}
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-1 flex-col p-5">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent/88">
                                {formatClipPublishedAt(item.publishedAt || null, selectedDateValue)}
                              </div>

                              <h3 className="mt-3 min-h-[5.4rem] line-clamp-3 text-[1.65rem] font-semibold leading-[1.08] tracking-tight text-foreground">
                                {item.title}
                              </h3>
                              <p className={`mt-3 text-sm leading-relaxed text-muted ${layoutMode === "VIDEOS" ? "min-h-[3rem] line-clamp-2" : "min-h-[3.75rem] line-clamp-3"}`}>
                                {getClipSummary(item) || " "}
                              </p>

                              {item.teamTags && item.teamTags.length ? (
                                <div className="mt-auto flex flex-wrap gap-2 pt-5">
                                  {item.teamTags.slice(0, 2).map((tag) => (
                                    <span
                                      key={tag}
                                      className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-xs text-foreground-base"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {canLoadMoreWallHighlights ? (
                      <div className="mt-6 flex justify-center">
                        <button
                          type="button"
                          onClick={() => setVisibleWallCount((current) => Math.min(current + WALL_PAGE_SIZE, wallHighlights.length))}
                          className="inline-flex items-center gap-2 rounded-full border border-accent/24 bg-accent/10 px-5 py-2.5 text-sm font-semibold text-accent transition-colors hover:border-accent/38 hover:bg-accent/14"
                        >
                          <span>Load More Clips</span>
                          <span className="text-accent/72">({(wallHighlights.length - visibleWallHighlights.length).toLocaleString()} remaining)</span>
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </div>
        </section>
      </main>

      <Footer />

      {viewerClip ? (
        <div
          className="highlights-viewer-backdrop fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto px-4 py-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeViewer();
            }
          }}
        >
          {viewerFormat === "VIDEO" ? (
            <div className="highlights-reveal relative grid w-full max-w-[94rem] gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="flex min-w-0 flex-col gap-4">
                <div
                  className="highlights-viewer-shell relative overflow-hidden rounded-[34px]"
                >
                  <div className="highlights-viewer-surface pointer-events-none absolute inset-0" />

                  <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
                    {viewerQualityOptions.length > 1 && !viewerUsesEmbed ? (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setViewerQualityOpen((current) => !current);
                          }}
                          className="inline-flex h-11 items-center gap-2 rounded-full border border-white/12 bg-black/34 px-4 text-white backdrop-blur-md transition-colors hover:border-accent/30"
                        >
                          <IconSettings />
                          <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                            {viewerQualityOptions.find((option) => option.id === viewerQualitySelection)?.label || "Auto"}
                          </span>
                        </button>

                        {viewerQualityOpen ? (
                          <div className="absolute right-0 top-14 min-w-[9rem] rounded-[18px] border border-white/10 p-2 highlights-flyout-surface">
                            {viewerQualityOptions.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setViewerQualitySelection(option.id);
                                  setViewerQualityOpen(false);
                                }}
                                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                                  viewerQualitySelection === option.id
                                    ? "bg-accent text-white"
                                    : "text-foreground-base hover:bg-white/[0.06] hover:text-foreground"
                                }`}
                              >
                                <span>{option.label}</span>
                                {viewerQualitySelection === option.id ? <span className="text-xs font-semibold uppercase tracking-[0.16em]">On</span> : null}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={closeViewer}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/34 text-white backdrop-blur-md transition-colors hover:border-accent/30"
                    >
                      <IconClose />
                    </button>
                  </div>

                  <div className="absolute left-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/34 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-white/88 backdrop-blur-md">
                    <IconLeagueGlyph sportId={viewerClip.league as SportFilter} className="h-3.5 w-3.5" />
                    <span>{viewerClip.league}</span>
                  </div>

                  {viewerQueue.length > 1 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => moveViewer(-1)}
                        disabled={viewerIndex <= 0}
                        className="absolute left-4 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-black/34 text-white backdrop-blur-md transition disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        <IconChevron direction="left" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveViewer(1)}
                        disabled={viewerIndex >= viewerQueue.length - 1}
                        className="absolute right-4 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-black/34 text-white backdrop-blur-md transition disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        <IconChevron direction="right" />
                      </button>
                    </>
                  ) : null}

                  <div className="relative z-10 aspect-video w-full p-4 sm:p-5">
                    <div className="highlights-viewer-frame relative h-full w-full overflow-hidden rounded-[28px]">
                      {!viewerReady ? (
                        <div className="highlights-viewer-loading pointer-events-none absolute inset-0 flex items-center justify-center">
                          <div className="flex items-center gap-2 rounded-full border border-white/12 bg-black/34 px-4 py-2 text-sm text-white/88 backdrop-blur-sm">
                            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />
                            Loading clip...
                          </div>
                        </div>
                      ) : null}

                      {viewerUsesEmbed ? (
                        <iframe
                          src={viewerClip.embedUrl || undefined}
                          title={viewerClip.title}
                          className="h-full w-full border-0 bg-black"
                          allow="autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                          onLoad={() => setViewerReady(true)}
                        />
                      ) : (
                        <video
                          ref={videoRef}
                          className="h-full w-full bg-highlight-shell-deep object-contain focus:outline-none"
                          controls
                          playsInline
                          preload="auto"
                          tabIndex={0}
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className="highlights-viewer-panel rounded-[30px] p-6">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent/90">
                    <span>{viewerClip.typeLabel || "Latest clip"}</span>
                    <span className="h-1 w-1 rounded-full bg-accent/60" />
                    <span>{formatClipPublishedAt(viewerClip.publishedAt || null, selectedDateValue)}</span>
                  </div>

                  <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
                    {viewerClip.title}
                  </h2>
                  {getClipSummary(viewerClip) ? (
                    <p className="mt-4 text-sm leading-relaxed text-muted">
                      {getClipSummary(viewerClip)}
                    </p>
                  ) : null}

                  {viewerError ? (
                    <div className="highlights-warning-card mt-5 rounded-2xl px-4 py-3 text-sm">
                      {viewerError}
                    </div>
                  ) : null}

                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <div className="rounded-[22px] border border-white/8 bg-background/55 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent/88">
                        Published
                      </p>
                      <p className="mt-2 text-sm text-foreground-base">
                        {formatAbsoluteStamp(viewerClip.publishedAt || null)}
                      </p>
                    </div>
                    <div className="rounded-[22px] border border-white/8 bg-background/55 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent/88">
                        Source
                      </p>
                      <p className="mt-2 text-sm text-foreground-base">
                        {viewerClip.source || "Provider feed"}
                      </p>
                    </div>
                    <div className="rounded-[22px] border border-white/8 bg-background/55 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent/88">
                        Runtime
                      </p>
                      <p className="mt-2 text-sm text-foreground-base">
                        {getClipRuntimeLabel(viewerClip)}
                      </p>
                    </div>
                  </div>

                  {viewerClip.teamTags && viewerClip.teamTags.length ? (
                    <div className="mt-5 flex flex-wrap gap-2">
                      {viewerClip.teamTags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-foreground-base"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-6 flex flex-wrap gap-3">
                    {viewerClip.storyUrl ? (
                      <a
                        href={viewerClip.storyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-xl border border-white/12 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-foreground-base transition-colors hover:border-accent/30 hover:text-foreground"
                      >
                        Story Context
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>

              <aside className="highlights-viewer-side-panel flex min-h-0 flex-col rounded-[30px] p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent/88">
                  Recommended for you
                </p>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                  Personalized next clips
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Ranked from your saved teams, league preferences, watch behavior, and the clip you just opened.
                </p>

                <div className="relative mt-5 min-h-0 flex-1 overflow-hidden">
                  <div className="flex h-full max-h-[54rem] flex-col gap-3 overflow-y-auto pr-2">
                    {recommendationRail.length ? (
                      recommendationRail.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => openViewer([viewerClip, ...recommendationRail], item.id)}
                          className="rounded-[22px] border border-white/8 bg-background/55 p-3 text-left transition-colors hover:border-accent/24"
                        >
                          <div className="flex gap-3">
                            <div className="relative h-20 w-32 flex-none overflow-hidden rounded-[16px] border border-white/8 bg-black/20">
                              <HighlightPoster
                                item={item}
                                variant="WIDE"
                                alt={item.title}
                                className="h-full w-full object-cover"
                                loading="eager"
                                fetchPriority="high"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent/88">
                                <IconLeagueGlyph sportId={item.league as SportFilter} className="h-3.5 w-3.5" />
                                <span>{item.league}</span>
                                <span>/</span>
                                <span>{item.durationLabel || "Clip"}</span>
                                <span>/</span>
                                <span className="max-w-[9rem] truncate">{getClipTypeLabel(item)}</span>
                              </div>
                              <p className="mt-2 line-clamp-2 text-sm font-semibold leading-relaxed text-foreground-base">
                                {item.title}
                              </p>
                              <p className="mt-2 text-xs leading-relaxed text-muted">
                                {buildRecommendationReason(item, viewerClip, preferredSports, savedTeamKeySet, watchHistory)}
                              </p>
                              <p className="mt-2 text-xs text-muted">
                                {formatClipPublishedAt(item.publishedAt || null, selectedDateValue)}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-[22px] border border-white/8 bg-background/55 p-4 text-sm leading-relaxed text-muted">
                        Keep watching highlights and saving teams. This rail will sharpen as your behavior and preferences fill in.
                      </div>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          ) : (
            <div className="highlights-reveal relative grid w-full max-w-6xl gap-5 lg:grid-cols-[minmax(0,0.58fr)_minmax(320px,0.42fr)]">
              <div
                className="highlights-viewer-shell relative mx-auto flex w-full max-w-[31rem] items-center justify-center overflow-hidden rounded-[34px]"
                style={{
                  aspectRatio: "9 / 16",
                }}
              >
                <div className="highlights-viewer-surface pointer-events-none absolute inset-0" />

                <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
                  {viewerQualityOptions.length > 1 && !viewerUsesEmbed ? (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setViewerQualityOpen((current) => !current);
                        }}
                        className="inline-flex h-11 items-center gap-2 rounded-full border border-white/12 bg-black/34 px-4 text-white backdrop-blur-md transition-colors hover:border-accent/30"
                      >
                        <IconSettings />
                        <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                          {viewerQualityOptions.find((option) => option.id === viewerQualitySelection)?.label || "Auto"}
                        </span>
                      </button>

                      {viewerQualityOpen ? (
                        <div className="absolute right-0 top-14 min-w-[9rem] rounded-[18px] border border-white/10 p-2 highlights-flyout-surface">
                          {viewerQualityOptions.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setViewerQualitySelection(option.id);
                                setViewerQualityOpen(false);
                              }}
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                                viewerQualitySelection === option.id
                                  ? "bg-accent text-white"
                                  : "text-foreground-base hover:bg-white/[0.06] hover:text-foreground"
                              }`}
                            >
                              <span>{option.label}</span>
                              {viewerQualitySelection === option.id ? <span className="text-xs font-semibold uppercase tracking-[0.16em]">On</span> : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={closeViewer}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/34 text-white backdrop-blur-md transition-colors hover:border-accent/30"
                  >
                    <IconClose />
                  </button>
                </div>

                <div className="absolute left-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/34 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-white/88 backdrop-blur-md">
                  <IconLeagueGlyph sportId={viewerClip.league as SportFilter} className="h-3.5 w-3.5" />
                  <span>{viewerClip.league}</span>
                </div>

                {viewerQueue.length > 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => moveViewer(-1)}
                      disabled={viewerIndex <= 0}
                      className="absolute left-4 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-black/34 text-white backdrop-blur-md transition disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <IconChevron direction="left" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveViewer(1)}
                      disabled={viewerIndex >= viewerQueue.length - 1}
                      className="absolute right-4 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-black/34 text-white backdrop-blur-md transition disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <IconChevron direction="right" />
                    </button>
                  </>
                ) : null}

                <div className="relative z-10 h-full w-full p-4 sm:p-5">
                  <div className="highlights-viewer-frame relative h-full w-full overflow-hidden rounded-[28px]">
                    {!viewerReady ? (
                      <div className="highlights-viewer-loading pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="flex items-center gap-2 rounded-full border border-white/12 bg-black/34 px-4 py-2 text-sm text-white/88 backdrop-blur-sm">
                          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />
                          Loading clip...
                          </div>
                        </div>
                      ) : null}

                      {viewerUsesEmbed ? (
                      <iframe
                        src={viewerClip.embedUrl || undefined}
                        title={viewerClip.title}
                        className="h-full w-full border-0 bg-black"
                        allow="autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                        onLoad={() => setViewerReady(true)}
                      />
                      ) : (
                        <video
                          ref={videoRef}
                          className="h-full w-full bg-highlight-shell-deep object-contain focus:outline-none"
                          controls
                          playsInline
                          preload="auto"
                          tabIndex={0}
                        />
                      )}
                    </div>
                  </div>
                </div>

            <div className="flex flex-col gap-4">
              <div className="highlights-viewer-panel rounded-[30px] p-6">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent/90">
                  <span>{viewerClip.typeLabel || "Latest clip"}</span>
                  <span className="h-1 w-1 rounded-full bg-accent/60" />
                  <span>{formatClipPublishedAt(viewerClip.publishedAt || null, selectedDateValue)}</span>
                </div>

                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
                  {viewerClip.title}
                </h2>
                {getClipSummary(viewerClip) ? (
                  <p className="mt-4 text-sm leading-relaxed text-muted">
                    {getClipSummary(viewerClip)}
                  </p>
                ) : null}

                {viewerError ? (
                  <div className="highlights-warning-card mt-5 rounded-2xl px-4 py-3 text-sm">
                    {viewerError}
                  </div>
                ) : null}

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[22px] border border-white/8 bg-background/55 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent/88">
                      Published
                    </p>
                    <p className="mt-2 text-sm text-foreground-base">
                      {formatAbsoluteStamp(viewerClip.publishedAt || null)}
                    </p>
                  </div>
                  <div className="rounded-[22px] border border-white/8 bg-background/55 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent/88">
                      Source
                    </p>
                    <p className="mt-2 text-sm text-foreground-base">
                      {viewerClip.source || "Provider feed"}
                    </p>
                  </div>
                </div>

                {viewerClip.teamTags && viewerClip.teamTags.length ? (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {viewerClip.teamTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-foreground-base"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-6 flex flex-wrap gap-3">
                  {viewerClip.storyUrl ? (
                    <a
                      href={viewerClip.storyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-xl border border-white/12 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-foreground-base transition-colors hover:border-accent/30 hover:text-foreground"
                    >
                      Story Context
                    </a>
                  ) : null}
                </div>
              </div>

              {viewerQueue.length > 1 ? (
                <div className="highlights-viewer-side-panel rounded-[30px] p-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent/88">
                    Up Next
                  </p>
                  <div className="mt-4 grid gap-3">
                    {viewerQueue
                      .slice(Math.max(0, viewerIndex - 1), Math.min(viewerQueue.length, viewerIndex + 2))
                      .map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setViewerClipId(item.id)}
                          className={`rounded-[22px] border p-4 text-left transition-colors ${
                            item.id === viewerClip.id
                              ? "border-accent/35 bg-accent/12"
                              : "border-white/8 bg-background/55 hover:border-accent/24"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-accent/88">
                                <IconLeagueGlyph sportId={item.league as SportFilter} className="h-3.5 w-3.5" />
                                <span>{item.league}</span>
                                <span>/</span>
                                <span>{item.durationLabel || "Clip"}</span>
                              </div>
                              <p className="mt-2 line-clamp-2 text-sm font-medium leading-relaxed text-foreground-base">
                                {item.title}
                              </p>
                            </div>
                            <span className="text-xs text-muted">{formatClipPublishedAt(item.publishedAt || null, selectedDateValue)}</span>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
