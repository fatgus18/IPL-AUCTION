import { handleAccountCredentials } from "@/lib/account-auth-handler";
import { errorResponse } from "@/lib/auction-server";

export async function POST(request: Request) {
  try { return await handleAccountCredentials(request, "login"); }
  catch (error) { return errorResponse(error); }
}
