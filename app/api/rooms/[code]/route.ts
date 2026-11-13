import { errorResponse, getRoom, jsonResponse } from "@/lib/auction-server";

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  try { return jsonResponse({ state: await getRoom((await context.params).code, request) }); }
  catch (error) { return errorResponse(error); }
}
