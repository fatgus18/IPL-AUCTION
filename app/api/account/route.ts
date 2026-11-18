import { accountSession, publicAccountUser } from "@/lib/auth";
import { errorResponse, jsonResponse } from "@/lib/auction-server";

export async function GET(request: Request) {
  try {
    const account = await accountSession(request);
    return jsonResponse({ user: account ? publicAccountUser(account.user) : null });
  } catch (error) { return errorResponse(error); }
}
