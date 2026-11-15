import { AuctionError } from "@/lib/auction";
import { createCatalogEditor, errorResponse, jsonResponse, readJsonBody } from "@/lib/auction-server";
import { hasSameRequestOrigin } from "@/lib/request-origin";

export async function POST(request: Request) {
  try {
    if (!hasSameRequestOrigin(request)) throw new AuctionError("Open the player pool on this website to edit it.", 403, "CATALOG_ORIGIN");
    await readJsonBody(request);
    return jsonResponse(await createCatalogEditor(), 201);
  } catch (error) { return errorResponse(error); }
}
