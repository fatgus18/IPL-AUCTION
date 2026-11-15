import { errorResponse, pollRoom, jsonResponse } from "@/lib/auction-server";

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    return jsonResponse(await pollRoom((await context.params).code, request));
  }
  catch (error) { return errorResponse(error); }
}
