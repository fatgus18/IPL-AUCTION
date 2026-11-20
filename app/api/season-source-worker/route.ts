import { actOnSeasonSourceWorker, authorizeSeasonSourceWorker } from "@/lib/season-source-worker";
import { errorResponse, jsonResponse, readJsonBody } from "@/lib/auction-server";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(request: Request) {
  try {
    authorizeSeasonSourceWorker(request);
    return jsonResponse(await actOnSeasonSourceWorker(await readJsonBody(request, 2 * 1024 * 1024)));
  } catch (error) { return errorResponse(error); }
}
