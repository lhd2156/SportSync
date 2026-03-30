import type { GameItem, PredictionResult } from "../types/dashboard";

type PredictionEligibleGame = Pick<
  GameItem,
  "id" | "leagueKey" | "status" | "homeScore" | "awayScore"
> | {
  id: string;
  league?: string;
  status: string;
  homeScore: number;
  awayScore: number;
};

const FALLBACK_MODEL_VERSION = "client_fallback_v1";
const FALLBACK_MARGIN_SCALES: Record<string, number> = {
  NFL: 7.0,
  NBA: 11.0,
  MLB: 2.0,
  NHL: 1.5,
  EPL: 1.0,
};

function clampProbability(value: number, floor = 0.02, ceiling = 0.98) {
  return Math.max(floor, Math.min(ceiling, value));
}

function clampNonNegative(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

export function getDisplayPercentages(homeWinProb: number, awayWinProb: number): {
  homePct: number;
  awayPct: number;
} {
  const normalizedHome = clampNonNegative(homeWinProb);
  const normalizedAway = clampNonNegative(awayWinProb);
  const total = normalizedHome + normalizedAway;

  if (total <= 0) {
    return { homePct: 50, awayPct: 50 };
  }

  const homeShare = normalizedHome / total;
  const homePct = Math.max(0, Math.min(100, Math.round(homeShare * 100)));
  const awayPct = 100 - homePct;

  return { homePct, awayPct };
}

export function buildFallbackPrediction(game: PredictionEligibleGame): PredictionResult {
  const league = String("leagueKey" in game ? game.leagueKey : game.league || "")
    .trim()
    .toUpperCase();
  const status = String(game.status || "").trim().toLowerCase();
  const homeScore = Number(game.homeScore || 0);
  const awayScore = Number(game.awayScore || 0);
  const margin = homeScore - awayScore;
  const scale = FALLBACK_MARGIN_SCALES[league] ?? 8.0;

  let homeWinProb = 0.52;

  if (status === "final") {
    if (margin > 0) {
      homeWinProb = 0.995;
    } else if (margin < 0) {
      homeWinProb = 0.005;
    } else {
      homeWinProb = 0.5;
    }
  } else if (status === "live") {
    const logisticHome = 1 / (1 + Math.exp(-(margin / Math.max(scale, 0.5))));
    homeWinProb = clampProbability((0.88 * logisticHome) + 0.0624);
  }

  return {
    gameId: String(game.id),
    homeWinProb: Number(homeWinProb.toFixed(4)),
    awayWinProb: Number((1 - homeWinProb).toFixed(4)),
    modelVersion: FALLBACK_MODEL_VERSION,
  };
}
