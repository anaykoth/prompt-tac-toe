import { matchRequest } from "@/lib/match-context.mjs";
import { handleJoust } from "@/lib/joust-api.mjs";
export const dynamic = "force-dynamic";
async function handle(req) {
  const body = await req.json().catch(() => ({}));
  const { status, body: out } = await handleJoust("join", body);
  return Response.json(out, { status });
}

export const POST = req => matchRequest(req,handle);
