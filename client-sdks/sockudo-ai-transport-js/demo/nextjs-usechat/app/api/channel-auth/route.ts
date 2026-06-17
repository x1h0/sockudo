import { channelAuth, isAllowedDemoChannel } from "../_lib/sockudo";

export async function POST(request: Request): Promise<Response> {
  const params = new URLSearchParams(await request.text());
  const socketId = params.get("socket_id");
  const channelName = params.get("channel_name");
  if (!socketId || !channelName || !isAllowedDemoChannel(channelName)) {
    return Response.json({ error: "denied" }, { status: 403 });
  }
  return Response.json(channelAuth(socketId, channelName));
}
