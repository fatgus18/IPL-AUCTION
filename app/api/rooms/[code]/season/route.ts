import { AuctionError } from "@/lib/auction";
import { errorResponse, jsonResponse, readJsonBody } from "@/lib/auction-server";
import { getAuctionSeason, updateAuctionSeason } from "@/lib/auction-season-server";
import { hasSameRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  try { return jsonResponse({ season: await getAuctionSeason((await context.params).code, request) }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    if (!hasSameRequestOrigin(request)) throw new AuctionError("Open this auction room on this website to update season data.", 403, "ROOM_ORIGIN");
    return jsonResponse({ season: await updateAuctionSeason((await context.params).code, request, await readJsonBody(request, 2 * 1024 * 1024)) });
  } catch (error) { return errorResponse(error); }
}
