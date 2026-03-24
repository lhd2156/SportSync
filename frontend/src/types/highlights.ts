export type SortMode = "POPULAR" | "RECENT" | "OLDEST";
export type ContentFormat = "REEL" | "VIDEO";

export interface HighlightVideoVariant {
  id: string;
  label: string;
  url: string;
  height?: number | null;
  bitrate?: number | null;
}

export interface HighlightItem {
  id: string;
  league: string;
  title: string;
  description?: string | null;
  source?: string | null;
  publishedAt?: string | null;
  publishedTs?: number | null;
  durationSeconds?: number | null;
  durationLabel?: string | null;
  posterUrl?: string | null;
  widePosterUrl?: string | null;
  squarePosterUrl?: string | null;
  verticalPosterUrl?: string | null;
  videoUrl?: string | null;
  hlsUrl?: string | null;
  videoVariants?: HighlightVideoVariant[] | null;
  embedUrl?: string | null;
  pageUrl?: string | null;
  storyUrl?: string | null;
  typeLabel?: string | null;
  teamTags?: string[] | null;
  eventId?: string | null;
  videoRatio?: string | null;
  popularityScore?: number | null;
  contentFormat?: ContentFormat | null;
}

export interface HighlightsResponse {
  generatedAt?: string | null;
  highlights?: HighlightItem[];
  date?: string | null;
}

export interface HighlightCacheEntry {
  cachedAt: number;
  generatedAt: string | null;
  highlights: HighlightItem[];
}

export interface HighlightInteraction {
  id: string;
  league: string;
  teamTags: string[];
  contentFormat: ContentFormat;
  lastOpenedAt: number;
  openCount: number;
}

export interface ViewerQualityOption {
  id: string;
  label: string;
  mode: "hls" | "mp4";
  level?: number | "auto";
  url?: string | null;
}
