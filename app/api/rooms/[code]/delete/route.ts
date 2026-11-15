import { AuctionError } from "@/lib/auction";
import { deleteRoom, errorResponse, jsonResponse, readJsonBody } from "@/lib/auction-server";
import { hasSameRequestOrigin } from "@/lib/request-origin";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    if (!hasSameRequestOrigin(request)) throw new AuctionError("Open this auction room on this website to manage it.", 403, "ROOM_ORIGIN");
    return jsonResponse(await deleteRoom((await context.params).code, request, await readJsonBody(request)));
  } catch (error) { return errorResponse(error); }
}
