import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins/username";
import { verifyPassword } from "better-auth/crypto";
import { getDb, withDatabaseWrite } from "@/db";
import { authUsers, authSessions, authAccounts, authVerifications, authRateLimits } from "@/db/auth-schema";
import { AuctionError } from "@/lib/auction";
import { hasSameRequestOrigin } from "@/lib/request-origin";

export function accountSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Account authentication requires a configured BETTER_AUTH_SECRET of at least 32 characters.");
  return secret;
}

/** Never infer a production cookie origin from an arbitrary forwarded host. */
function accountOrigin(request: Request): string {
  const requested = new URL(request.url);
  const host = request.headers.get("host");
  const addressed = host && !/[\s/\\?#@,]/.test(host) ? new URL(`${requested.protocol}//${host}`) : requested;
  if (process.env.VERCEL !== "1" && ["localhost", "127.0.0.1", "[::1]"].includes(addressed.hostname)) return addressed.origin;
  const allowed = [process.env.BETTER_AUTH_URL, process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`, process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]
    .filter((value): value is string => !!value).map(value => new URL(value).origin);
  if (!allowed.includes(addressed.origin)) throw new AuctionError("Open Pavilion at its configured website address to sign in.", 403, "ACCOUNT_ORIGIN");
  return addressed.origin;
}

export function requireAccountOrigin(request: Request): void {
  if (!hasSameRequestOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AuctionError("Open Pavilion on this website to manage your account.", 403, "ACCOUNT_ORIGIN");
  }
}

type PreparedPassword = { password: string; hash: string };

async function createAuth(origin: string, preparedPassword?: PreparedPassword) {
  const database = await getDb();
  // Auth credential creation is atomic and shares the same SQLite writer queue
  // as bidding. Registration prepares its library password hash before entering
  // this transaction, in a request-local configuration that is never cached.
  const authDatabase = new Proxy(database, {
    get(target, property, receiver) {
      return property === "transaction" ? withDatabaseWrite : Reflect.get(target, property, receiver);
    },
  });
  return betterAuth({
    appName: "Pavilion",
    baseURL: origin,
    basePath: "/api/auth",
    secret: accountSecret(),
    database: drizzleAdapter(authDatabase, {
      provider: "sqlite", transaction: true,
      schema: { user: authUsers, session: authSessions, account: authAccounts, verification: authVerifications, rateLimit: authRateLimits },
    }),
    emailAndPassword: {
      enabled: true, minPasswordLength: 12, maxPasswordLength: 128, requireEmailVerification: false, autoSignIn: true,
      ...(preparedPassword ? { password: {
        hash: async (value: string) => {
          if (value !== preparedPassword.password) throw new Error("Password changed during account registration.");
          return preparedPassword.hash;
        },
        verify: verifyPassword,
      } } : {}),
    },
    session: { expiresIn: 30 * 24 * 60 * 60, disableSessionRefresh: true, cookieCache: { enabled: false } },
    advanced: {
      cookiePrefix: "pavilion",
      useSecureCookies: origin.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: ["x-pavilion-client-ip"] },
    },
    rateLimit: {
      enabled: true, storage: "database", window: 60, max: 100,
      customRules: { "/sign-in/username": { window: 60, max: 30 }, "/sign-up/email": { window: 60, max: 10 } },
    },
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 30, immutableUsername: true, usernameValidator: value => /^[a-zA-Z0-9_]{3,30}$/.test(value) })],
  });
}

const instances = new Map<string, ReturnType<typeof createAuth>>();
export function getAccountAuth(request: Request, preparedPassword?: PreparedPassword): ReturnType<typeof createAuth> {
  const origin = accountOrigin(request);
  if (preparedPassword) return createAuth(origin, preparedPassword);
  let pending = instances.get(origin);
  if (!pending) {
    pending = createAuth(origin).catch(error => { instances.delete(origin); throw error; });
    instances.set(origin, pending);
  }
  return pending;
}

export function accountClientIP(request: Request): string {
  // Vercel overwrites x-vercel-forwarded-for. Never trust client-controlled
  // x-forwarded-for on a directly reachable local Node server.
  const candidate = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : undefined;
  return candidate && /^[0-9a-f:.]+$/i.test(candidate) ? candidate : "127.0.0.1";
}

export async function accountSession(request: Request) {
  if (!request.headers.get("cookie")?.includes("pavilion.session_token=")) return null;
  return (await getAccountAuth(request)).api.getSession({ headers: request.headers });
}

export async function requireAccountSession(request: Request) {
  const session = await accountSession(request);
  if (!session) throw new AuctionError("Sign in to access your saved auctions.", 401, "ACCOUNT_REQUIRED");
  return session;
}

export function publicAccountUser(user: { id: string; name: string; username?: string | null }) {
  return { id: user.id, username: user.username || user.name, name: user.name };
}
