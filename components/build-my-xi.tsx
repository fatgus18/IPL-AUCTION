import type { AuctionAction, RoomState } from "@/lib/auction";
import { LineupBuilder } from "./lineup-builder";

type BuildMyXIProps = {
  state: RoomState;
  memberId: string;
  onAction: (action: AuctionAction) => Promise<void>;
  connected?: boolean;
};

/** A separate workspace for the team's lineup; purchased players stay in My Squad. */
export function BuildMyXI({ state, memberId, onAction, connected = true }: BuildMyXIProps) {
  const member = state.members.find((entry) => entry.id === memberId);
  const team = member?.role === "bidder" ? state.teams.find((entry) => entry.id === member.teamId) : undefined;
  if (!team) return null;
  return <LineupBuilder key={`${state.id}:${team.id}`} team={team} players={state.players} onAction={onAction} connected={connected} />;
}
