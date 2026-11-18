import { createHmac } from "node:crypto";
import { eq, lt, sql } from "drizzle-orm";
import { withDatabaseWrite } from "@/db";
import { accountRequestLimits } from "@/db/auth-schema";
import { AuctionError } from "@/lib/auction";
import { accountClientIP, accountSecret } from "@/lib/auth";

export async function limitAccountRequest(request: Request, operation: "login" | "register" | "link" | "resume", username?: string): Promise<void> {
  const now = Date.now();
  const rules = [
    { value: `${operation}:ip:${accountClientIP(request)}`, maximum: operation === "register" ? 10 : 60 },
    ...(username ? [{ value: `${operation}:username:${username.toLowerCase()}`, maximum: operation === "login" ? 10 : 5 }] : []),
  ];
  const allowed = await withDatabaseWrite(async tx => {
    await tx.delete(accountRequestLimits).where(lt(accountRequestLimits.resetAt, now - 60_000));
    let permitted = true;
    for (const rule of rules) {
      const key = createHmac("sha256", accountSecret()).update(`pavilion-rate-limit:${rule.value}`).digest("hex");
      await tx.insert(accountRequestLimits).values({ key, count: 1, resetAt: now + 60_000 }).onConflictDoUpdate({
        target: accountRequestLimits.key,
        set: {
          count: sql`CASE WHEN ${accountRequestLimits.resetAt} <= ${now} THEN 1 ELSE ${accountRequestLimits.count} + 1 END`,
          resetAt: sql`CASE WHEN ${accountRequestLimits.resetAt} <= ${now} THEN ${now + 60_000} ELSE ${accountRequestLimits.resetAt} END`,
        },
      });
      const [counter] = await tx.select({ count: accountRequestLimits.count }).from(accountRequestLimits).where(eq(accountRequestLimits.key, key)).limit(1);
      if (counter.count > rule.maximum) permitted = false;
    }
    return permitted;
  });
  if (!allowed) throw new AuctionError("Too many attempts. Wait a minute before trying again.", 429, "ACCOUNT_RATE_LIMIT");
}
