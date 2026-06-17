import { config } from "../_lib/sockudo";

export function GET(): Response {
  return Response.json({
    appKey: config.appKey,
    channelName: config.channelName,
    host: config.host,
    port: config.port,
  });
}
