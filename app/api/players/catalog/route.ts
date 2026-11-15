import { AuctionError } from "@/lib/auction";
import { actOnCatalog, errorResponse, jsonResponse, readJsonBody } from "@/lib/auction-server";
import { readSharedCatalogVersion, readSharedPlayerCatalog } from "@/lib/player-catalog-store";
import { hasSameRequestOrigin } from "@/lib/request-origin";

export async function GET(request: Request) {
  try {
    const since = new URL(request.url).searchParams.get("since");
    if (since !== null && /^\d+$/.test(since) && Number.isSafeInteger(Number(since))) {
      const version = await readSharedCatalogVersion();
      if (version === Number(since)) return jsonResponse({ unchanged: true, version });
    }
    return jsonResponse(await readSharedPlayerCatalog());
  }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    if (!hasSameRequestOrigin(request)) throw new AuctionError("Open the player pool on this website to edit it.", 403, "CATALOG_ORIGIN");
    const body = await readJsonBody(request);
    return jsonResponse(await actOnCatalog(request, body.action));
  } catch (error) { return errorResponse(error); }
}
