import { getAuctionSeason } from "@/lib/auction-season-server";
import { errorResponse } from "@/lib/auction-server";
import { createSeasonWorkbook } from "@/lib/season-export";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const season = await getAuctionSeason((await context.params).code, request);
    const bytes = await createSeasonWorkbook(season);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pavilion-${season.code}-season-r${season.revision}.xlsx"`,
      "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store, max-age=0",
      Vary: "Authorization", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return errorResponse(error); }
}
