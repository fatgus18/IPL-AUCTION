import { resumeAccountRoom } from "@/lib/account-rooms";
import { errorResponse, jsonResponse } from "@/lib/auction-server";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try { return jsonResponse(await resumeAccountRoom(request, (await context.params).code)); }
  catch (error) { return errorResponse(error); }
}
