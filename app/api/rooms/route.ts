import { createRoom, errorResponse, jsonResponse, readJsonBody } from "@/lib/auction-server";

export async function POST(request: Request) {
  try { return jsonResponse(await createRoom(await readJsonBody(request)), 201); }
  catch (error) { return errorResponse(error); }
}
