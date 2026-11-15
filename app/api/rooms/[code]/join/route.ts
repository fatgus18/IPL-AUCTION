import { AuctionError } from "@/lib/auction";
import { errorResponse, joinRoom, jsonResponse, readJsonBody } from "@/lib/auction-server";
import { hasSameRequestOrigin } from "@/lib/request-origin";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    if (!hasSameRequestOrigin(request)) throw new AuctionError("Open this auction room on this website to join it.", 403, "ROOM_ORIGIN");
    return jsonResponse(await joinRoom((await context.params).code, await readJsonBody(request)), 201);
  }
  catch (error) { return errorResponse(error); }
}
