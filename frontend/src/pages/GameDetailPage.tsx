/**
 * SportSync - Game Detail Page
 *
 * Full game view with sticky header and tab navigation:
 * Feed (play-by-play), Game (box score), Team A stats, Team B stats.
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Navbar from "../components/Navbar";
import LiveBadge from "../components/LiveBadge";
import Footer from "../components/Footer";
import apiClient from "../api/client";

interface GameDetail {
  id: string;
  home_team: { id: string; name: string; short_name?: string; logo_url?: string | null; city?: string };
  away_team: { id: string; name: string; short_name?: string; logo_url?: string | null; city?: string };
  sport: string;
  league: string;
  status: string;
  home_score: number;
  away_score: number;
  scheduled_at: string;
  prediction: { home_win_prob: number; away_win_prob: number; model_version: string } | null;
}

type Tab = "feed" | "game" | "home" | "away";

export default function GameDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<Tab>("game");

  const { data: game, isLoading } = useQuery<GameDetail>({
    queryKey: ["game", id],
    queryFn: async () => {
      const res = await apiClient.get(`/api/games/${id}`);
      return res.data;
    },
    enabled: !!id,
  });

  if (isLoading || !game) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const isLive = game.status === "live";
  const homeShort = game.home_team.short_name || game.home_team.name;
  const awayShort = game.away_team.short_name || game.away_team.name;

  const tabs: { key: Tab; label: string }[] = [
    { key: "feed", label: "Feed" },
    { key: "game", label: "Game" },
    { key: "home", label: homeShort },
    { key: "away", label: awayShort },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Sticky game header */}
      <div className="sticky top-14 z-30 bg-surface/90 backdrop-blur-md border-b border-muted/15">
        <div className="max-w-3xl mx-auto px-4 py-4">
          {/* Top bar: league + status */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-muted">{game.league}</span>
            {isLive ? (
              <LiveBadge />
            ) : (
              <span className="text-xs text-muted">
                {game.status === "final" ? "FINAL" : new Date(game.scheduled_at).toLocaleString()}
              </span>
            )}
          </div>

          {/* Scores row */}
          <div className="flex items-center justify-center gap-6">
            <div className="flex items-center gap-2">
              {game.home_team.logo_url ? (
                <img src={game.home_team.logo_url} alt={homeShort} className="w-8 h-8 object-contain" />
              ) : (
                <div className="w-8 h-8 bg-muted/20 rounded-full flex items-center justify-center text-xs font-bold text-muted">
                  {homeShort.charAt(0)}
                </div>
              )}
              <span className="text-sm font-medium text-foreground">{homeShort}</span>
            </div>

            <div className="text-2xl font-bold text-foreground tabular-nums px-4">
              {game.home_score} - {game.away_score}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{awayShort}</span>
              {game.away_team.logo_url ? (
                <img src={game.away_team.logo_url} alt={awayShort} className="w-8 h-8 object-contain" />
              ) : (
                <div className="w-8 h-8 bg-muted/20 rounded-full flex items-center justify-center text-xs font-bold text-muted">
                  {awayShort.charAt(0)}
                </div>
              )}
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 mt-4">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === tab.key
                    ? "bg-accent text-white"
                    : "text-muted hover:text-foreground hover:bg-background/50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <main className="max-w-3xl mx-auto px-4 py-6">
        {activeTab === "feed" && <FeedTab game={game} />}
        {activeTab === "game" && <GameTab game={game} />}
        {activeTab === "home" && <TeamTab team={game.home_team} label="Home" />}
        {activeTab === "away" && <TeamTab team={game.away_team} label="Away" />}
      </main>

      <Footer />
    </div>
  );
}

/* Feed tab: live play-by-play activity */
function FeedTab({ game }: { game: GameDetail }) {
  const plays = [
    { id: "1", time: "Q4 8:42", desc: `${game.home_team.short_name || game.home_team.name} scores on a fast break` },
    { id: "2", time: "Q4 7:15", desc: `Timeout called by ${game.away_team.short_name || game.away_team.name}` },
    { id: "3", time: "Q4 6:30", desc: `${game.away_team.short_name || game.away_team.name} with the three-pointer` },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-foreground font-medium mb-3">Play-by-Play</h3>
      {plays.map((play) => (
        <div key={play.id} className="bg-surface border border-muted/15 rounded-lg p-3 flex items-start gap-3">
          <span className="text-xs text-accent font-mono whitespace-nowrap mt-0.5">{play.time}</span>
          <p className="text-sm text-foreground-base">{play.desc}</p>
        </div>
      ))}
      {game.status !== "live" && (
        <p className="text-center text-muted text-sm py-4">
          Play-by-play is available during live games.
        </p>
      )}
    </div>
  );
}

