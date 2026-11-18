import { attachAccountRoom, listAccountRooms } from "@/lib/account-rooms";
import { errorResponse, jsonResponse, readJsonBody } from "@/lib/auction-server";

export async function GET(request: Request) {
  try { return jsonResponse(await listAccountRooms(request)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { return jsonResponse(await attachAccountRoom(request, await readJsonBody(request))); }
  catch (error) { return errorResponse(error); }
}
