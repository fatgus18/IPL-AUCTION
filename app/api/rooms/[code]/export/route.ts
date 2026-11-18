import { AuctionError } from "@/lib/auction";
import { getRoom, errorResponse } from "@/lib/auction-server";
import { buildAuctionRecap, createAuctionPdf, createAuctionWorkbook } from "@/lib/auction-exports";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const state = await getRoom((await context.params).code, request);
    const format = new URL(request.url).searchParams.get("format");
    if (format !== "xlsx" && format !== "pdf") throw new AuctionError("Choose an Excel workbook or PDF recap.", 400, "INVALID_EXPORT_FORMAT");
    const recap = buildAuctionRecap(state);
    const bytes = format === "xlsx" ? await createAuctionWorkbook(recap) : await createAuctionPdf(recap);
    const code = state.code.replace(/[^A-Z0-9]/gi, "").slice(0, 12) || "auction";
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf",
        "Content-Disposition": `attachment; filename="pavilion-${code}-recap-r${recap.revision}.${format}"`,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store, max-age=0",
        "Vary": "Authorization", "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return errorResponse(error); }
}