/* Game tab: box score + prediction */
function GameTab({ game }: { game: GameDetail }) {
  return (
    <div className="space-y-6">
      {/* Box score */}
      <div className="bg-surface border border-muted/15 rounded-xl p-6">
        <h3 className="text-foreground font-medium mb-4">Score</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-sm text-muted mb-1">
              {game.home_team.short_name || game.home_team.name}
            </p>
            <p className="text-3xl font-bold text-foreground">{game.home_score}</p>
          </div>
          <div className="flex items-center justify-center">
            <span className="text-muted text-sm">vs</span>
          </div>
          <div>
            <p className="text-sm text-muted mb-1">
              {game.away_team.short_name || game.away_team.name}
            </p>
            <p className="text-3xl font-bold text-foreground">{game.away_score}</p>
          </div>
        </div>
      </div>

      {/* Prediction widget */}
      {game.prediction && (
        <div className="bg-surface border border-muted/15 rounded-xl p-6">
          <h3 className="text-foreground font-medium mb-4">Win Probability</h3>
          <ProbBar
            label={game.home_team.short_name || game.home_team.name}
            prob={game.prediction.home_win_prob}
            accent
          />
          <ProbBar
            label={game.away_team.short_name || game.away_team.name}
            prob={game.prediction.away_win_prob}
          />
          <p className="text-xs text-muted mt-3">Model: {game.prediction.model_version}</p>
        </div>
      )}

      {/* Game info */}
      <div className="bg-surface border border-muted/15 rounded-xl p-6">
        <h3 className="text-foreground font-medium mb-3">Game Info</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <InfoRow label="League" value={game.league} />
          <InfoRow label="Sport" value={game.sport} />
          <InfoRow label="Date" value={new Date(game.scheduled_at).toLocaleDateString()} />
          <InfoRow label="Time" value={new Date(game.scheduled_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} />
        </div>
      </div>
    </div>
  );
}

/* Team tab: roster, recent form, stats */
function TeamTab({ team, label }: { team: GameDetail["home_team"]; label: string }) {
  return (
    <div className="space-y-6">
      {/* Team header */}
      <div className="bg-surface border border-muted/15 rounded-xl p-6 flex items-center gap-4">
        {team.logo_url ? (
          <img src={team.logo_url} alt={team.name} className="w-16 h-16 object-contain" />
        ) : (
          <div className="w-16 h-16 bg-muted/20 rounded-full flex items-center justify-center text-2xl font-bold text-muted">
            {(team.short_name || team.name).charAt(0)}
          </div>
        )}
        <div>
          <h3 className="text-foreground font-semibold text-lg">{team.name}</h3>
          {team.city && <p className="text-sm text-muted">{team.city}</p>}
          <span className="text-xs text-accent">{label} Team</span>
        </div>
      </div>

      {/* Recent form */}
      <div className="bg-surface border border-muted/15 rounded-xl p-6">
        <h3 className="text-foreground font-medium mb-3">Recent Form</h3>
        <div className="flex gap-1.5">
          {["W", "W", "L", "W", "L"].map((r, i) => (
            <span
              key={i}
              className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                r === "W" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
              }`}
            >
              {r}
            </span>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="bg-surface border border-muted/15 rounded-xl p-6">
        <h3 className="text-foreground font-medium mb-3">Season Stats</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <InfoRow label="Record" value="32-18" />
          <InfoRow label="Win %" value=".640" />
          <InfoRow label="PPG" value="108.5" />
          <InfoRow label="OPPG" value="103.2" />
        </div>
      </div>
    </div>
  );
}

function ProbBar({ label, prob, accent }: { label: string; prob: number; accent?: boolean }) {
  return (
    <div className="mb-3">
      <div className="flex justify-between mb-1">
        <span className="text-sm text-foreground-base">{label}</span>
        <span className={`text-sm font-medium ${accent ? "text-accent" : "text-foreground-base"}`}>
          {Math.round(prob * 100)}%
        </span>
      </div>
      <div className="w-full h-1.5 bg-muted/15 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${accent ? "bg-accent" : "bg-muted/40"}`}
          style={{ width: `${prob * 100}%` }}
        />
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted text-xs">{label}</span>
      <p className="text-foreground-base">{value}</p>
    </div>
  );
}
