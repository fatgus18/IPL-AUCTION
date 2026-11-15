import { createPractice, errorResponse, jsonResponse, readJsonBody } from "@/lib/auction-server";

export async function POST(request: Request) {
  try {
    await readJsonBody(request);
    return jsonResponse(await createPractice(), 201);
  } catch (error) { return errorResponse(error); }
}
