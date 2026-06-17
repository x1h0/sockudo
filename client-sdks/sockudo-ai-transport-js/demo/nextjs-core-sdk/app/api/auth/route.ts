import { capabilityJwt } from "../_lib/sockudo";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const clientId =
    typeof body.clientId === "string" && body.clientId.length > 0
      ? body.clientId
      : `demo-${crypto.randomUUID()}`;
  return Response.json({ clientId, ...capabilityJwt(clientId) });
}
