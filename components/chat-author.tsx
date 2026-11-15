import type { Activity, RoomState } from "@/lib/auction";

export function ChatAuthor({ activity, state }: { activity: Activity; state: RoomState }) {
  const member = state.members.find(entry => entry.id === activity.memberId);
  const name = activity.senderName ?? member?.name ?? "Former participant";
  const teamId = activity.senderTeamId === undefined ? member?.teamId : activity.senderTeamId;
  const team = state.teams.find(entry => entry.id === teamId);
  return <strong className="chat-author">{name}<span>{team?.shortName ?? (member?.role === "auctioneer" ? "Auctioneer" : "Spectator")}</span></strong>;
}
