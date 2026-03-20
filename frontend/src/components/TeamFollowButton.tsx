import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MouseEventHandler } from "react";
import apiClient from "../api/client";
import { API } from "../constants";
import type { Team } from "../types";

interface TeamFollowButtonProps {
  teamId: string;
  isFollowing: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
}

export default function TeamFollowButton({
  teamId,
  isFollowing,
  onClick,
  className = "",
}: TeamFollowButtonProps) {
  const queryClient = useQueryClient();

  const followMutation = useMutation({
    mutationFn: async () => {
      if (isFollowing) {
        await apiClient.delete(`${API.USER_TEAMS}/${teamId}`);
      } else {
        await apiClient.post(`${API.USER_TEAMS}/${teamId}`);
      }
    },
    /* Optimistic update — toggle instantly, revert on error */
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["savedTeams"] });
      const previousTeams = queryClient.getQueryData<Team[]>(["savedTeams"]);

      queryClient.setQueryData<Team[]>(["savedTeams"], (old = []) => {
        if (isFollowing) {
          return old.filter((t) => t.id !== teamId);
        }
        return [...old, { id: teamId, name: "", shortName: "", sport: "", league: "", externalId: "", logoUrl: "", city: "", record: null, color: null }];
      });

      return { previousTeams };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousTeams) {
        queryClient.setQueryData(["savedTeams"], context.previousTeams);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["savedTeams"] });
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  return (
    <button
      type="button"
      onClick={(event) => {
        onClick?.(event);
        followMutation.mutate();
      }}
      className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition-all ${
        isFollowing
          ? "bg-accent text-foreground shadow-[0_10px_25px_rgba(46,142,255,0.18)]"
          : "border border-accent/35 text-accent hover:border-accent hover:bg-accent/10"
      } ${className}`}
    >
      {isFollowing ? "Following" : "Follow"}
    </button>
  );
}
