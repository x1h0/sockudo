import { createHash, createHmac } from "node:crypto";
import Sockudo from "@sockudo/client";
import { adaptSockudoClient, type SockudoClientPeer } from "@sockudo/ai-transport";

export interface DemoConfig {
  appId: string;
  appKey: string;
  appSecret: string;
  channelName: string;
  host: string;
  port: number;
}

export const config: DemoConfig = {
  appId: process.env.SOCKUDO_APP_ID ?? "demo-app",
  appKey: process.env.SOCKUDO_APP_KEY ?? "demo-key",
  appSecret: process.env.SOCKUDO_APP_SECRET ?? "demo-secret",
  channelName: process.env.SOCKUDO_CHANNEL_NAME ?? "private-ai-core",
  host: process.env.SOCKUDO_HOST ?? "127.0.0.1",
  port: Number(process.env.SOCKUDO_PORT ?? "6001"),
};

export function realtimeClient(): ReturnType<typeof adaptSockudoClient> {
  return adaptSockudoClient(
    new Sockudo(config.appKey, {
      cluster: "local",
      forceTLS: false,
      enabledTransports: ["ws"],
      wsHost: config.host,
      wsPort: config.port,
      wssPort: config.port,
      protocolVersion: 2,
    }) as unknown as SockudoClientPeer,
  );
}

export function channelAuth(socketId: string, channelName: string): { auth: string } {
  const signature = createHmac("sha256", config.appSecret)
    .update(`${socketId}:${channelName}`)
    .digest("hex");
  return { auth: `${config.appKey}:${signature}` };
}

export function capabilityJwt(clientId: string): {
  token: string;
  expiresAt: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 15 * 60;
  const header = { alg: "HS256", kid: config.appKey, typ: "JWT" };
  const payload = {
    exp: expiresAt,
    iat: now,
    jti: `demo-${clientId}-${String(now)}`,
    "x-sockudo-client-id": clientId,
    "x-sockudo-capability": {
      [config.channelName]: ["publish", "subscribe", "history", "presence"],
    },
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", config.appSecret)
    .update(unsigned)
    .digest("base64url");
  return { token: `${unsigned}.${signature}`, expiresAt };
}

export async function proxyVersionedMessage(body: Record<string, unknown>): Promise<Response> {
  const channel = requireString(body.channel, "channel");
  if (channel !== config.channelName) {
    return Response.json({ error: "unexpected channel" }, { status: 400 });
  }
  if (body.action === "publish_create") {
    const payload = await signedSockudoRequest("POST", `/apps/${config.appId}/events`, {
      name: stringOr(body.name, "sockudo:message.create"),
      channel,
      data: encodeData(body.data),
      extras: body.extras,
      message_id: stringOr(body.messageId, crypto.randomUUID()),
      client_id: optionalString(body.clientId),
      socket_id: optionalString(body.socketId),
      op_id: optionalString(body.opId),
    });
    return Response.json(normalizeAck(payload, optionalString(body.messageSerial)));
  }
  if (
    body.action === "message_append" ||
    body.action === "message_update" ||
    body.action === "message_delete"
  ) {
    const messageSerial = requireString(body.messageSerial, "messageSerial");
    const action =
      body.action === "message_append"
        ? "append"
        : body.action === "message_update"
          ? "update"
          : "delete";
    const payload = await signedSockudoRequest(
      "POST",
      `/apps/${config.appId}/channels/${encodeURIComponent(channel)}/messages/${encodeURIComponent(messageSerial)}/${action}`,
      {
        data: body.data ?? "",
        name: optionalString(body.name),
        extras: body.extras,
        client_id: optionalString(body.clientId),
        socket_id: optionalString(body.socketId),
        op_id: optionalString(body.opId),
      },
    );
    return Response.json(normalizeAck(payload, messageSerial));
  }
  if (body.action === "channel_history") {
    const params = new URLSearchParams(
      Object.entries((body.params as Record<string, string> | undefined) ?? {}),
    );
    const query = params.toString();
    const payload = await signedSockudoRequest(
      "GET",
      `/apps/${config.appId}/channels/${encodeURIComponent(channel)}/history${query ? `?${query}` : ""}`,
    );
    return Response.json(payload);
  }
  return Response.json({ error: "unsupported action" }, { status: 400 });
}

async function signedSockudoRequest(
  method: "GET" | "POST",
  pathWithQuery: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const rawBody = body === undefined ? undefined : JSON.stringify(stripUndefined(body));
  const url = new URL(`http://${config.host}:${String(config.port)}${pathWithQuery}`);
  const path = url.pathname;
  const params = Object.fromEntries(url.searchParams.entries());
  params.auth_key = config.appKey;
  params.auth_timestamp = String(Math.floor(Date.now() / 1000));
  params.auth_version = "1.0";
  if (rawBody !== undefined) {
    params.body_md5 = createHash("md5").update(rawBody).digest("hex");
  }
  const sorted = new URLSearchParams(
    Object.entries(params).sort(([left], [right]) => left.localeCompare(right)),
  ).toString();
  const signature = createHmac("sha256", config.appSecret)
    .update([method, path, sorted].join("\n"))
    .digest("hex");
  url.search = `${sorted}&auth_signature=${signature}`;
  const init: RequestInit = { method };
  if (rawBody !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = rawBody;
  }
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    throw new Error(`Sockudo request failed: ${text}`);
  }
  return payload;
}

function normalizeAck(payload: unknown, fallback?: string): Record<string, unknown> {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const channels = record.channels as Record<string, unknown> | undefined;
  const first = channels === undefined ? record : Object.values(channels)[0];
  const ack = first && typeof first === "object" ? (first as Record<string, unknown>) : record;
  return {
    messageSerial: stringOr(ack.message_serial ?? ack.messageSerial, fallback ?? "msg-demo"),
    historySerial: Number(ack.history_serial ?? ack.historySerial ?? 1),
    deliverySerial: ack.delivery_serial ?? ack.deliverySerial,
    versionSerial: ack.version_serial ?? ack.versionSerial,
  };
}

function encodeData(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${field}`);
  }
  return value;
}

function stripUndefined(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}
