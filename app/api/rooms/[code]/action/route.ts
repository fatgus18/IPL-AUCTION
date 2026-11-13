import type { AuctionAction } from "@/lib/auction";
import { actInRoom, errorResponse, jsonResponse, readJsonBody } from "@/lib/auction-server";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const body = await readJsonBody(request);
    return jsonResponse({ state: await actInRoom((await context.params).code, request, body.action as AuctionAction) });
  } catch (error) { return errorResponse(error); }
}
