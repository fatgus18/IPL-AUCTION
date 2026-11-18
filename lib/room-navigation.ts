import type { Member } from "./auction";

export type RoomView = "room" | "players" | "squads" | "my-squad" | "build-xi" | "targets" | "settings" | "broadcast";
type RoomViewer = Pick<Member, "role" | "teamId"> | undefined;

export function parseRoomView(value: string | null): RoomView {
  switch (value) {
    case "players": case "squads": case "my-squad": case "build-xi": case "targets": case "settings": case "broadcast": return value;
    default: return "room";
  }
}

export function canViewMySquad(member: RoomViewer): boolean {
  return !!member && member.role !== "auctioneer";
}

export function canBuildXI(member: RoomViewer): boolean {
  return member?.role === "bidder" && !!member.teamId;
}

export function canViewTargets(member: RoomViewer): boolean {
  return member?.role === "bidder" && !!member.teamId;
}

/** Apply the same role rules to navigation, restored URLs and incoming room state. */
export function normalizeRoomView(view: RoomView, member: RoomViewer): RoomView {
  if (view === "my-squad" && !canViewMySquad(member)) return "room";
  if (view === "build-xi" && !canBuildXI(member)) return "room";
  if (view === "targets" && !canViewTargets(member)) return "room";
  return view;
}
