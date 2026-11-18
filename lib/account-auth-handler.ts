import { accountClientIP, getAccountAuth, publicAccountUser, requireAccountOrigin } from "@/lib/auth";
import { limitAccountRequest } from "@/lib/account-rate-limit";
import { AuctionError } from "@/lib/auction";
import { jsonResponse, readJsonBody } from "@/lib/auction-server";
import { hashPassword } from "better-auth/crypto";

/** The only public credential entry points: email identifiers remain internal. */
export async function handleAccountCredentials(request: Request, operation: "register" | "login" | "logout"): Promise<Response> {
  requireAccountOrigin(request);
  const body = operation === "logout" ? {} : await readJsonBody(request);
  let submitted: Record<string, unknown> = {};
  if (operation !== "logout") {
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    if (!/^[a-z0-9_]{3,30}$/.test(username)) throw new AuctionError("Use 3–30 letters, numbers or underscores for your username.", 400, "INVALID_USERNAME");
    if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) throw new AuctionError("Use a password between 12 and 128 characters.", 400, "INVALID_PASSWORD");
    await limitAccountRequest(request, operation, username);
    submitted = operation === "register"
      ? { username, password: body.password, name: typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : username, email: `${username}@accounts.pavilion.invalid` }
      : { username, password: body.password };
  }
  // Better Auth runs signup hashing inside its credential transaction. Prepare
  // the same maintained scrypt hash first, so account creation cannot hold the
  // auction's SQLite writer lock while the expensive hash is computed.
  const preparedPassword = operation === "register"
    ? { password: submitted.password as string, hash: await hashPassword(submitted.password as string) }
    : undefined;
  const auth = await getAccountAuth(request, preparedPassword);
  const path = operation === "register" ? "sign-up/email" : operation === "login" ? "sign-in/username" : "sign-out";
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("authorization");
  headers.set("content-type", "application/json");
  headers.set("x-pavilion-client-ip", accountClientIP(request));
  const response = await auth.handler(new Request(`${auth.options.baseURL}/api/auth/${path}`, { method: "POST", headers, body: JSON.stringify(submitted) }));
  const result = await response.json();
  let output: Response;
  if (!response.ok) {
    const status = response.status === 429 ? 429 : response.status >= 500 ? 503 : operation === "login" ? 401 : 400;
    output = jsonResponse({
      error: status === 429 ? "Too many attempts. Wait a minute before trying again." : status === 503 ? "Account sign-in is temporarily unavailable. Please try again." : operation === "login" ? "That username and password do not match." : "That username is already registered. Try signing in or choose a different username.",
      code: status === 429 ? "ACCOUNT_RATE_LIMIT" : operation === "login" ? "INVALID_CREDENTIALS" : "ACCOUNT_REGISTRATION_FAILED",
    }, status);
  } else {
    output = jsonResponse({ user: operation === "logout" ? null : publicAccountUser(result.user) }, operation === "register" ? 201 : 200);
  }
  // Forward each cookie separately; joining Set-Cookie corrupts Expires fields.
  for (const cookie of response.headers.getSetCookie()) output.headers.append("Set-Cookie", cookie);
  const retry = response.headers.get("x-retry-after");
  if (retry) output.headers.set("Retry-After", retry);
  return output;
}
