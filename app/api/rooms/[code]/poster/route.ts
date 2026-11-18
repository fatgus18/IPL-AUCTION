import { getRoom, errorResponse } from "@/lib/auction-server";
import { buildFranchisePoster, createFranchisePosterPng, franchisePosterFilename } from "@/lib/franchise-poster";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const state = await getRoom((await context.params).code, request);
    const teamId = new URL(request.url).searchParams.get("team") ?? "";
    const poster = buildFranchisePoster(state, teamId);
    const bytes = await createFranchisePosterPng(poster);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/png", "Content-Disposition": `attachment; filename="${franchisePosterFilename(poster)}"`,
      "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store, max-age=0",
      "Vary": "Authorization", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return errorResponse(error); }
}
