import { handleJoust } from "@/lib/joust-api.mjs";
export const dynamic = "force-dynamic";
export async function GET(req) {
  const url = new URL(req.url);
  const { status, body } = await handleJoust("state", { since: url.searchParams.get("since"), token: url.searchParams.get("t") });
  return Response.json(body, { status });
}
