import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Private storage only. Neither field belongs in a public RoomState. */
export type TeamAccessCredential = { salt: string; passwordHash: string };

/** Only the original creator's bearer can reproduce the shareable team password.
 * A database snapshot contains no plaintext password or usable creator bearer. */
export function deriveTeamPassword(hostToken: string, roomId: string, salt: string): string {
  return createHmac("sha256", Buffer.from(hostToken, "hex"))
    .update(JSON.stringify(["pavilion/team-access/v1", roomId, salt]))
    .digest("base64url").slice(0, 20);
}

export function createTeamAccess(hostToken: string, roomId: string): TeamAccessCredential {
  const salt = randomBytes(24).toString("hex");
  const password = deriveTeamPassword(hostToken, roomId, salt);
  return { salt, passwordHash: createHash("sha256").update(password).digest("hex") };
}

export function matchesTeamPassword(access: TeamAccessCredential, value: unknown): boolean {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{20}$/.test(value.trim())) return false;
  if (!/^[a-f0-9]{64}$/.test(access.passwordHash)) return false;
  const submitted = createHash("sha256").update(value.trim()).digest();
  return timingSafeEqual(submitted, Buffer.from(access.passwordHash, "hex"));
}
