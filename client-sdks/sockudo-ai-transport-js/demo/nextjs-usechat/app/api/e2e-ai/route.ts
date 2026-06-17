import { after } from "next/server";
import { isAllowedDemoChannel, proxyVersionedMessage } from "../_lib/sockudo";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;
  const channelName = requireString(body.sessionName, "sessionName");
  if (!isAllowedDemoChannel(channelName)) {
    return Response.json({ error: "unexpected channel" }, { status: 400 });
  }
  const turnId = requireString(body.turnId, "turnId");
  const invocationId = requireString(body.invocationId, "invocationId");
  const inputEventId = requireString(body.inputEventId, "inputEventId");
  const clientId = optionalString(body.clientId);
  const parent = optionalString(body.parent);
  const forkOf = optionalString(body.forkOf);
  const scenario = optionalString(body.scenario) ?? "normal";

  after(async () => {
    await runDeterministicTurn({
      channelName,
      turnId,
      invocationId,
      inputEventId,
      scenario,
      ...(clientId === undefined ? {} : { clientId }),
      ...(parent === undefined ? {} : { parent }),
      ...(forkOf === undefined ? {} : { forkOf }),
    });
  });

  return new Response(null, { status: 202 });
}

interface DeterministicTurn {
  channelName: string;
  turnId: string;
  invocationId: string;
  inputEventId: string;
  clientId?: string;
  parent?: string;
  forkOf?: string;
  scenario: string;
}

async function runDeterministicTurn(turn: DeterministicTurn): Promise<void> {
  await publish(turn.channelName, "ai-turn-start", "", {
    ...baseHeaders(turn, "assistant"),
    "x-sockudo-event-id": turn.inputEventId,
  });
  const messageId = `assistant-${turn.turnId}`;
  await publish(turn.channelName, "ai-output", { type: "start", messageId }, {
    ...baseHeaders(turn, "assistant"),
    "x-sockudo-codec-message-id": messageId,
    "x-sockudo-codec-type": "start",
  });
  const create = await publish(turn.channelName, "ai-output", "", {
    ...baseHeaders(turn, "assistant"),
    "x-sockudo-codec-message-id": messageId,
    "x-sockudo-codec-type": "text-start",
    "x-sockudo-codec-id": "text",
    "x-sockudo-stream": "true",
    "x-sockudo-stream-id": `text:${messageId}:text`,
    "x-sockudo-status": "streaming",
  });
  const text =
    turn.scenario === "slow" ? "Slow cancellation target" : "Echo: browser normal";
  let accumulated = "";
  for (const word of text.split(" ")) {
    const delta = `${accumulated.length === 0 ? "" : " "}${word}`;
    accumulated += delta;
    await mutate(turn.channelName, create.messageSerial, "message_append", delta, {
      ...baseHeaders(turn, "assistant"),
      "x-sockudo-codec-message-id": messageId,
      "x-sockudo-codec-type": "text-delta",
      "x-sockudo-codec-id": "text",
      "x-sockudo-stream": "true",
      "x-sockudo-stream-id": `text:${messageId}:text`,
      "x-sockudo-status": "streaming",
    });
    await sleep(turn.scenario === "slow" ? 80 : 5);
    if (await hasCancel(turn.channelName, turn.turnId)) {
      await finishStream(turn, create.messageSerial, messageId, accumulated, "cancelled");
      await publishTurnEnd(turn, "cancelled");
      return;
    }
  }
  await finishStream(turn, create.messageSerial, messageId, accumulated, "complete");
  await publish(turn.channelName, "ai-output", { type: "finish", finishReason: "stop" }, {
    ...baseHeaders(turn, "assistant"),
    "x-sockudo-codec-message-id": messageId,
    "x-sockudo-codec-type": "finish",
    "x-sockudo-codec-finish-reason": "stop",
  });
  await publishTurnEnd(turn, "complete");
}

