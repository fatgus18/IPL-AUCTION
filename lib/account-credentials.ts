import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

type CredentialOwner = { userId: string; roomCode: string; memberId: string };
const key = (secret: string) => Buffer.from(hkdfSync("sha256", secret, "pavilion-account-rooms-v1", "room-token-encryption", 32));
const context = (owner: CredentialOwner) => Buffer.from(JSON.stringify([owner.userId, owner.roomCode, owner.memberId]));

export function encryptRoomCredential(token: string, owner: CredentialOwner, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(context(owner));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptRoomCredential(value: string, owner: CredentialOwner, secret: string): string {
  const [version, iv, tag, encrypted, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted || extra) throw new Error("Invalid saved room credential.");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
  decipher.setAAD(context(owner));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
