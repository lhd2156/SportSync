import { useNavigate } from "react-router-dom";
import SafeAvatar from "./SafeAvatar";
import TeamFollowButton from "./TeamFollowButton";
import type { Team } from "../types";

interface TeamCardProps {
  team: Team;
  isFollowing: boolean;
}

export default function TeamCard({ team, isFollowing }: TeamCardProps) {
  const navigate = useNavigate();
  const accent = team.color?.startsWith("#") ? team.color : team.color ? `#${team.color}` : "#2E8EFF";

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/teams/${team.id}`)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(`/teams/${team.id}`);
        }
      }}
      className="group relative overflow-hidden rounded-3xl border border-muted/15 bg-surface px-5 py-5 transition-all hover:border-accent/30 hover:bg-surface/95"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-28 opacity-80"
        style={{
          background: `linear-gradient(180deg, ${accent}20 0%, rgba(10,14,30,0) 100%)`,
        }}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <SafeAvatar
            src={team.logoUrl}
            alt={team.name}
            className="flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/20 bg-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
            imgClassName="h-11 w-11 object-contain"
            loadingContent={<div className="h-11 w-11 animate-pulse rounded-xl bg-accent/10" />}
            fallback={
              <span className="text-lg font-semibold tracking-[0.18em] text-accent/70">
                {(team.shortName || team.name).slice(0, 3).toUpperCase()}
              </span>
            }
          />

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">
                {team.league}
              </span>
              {team.record ? (
                <span className="text-xs font-medium text-foreground-base">{team.record}</span>
              ) : null}
            </div>
            <h3 className="text-lg font-semibold text-foreground transition-colors group-hover:text-white">
              {team.name}
            </h3>
            <p className="text-sm text-muted">{team.city || "League club"}</p>
          </div>
        </div>

        <TeamFollowButton
          teamId={team.id}
          isFollowing={isFollowing}
          onClick={(event) => {
            event.stopPropagation();
          }}
          className="min-w-[108px]"
        />
      </div>
    </article>
  );
}