async function finishStream(
  turn: DeterministicTurn,
  messageSerial: string,
  messageId: string,
  accumulated: string,
  status: "complete" | "cancelled",
): Promise<void> {
  await mutate(turn.channelName, messageSerial, "message_update", accumulated, {
    ...baseHeaders(turn, "assistant"),
    "x-sockudo-codec-message-id": messageId,
    "x-sockudo-codec-type": "text-end",
    "x-sockudo-codec-id": "text",
    "x-sockudo-stream": "true",
    "x-sockudo-stream-id": `text:${messageId}:text`,
    "x-sockudo-status": status,
  });
}

function publishTurnEnd(
  turn: DeterministicTurn,
  reason: "complete" | "cancelled",
): Promise<MessageAck> {
  return publish(turn.channelName, "ai-turn-end", "", {
    ...baseHeaders(turn, "assistant"),
    "x-sockudo-turn-reason": reason,
  });
}

async function hasCancel(channelName: string, turnId: string): Promise<boolean> {
  const history = await proxy<{
    items?: { message?: { data?: unknown; name?: string; extras?: unknown } }[];
  }>({
    action: "channel_history",
    channel: channelName,
    params: { direction: "newest_first", limit: "50" },
  });
  return (history.items ?? []).some((item) => {
    const message = item.message;
    if (message?.name !== "ai-cancel") {
      return false;
    }
    const data = record(parseJsonish(message.data));
    const extras = record(message.extras);
    const headers = record(extras.headers);
    const ai = record(record(extras.ai).transport);
    return (
      data.turnId === turnId ||
      headers["x-sockudo-turn-id"] === turnId ||
      headers["x-sockudo-turn"] === turnId ||
      ai["turn-id"] === turnId
    );
  });
}

async function publish(
  channel: string,
  name: string,
  data: unknown,
  headers: Record<string, string>,
): Promise<MessageAck> {
  const opId = crypto.randomUUID();
  const ack = await proxy<MessageAck>({
    action: "publish_create",
    channel,
    name,
    data,
    extras: { headers: { ...headers, "x-sockudo-e2e-op-id": opId } },
    messageId: crypto.randomUUID(),
  });
  return ack.messageSerial === "msg-demo"
    ? { messageSerial: await lookupMessageSerial(channel, opId) }
    : ack;
}

async function mutate(
  channel: string,
  messageSerial: string,
  action: "message_append" | "message_update",
  data: string,
  headers: Record<string, string>,
): Promise<MessageAck> {
  return proxy<MessageAck>({
    action,
    channel,
    messageSerial,
    name: "ai-output",
    data,
    extras: { headers },
  });
}

async function proxy<T>(body: Record<string, unknown>): Promise<T> {
  const response = await proxyVersionedMessage(body);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Sockudo proxy failed ${String(response.status)}: ${text}`);
  }
  return (text.length > 0 ? JSON.parse(text) : {}) as T;
}

async function lookupMessageSerial(
  channel: string,
  opId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const history = await proxy<{
      items?: {
        message?: { extras?: unknown; message_serial?: string };
      }[];
    }>({
      action: "channel_history",
      channel,
      params: { direction: "newest_first", limit: "50" },
    });
    const found = (history.items ?? []).find(
      (item) =>
        record(record(item.message?.extras).headers)["x-sockudo-e2e-op-id"] ===
        opId,
    )?.message?.message_serial;
    if (typeof found === "string" && found.length > 0) {
      return found;
    }
    await sleep(25);
  }
  throw new Error(`unable to resolve message serial for op ${opId}`);
}

function baseHeaders(
  turn: DeterministicTurn,
  role: "assistant" | "user",
): Record<string, string> {
  return stripUndefined({
    "x-sockudo-turn-id": turn.turnId,
    "x-sockudo-invocation-id": turn.invocationId,
    "x-sockudo-client-id": turn.clientId,
    "x-sockudo-input-client-id": turn.clientId,
    "x-sockudo-parent": turn.parent,
    "x-sockudo-fork-of": turn.forkOf,
    "x-sockudo-role": role,
  });
}

function stripUndefined(
  body: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(body).filter((entry): entry is [string, string] => {
      return entry[1] !== undefined;
    }),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${field}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

interface MessageAck {
  messageSerial: string;
}
