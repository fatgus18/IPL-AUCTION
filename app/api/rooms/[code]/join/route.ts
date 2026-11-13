import { errorResponse, joinRoom, jsonResponse, readJsonBody } from "@/lib/auction-server";

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try { return jsonResponse(await joinRoom((await context.params).code, await readJsonBody(request)), 201); }
  catch (error) { return errorResponse(error); }
}
