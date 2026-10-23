import { matchRequest } from "@/lib/match-context.mjs";
import { handleJoust } from "@/lib/joust-api.mjs";
export const dynamic = "force-dynamic";
async function handle(req) {
  const url = new URL(req.url);
  const { status, body } = await handleJoust("state", { since: url.searchParams.get("since"), token: url.searchParams.get("t") });
  return Response.json(body, { status });
}

export const GET = req => matchRequest(req,handle);
