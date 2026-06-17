import { proxyVersionedMessage } from "../_lib/sockudo";

export async function POST(request: Request): Promise<Response> {
  return proxyVersionedMessage((await request.json()) as Record<string, unknown>);
}
