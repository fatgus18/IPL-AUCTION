import { getAccountAuth } from "@/lib/auth";
import { errorResponse, jsonResponse } from "@/lib/auction-server";

// Credentials use the constrained username-only account endpoints. Do not
// expose Better Auth's email signup/update routes for internal email aliases.
export async function GET(request: Request, context: { params: Promise<{ all: string[] }> }) {
  try {
    if ((await context.params).all.join("/") !== "ok") return jsonResponse({ error: "Not found." }, 404);
    await getAccountAuth(request);
    return jsonResponse({ status: "ok" });
  } catch (error) { return errorResponse(error); }
}

export function POST() { return jsonResponse({ error: "Use the Pavilion account sign-in form." }, 404); }
