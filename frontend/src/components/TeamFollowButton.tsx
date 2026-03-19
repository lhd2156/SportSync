import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MouseEventHandler } from "react";
import apiClient from "../api/client";
import { API } from "../constants";

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
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["savedTeams"] }),
        queryClient.invalidateQueries({ queryKey: ["teams"] }),
        queryClient.invalidateQueries({ queryKey: ["team", teamId] }),
        queryClient.invalidateQueries({ queryKey: ["feed"] }),
      ]);
    },
  });

  return (
    <button
      type="button"
      onClick={(event) => {
        onClick?.(event);
        void followMutation.mutateAsync();
      }}
      disabled={followMutation.isPending}
      className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-70 ${
        isFollowing
          ? "bg-accent text-foreground shadow-[0_10px_25px_rgba(46,142,255,0.18)]"
          : "border border-accent/35 text-accent hover:border-accent hover:bg-accent/10"
      } ${className}`}
    >
      {followMutation.isPending ? "Saving..." : isFollowing ? "Following" : "Follow"}
    </button>
  );
}
