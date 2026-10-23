import { handleJoust } from "@/lib/joust-api.mjs";
export const dynamic = "force-dynamic";
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { status, body: out } = await handleJoust("presence", body);
  return Response.json(out, { status });
}
