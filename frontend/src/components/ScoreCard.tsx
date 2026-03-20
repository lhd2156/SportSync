import { memo } from "react";
import { Link } from "react-router-dom";
import LiveBadge from "./LiveBadge";

interface ScoreCardProps {
  id: string;
  homeTeam: { name: string; shortName?: string; logoUrl?: string | null; color?: string | null };
  awayTeam: { name: string; shortName?: string; logoUrl?: string | null; color?: string | null };
  homeScore: number;
  awayScore: number;
  status: string;
  statusDetail?: string;
  league: string;
  scheduledAt: string;
  prediction?: {
    homeWinProb: number;
    awayWinProb: number;
    modelVersion?: string;
  } | null;
  predictionLoading?: boolean;
  isMyTeam?: boolean;
}

function ScoreCard({
  id,
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  status,
  statusDetail,
  league,
  scheduledAt,
  prediction,
  predictionLoading,
  isMyTeam,
}: ScoreCardProps) {
  const isLive = status === "live";
  const isFinal = status === "final";
  const dateParam = (() => {
    try {
      const date = new Date(scheduledAt);
      const formatter = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const parts = formatter.formatToParts(date);
      const year = parts.find((part) => part.type === "year")?.value || "";
      const month = parts.find((part) => part.type === "month")?.value || "";
      const day = parts.find((part) => part.type === "day")?.value || "";
      return year && month && day ? `${year}${month}${day}` : "";
    } catch {
      return "";
    }
  })();

  /* Determine the time/status label */
  const timeLabel = (() => {
    if (statusDetail) return statusDetail;
    try {
      return new Date(scheduledAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  })();

  const homeColor = toCssColor(homeTeam.color, "#3B82F6");
  const awayColor = toCssColor(awayTeam.color, "#64748B");
  const homePct = Math.max(0, Math.min(100, Math.round((prediction?.homeWinProb ?? 0) * 100)));
  const awayPct = Math.max(0, Math.min(100, Math.round((prediction?.awayWinProb ?? 0) * 100)));

  return (
    <Link
      to={`/games/${id}?league=${encodeURIComponent(league)}${dateParam ? `&date=${encodeURIComponent(dateParam)}` : ""}`}
      className={`bg-surface border rounded-xl p-4 hover:border-accent/30 transition-all block ${
        isMyTeam
          ? "border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.10)]"
          : "border-muted/20"
      }`}
    >
      {/* Header: league + status */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted flex items-center gap-1.5">
          {league}
          {isMyTeam && <span className="text-[9px] bg-amber-500/15 text-amber-400 border border-amber-500/25 rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wider">My Team</span>}
        </span>
        {isLive ? (
          <div className="flex items-center gap-1.5">
            <LiveBadge />
            {statusDetail && (
              <span className="text-xs text-accent font-medium">{statusDetail}</span>
            )}
          </div>
        ) : isFinal ? (
          <span className="text-xs text-muted">FINAL</span>
        ) : (
          <span className="text-xs text-muted">{timeLabel}</span>
        )}
      </div>

      {/* Teams and scores */}
      <div className="space-y-2">
        <TeamRow
          name={awayTeam.name}
          logoUrl={awayTeam.logoUrl}
          score={awayScore}
          isWinning={awayScore > homeScore && (isLive || isFinal)}
        />
        <TeamRow
          name={homeTeam.name}
          logoUrl={homeTeam.logoUrl}
          score={homeScore}
          isWinning={homeScore > awayScore && (isLive || isFinal)}
        />
      </div>

      {/* Prediction: shimmer skeleton while loading, fade-in when ready */}
      {prediction ? (
        <div className="mt-4 animate-[fadeIn_0.4s_ease-out]">
          <div className="h-1.5 rounded-full overflow-hidden bg-muted/15 flex">
            <div
              className="h-full transition-all duration-500 ease-out"
              style={{ width: `${awayPct}%`, backgroundColor: awayColor }}
            />
            <div
              className="h-full transition-all duration-500 ease-out"
              style={{ width: `${homePct}%`, backgroundColor: homeColor }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] font-medium tracking-wide">
            <span className="text-accent">
              {(awayTeam.shortName || awayTeam.name).toUpperCase()} {awayPct}%
            </span>
            <span className="text-accent">
              {(homeTeam.shortName || homeTeam.name).toUpperCase()} {homePct}%
            </span>
          </div>
        </div>
      ) : predictionLoading ? (
        <div className="mt-4">
          <div className="h-1.5 rounded-full overflow-hidden bg-muted/15">
            <div className="h-full w-full shimmer-prediction" />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className="h-3 w-14 rounded bg-muted/10 shimmer-prediction" />
            <div className="h-3 w-14 rounded bg-muted/10 shimmer-prediction" />
          </div>
        </div>
      ) : null}
    </Link>
  );
}

function toCssColor(color?: string | null, fallback = "#3B82F6"): string {
  if (!color) return fallback;
  const trimmed = color.trim();
  if (!trimmed) return fallback;
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function TeamRow({
  name,
  logoUrl,
  score,
  isWinning,
}: {
  name: string;
  logoUrl?: string | null;
  score: number;
  isWinning: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={name}
            className="w-6 h-6 object-contain img-fade-in"
            loading="lazy"
          />
        ) : (
          <div className="w-6 h-6 bg-muted/20 rounded-full" />
        )}
        <span className={`text-sm ${isWinning ? "text-foreground font-semibold" : "text-foreground-base"}`}>
          {name}
        </span>
      </div>
      <span className={`text-lg tabular-nums ${isWinning ? "text-foreground font-bold" : "text-foreground-base"}`}>
        {score}
      </span>
    </div>
  );
}

export default memo(ScoreCard);
