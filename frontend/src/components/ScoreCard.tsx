/**
 * SportSync - Score Card Component
 *
 * Displays a single game score: two teams, scores, status, and league.
 * Shows a live pulsing indicator for in-progress games.
 */
import { Link } from "react-router-dom";

interface ScoreCardProps {
  id: string;
  homeTeam: { name: string; shortName?: string; logoUrl?: string | null };
  awayTeam: { name: string; shortName?: string; logoUrl?: string | null };
  homeScore: number;
  awayScore: number;
  status: string;
  league: string;
  scheduledAt: string;
}

export default function ScoreCard({
  id,
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  status,
  league,
  scheduledAt,
}: ScoreCardProps) {
  const isLive = status === "live";
  const isFinal = status === "final";

  return (
    <Link
      to={`/games/${id}`}
      className="bg-surface border border-muted/20 rounded-xl p-4 hover:border-accent/30 transition-all block"
    >
      {/* Header: league + status */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted">{league}</span>
        {isLive ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-red-400">
            <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse-live" />
            LIVE
          </span>
        ) : isFinal ? (
          <span className="text-xs text-muted">FINAL</span>
        ) : (
          <span className="text-xs text-muted">
            {new Date(scheduledAt).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      {/* Teams and scores */}
      <div className="space-y-2">
        <TeamRow
          name={homeTeam.shortName || homeTeam.name}
          logoUrl={homeTeam.logoUrl}
          score={homeScore}
          isWinning={homeScore > awayScore && (isLive || isFinal)}
        />
        <TeamRow
          name={awayTeam.shortName || awayTeam.name}
          logoUrl={awayTeam.logoUrl}
          score={awayScore}
          isWinning={awayScore > homeScore && (isLive || isFinal)}
        />
      </div>
    </Link>
  );
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
          <img src={logoUrl} alt={name} className="w-6 h-6 object-contain" />
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
