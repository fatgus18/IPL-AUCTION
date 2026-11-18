import { createRoom, errorResponse, jsonResponse, readJsonBody } from "@/lib/auction-server";
import { autoSaveAccountRoom } from "@/lib/account-rooms";
import { requireAccountOrigin } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    requireAccountOrigin(request);
    return jsonResponse(await autoSaveAccountRoom(request, await createRoom(await readJsonBody(request))), 201);
  }
  catch (error) { return errorResponse(error); }
}
