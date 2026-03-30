import { memo } from "react";
import { Link } from "react-router-dom";
import LiveBadge from "./LiveBadge";
import { getDisplayPercentages } from "../utils/predictions";

type ScoreCardProps = {
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
  reservePredictionSpace?: boolean;
  isMyTeam?: boolean;
};

const TERMINAL_NON_FINAL_STATUS_TOKENS = [
  "postponed",
  "postp",
  "ppd",
  "canceled",
  "cancelled",
  "suspended",
  "abandoned",
] as const;

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

function isTerminalNonFinalStatus(status: string, statusDetail?: string): boolean {
  if (status !== "final") {
    return false;
  }

  const normalized = (statusDetail || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return TERMINAL_NON_FINAL_STATUS_TOKENS.some((token) => normalized.includes(token));
}

function formatScheduledLabel(scheduledAt: string): string {
  const kickoff = new Date(scheduledAt);
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

function slugifySegment(value?: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
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
  reservePredictionSpace = false,
  isMyTeam,
}: ScoreCardProps) {
  const isLive = status === "live";
  const isFinal = status === "final";
  const isTerminalNonFinal = isTerminalNonFinalStatus(status, statusDetail);
  const hasOfficialResult = isLive || (isFinal && !isTerminalNonFinal);
  const canShowPrediction = status === "live" || status === "upcoming" || status === "final";
  const gameSlug = `${slugifySegment(league)}-${slugifySegment(awayTeam.name)}-${slugifySegment(homeTeam.name)}-${id}`;

  /* Determine the time/status label */
  const timeLabel = (() => {
    if (!isFinal && !isLive && isGenericUpcomingLabel(statusDetail)) {
      return formatScheduledLabel(scheduledAt) || statusDetail || "";
    }
    if (statusDetail) return statusDetail;
    return formatScheduledLabel(scheduledAt);
  })();

  const homeColor = toCssColor(homeTeam.color, "var(--accent)");
  const awayColor = toCssColor(awayTeam.color, "var(--chart-axis)");
  const { homePct, awayPct } = getDisplayPercentages(
    prediction?.homeWinProb ?? 0,
    prediction?.awayWinProb ?? 0,
  );
  const shouldShowPrediction = canShowPrediction && !!prediction;
  const shouldShowPredictionLoading = canShowPrediction && !prediction && !!predictionLoading;
  const shouldReservePredictionSpace = reservePredictionSpace && !shouldShowPrediction && !shouldShowPredictionLoading;

  return (
    <Link
      to={`/games/${gameSlug}`}
      className={`bg-surface border rounded-xl p-4 hover:border-accent/30 transition-all block h-full ${
        isMyTeam
          ? "border-[color:var(--warning-border)] shadow-[0_0_12px_var(--warning-fill)]"
          : "border-muted/20"
      }`}
    >
      {/* Header: league + status */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted flex items-center gap-1.5">
          {league}
          {isMyTeam && <span className="text-[9px] rounded-full border border-[color:var(--warning-border)] bg-[color:var(--warning-fill)] px-1.5 py-0.5 font-semibold uppercase tracking-wider text-[color:var(--gold-accent)]">My Team</span>}
        </span>
        {isLive ? (
          <div className="flex items-center gap-1.5">
            <LiveBadge />
            {statusDetail && (
              <span className="text-xs text-accent font-medium">{statusDetail}</span>
            )}
          </div>
        ) : isFinal ? (
          <span className="text-xs text-muted">{isTerminalNonFinal ? (statusDetail || "Postponed") : "FINAL"}</span>
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
          isWinning={awayScore > homeScore && hasOfficialResult}
        />
        <TeamRow
          name={homeTeam.name}
          logoUrl={homeTeam.logoUrl}
          score={homeScore}
          isWinning={homeScore > awayScore && hasOfficialResult}
        />
      </div>

      {/* Prediction: shimmer skeleton while loading, fade-in when ready */}
      {shouldShowPrediction ? (
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
          <div className="mt-2 flex items-center justify-between text-[11px] font-medium tracking-wide text-accent">
            <span>
              {(awayTeam.shortName || awayTeam.name).toUpperCase()} {awayPct}%
            </span>
            <span>
              {(homeTeam.shortName || homeTeam.name).toUpperCase()} {homePct}%
            </span>
          </div>
        </div>
      ) : shouldShowPredictionLoading ? (
        <div className="mt-4">
          <div className="h-1.5 rounded-full overflow-hidden bg-muted/15">
            <div className="h-full w-full shimmer-prediction" />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className="h-3 w-14 rounded bg-muted/10 shimmer-prediction" />
            <div className="h-3 w-14 rounded bg-muted/10 shimmer-prediction" />
          </div>
        </div>
      ) : shouldReservePredictionSpace ? (
        <div className="mt-4" aria-hidden="true">
          <div className="h-1.5 rounded-full bg-transparent" />
          <div className="mt-2 h-4" />
        </div>
      ) : null}
    </Link>
  );
}

function toCssColor(color?: string | null, fallback = "var(--accent)"): string {
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
