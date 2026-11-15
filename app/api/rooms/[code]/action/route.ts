import { AuctionError, type AuctionAction } from "@/lib/auction";
import { actInRoom, errorResponse, jsonResponse, readJsonBody } from "@/lib/auction-server";
import { hasSameRequestOrigin } from "@/lib/request-origin";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    if (!hasSameRequestOrigin(request)) throw new AuctionError("Open this auction room on this website to make changes.", 403, "ROOM_ORIGIN");
    const body = await readJsonBody(request);
    return jsonResponse({ state: await actInRoom((await context.params).code, request, body.action as AuctionAction, {
      memberId: body.memberId, resetPractice: body.resetPractice,
    }) });
  } catch (error) { return errorResponse(error); }
}
