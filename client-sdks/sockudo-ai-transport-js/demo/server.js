import { createServer as createHttpServer } from "node:http";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  convertToModelMessages,
  jsonSchema,
  stepCountIs,
  streamText,
  tool,
} from "ai";
import { createServer as createViteServer } from "vite";
import { adaptSockudoClient } from "@sockudo/ai-transport";
import {
  OPENAI_COMPATIBLE_PROVIDER_BASE_URLS,
  createOpenAICompatibleProvider,
  runDirectLlmTurn,
} from "@sockudo/ai-transport/providers";
import {
  createServerTransport,
  vercelTurnEndReason,
} from "@sockudo/ai-transport/vercel";
import Sockudo, {
  getMutableMessageInfo,
} from "../../client-sdks/sockudo-js/dist/node/sockudo.js";

const rootDir = dirname(fileURLToPath(import.meta.url));
const sockudoRoot = resolve(rootDir, "../..");
await loadEnv(resolve(sockudoRoot, ".env"));

if (!process.env.AI_GATEWAY_API_KEY && process.env.VERCEL_API_KEY) {
  process.env.AI_GATEWAY_API_KEY = process.env.VERCEL_API_KEY;
}

const config = {
  appId: process.env.SOCKUDO_APP_ID ?? "app-id",
  appKey: process.env.SOCKUDO_APP_KEY ?? "app-key",
  appSecret: process.env.SOCKUDO_APP_SECRET ?? "app-secret",
  channelName: process.env.SOCKUDO_CHANNEL_NAME ?? "private-ai-demo-final",
  host: process.env.SOCKUDO_HOST ?? "127.0.0.1",
  port: Number(process.env.SOCKUDO_PORT ?? "6001"),
  provider: process.env.SOCKUDO_DEMO_PROVIDER,
  providerBaseUrl: process.env.SOCKUDO_DEMO_BASE_URL,
  providerApiKey: process.env.SOCKUDO_DEMO_API_KEY,
  model:
    process.env.SOCKUDO_DEMO_MODEL ??
    (process.env.SOCKUDO_DEMO_PROVIDER === "ollama"
      ? "qwen:latest"
      : "openai/gpt-4.1-mini"),
};
let publishCounter = 0;
const directProvider = createDemoDirectProvider();

const demoTools = {
  demoApproval: tool({
    description:
      "Returns a deterministic approval-gated result for the Sockudo AI Transport demo.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "The short topic to approve.",
        },
      },
      required: ["topic"],
      additionalProperties: false,
    }),
    needsApproval: true,
    execute: ({ topic }) => ({
      approved: true,
      topic: typeof topic === "string" ? topic : "demo transport check",
      result:
        "Approved demo tool output delivered through Sockudo AI Transport.",
    }),
  }),
};

const vite = await createViteServer({
  root: rootDir,
  configFile: resolve(rootDir, "vite.config.ts"),
  server: { middlewareMode: true },
  appType: "spa",
});

const realtimeClient = adaptSockudoClient(
  new Sockudo(config.appKey, {
    cluster: "local",
    forceTLS: false,
    enabledTransports: ["ws"],
    wsHost: config.host,
    wsPort: config.port,
    wssPort: config.port,
    protocolVersion: 2,
    channelAuthorization: {
      transport: "fetch",
      endpoint: "http://127.0.0.1:5173/api/channel-auth",
      customHandler(params, callback) {
        callback(null, channelAuth(params.socketId, params.channelName));
      },
    },
    versionedMessages: {
      endpoint: "http://127.0.0.1:5173/api/versioned-messages",
    },
  }),
  { mutableMessageInfoReader: getMutableMessageInfo },
);

const serverTransport = createServerTransport({
  client: realtimeClient,
  channelName: config.channelName,
  onError(error) {
    console.error("[sockudo-ai-demo] server transport error", {
      code: error.code,
      statusCode: error.statusCode,
      message: error.message,
    });
  },
});

const server = createHttpServer(async (request, response) => {
  try {
    if (request.url === "/api/config" && request.method === "GET") {
      sendJson(response, 200, {
        appKey: config.appKey,
        channelName: config.channelName,
        host: config.host,
        port: config.port,
        model: config.model,
      });
      return;
    }

    if (request.url === "/api/channel-auth" && request.method === "POST") {
      await handleChannelAuth(request, response);
      return;
    }

    if (
      request.url === "/api/versioned-messages" &&
      request.method === "POST"
    ) {
      await handleVersionedMessages(request, response);
      return;
    }

    if (request.url === "/api/chat" && request.method === "POST") {
      await handleChat(request, response);
      return;
    }

    vite.middlewares(request, response, (error) => {
      if (error) {
        vite.ssrFixStacktrace(error);
        console.error("[sockudo-ai-demo] vite middleware error", {
          message: error instanceof Error ? error.message : String(error),
        });
        response.statusCode = 500;
        response.end("internal server error");
      }
    });
  } catch (error) {
    console.error("[sockudo-ai-demo] request failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    if (!response.headersSent) {
      response.statusCode = 500;
      response.end("internal server error");
    }
  }
});

server.listen(5173, "127.0.0.1", () => {
  console.log("[sockudo-ai-demo] ready at http://127.0.0.1:5173");
  console.log("[sockudo-ai-demo] sockudo ws target", {
    host: config.host,
    port: config.port,
    channelName: config.channelName,
    model: config.model,
    provider: config.provider ?? "vercel-ai-gateway",
  });
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function handleChat(request, response) {
  const body = await readJson(request);
  if (!body.turnId || !body.invocationId || !body.inputEventId) {
    sendJson(response, 400, { error: "missing Sockudo AI turn metadata" });
    return;
  }

  const turn = serverTransport.newTurn({
    turnId: body.turnId,
    invocationId: body.invocationId,
    inputEventId: body.inputEventId,
    clientId: typeof body.clientId === "string" ? body.clientId : undefined,
    parent: typeof body.parent === "string" ? body.parent : undefined,
    forkOf: typeof body.forkOf === "string" ? body.forkOf : undefined,
    onAbort: async (write) => {
      await write({ type: "abort" });
    },
    onError(error) {
      console.error("[sockudo-ai-demo] turn error", {
        code: error.code,
        statusCode: error.statusCode,
        message: error.message,
      });
    },
  });

  response.statusCode = 202;
  response.end("accepted");

  void runTurn(turn, body).catch((error) => {
    console.error("[sockudo-ai-demo] turn failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

async function runTurn(turn, body) {
  if (directProvider) {
    const messages = normalizeMessages(body);
    await runDirectLlmTurn(turn, directProvider, {
      model: config.model,
      messages: toOpenAICompatibleMessages(messages),
      prompt: latestUserText(messages),
      maxOutputTokens: 80,
      temperature: 0,
    });
    return;
  }

  await turn.start();

  const useDemoTools = body.demoAction === "tool-approval";
  const messages = normalizeMessages(body, { preserveTools: useDemoTools });
  const modelMessages = await convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
    ...(useDemoTools ? { tools: demoTools } : {}),
  });
  const awaitingApproval = useDemoTools && !hasDemoToolApproval(messages);
  const result = streamText({
    model: config.model,
    system: useDemoTools
      ? "You are a concise assistant used to verify Sockudo AI Transport tool approval. First call the demoApproval tool with topic 'demo transport check'. After the approved tool output is available, answer in one short sentence that includes the tool result."
      : "You are a concise assistant used to verify Sockudo AI Transport realtime streaming. Answer the user's latest request directly in one or two short sentences. Do not repeat phrases, restate the transport name unless asked, or continue after the answer is complete.",
    messages: modelMessages,
    ...(useDemoTools
      ? {
          tools: demoTools,
          toolChoice: awaitingApproval
            ? { type: "tool", toolName: "demoApproval" }
            : "auto",
          stopWhen: stepCountIs(3),
        }
      : {}),
    maxOutputTokens: 80,
    temperature: 0,
  });
  const uiStream = result.toUIMessageStream({
    originalMessages: messages,
  });
  const pipeResult = await turn.streamResponse(uiStream);
  const reason = await vercelTurnEndReason(pipeResult, result.finishReason);
  await turn.end(reason);
}

function createDemoDirectProvider() {
  if (!config.provider && !config.providerBaseUrl) {
    return undefined;
  }
  const options = {
    provider: config.provider ?? "openai",
    model: config.model,
  };
  if (config.providerBaseUrl) {
    options.baseURL = config.providerBaseUrl;
  }
  if (config.providerApiKey) {
    options.apiKey = config.providerApiKey;
  }
  if (!(options.provider in OPENAI_COMPATIBLE_PROVIDER_BASE_URLS)) {
    throw new Error(`unsupported SOCKUDO_DEMO_PROVIDER: ${options.provider}`);
  }
  return createOpenAICompatibleProvider(options);
}

function toOpenAICompatibleMessages(messages) {
  const items = messages
    .map((message) => ({
      role: message.role,
      content: message.parts
        .map((part) => (part.type === "text" ? part.text : ""))
        .filter(Boolean)
        .join("\n"),
    }))
    .filter((message) => message.content.length > 0);
  return [
    {
      role: "system",
      content:
        "You are a test assistant for a realtime AI transport demo. Follow the user's latest instruction directly. Do not introduce yourself, do not ask how you can help, and do not write customer-support greetings.",
    },
    ...items,
  ];
}

function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") {
      continue;
    }
    const text = message.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }
  return "Reply with exactly: Ollama is connected through Sockudo AI Transport.";
}

function hasDemoToolApproval(messages) {
  return messages.some((message) =>
    message.parts.some((part) => {
      if (!part || typeof part !== "object") {
        return false;
      }
      if (
        part.toolName !== "demoApproval" &&
        !String(part.type).endsWith("demoApproval")
      ) {
        return false;
      }
      const approval = part.approval;
      return (
        approval !== null &&
        typeof approval === "object" &&
        typeof approval.approved === "boolean"
      );
    }),
  );
}

async function handleVersionedMessages(request, response) {
  const body = await readJson(request);
  const channel = requireString(body.channel, "channel");
  if (channel !== config.channelName) {
    sendJson(response, 400, { error: "unexpected channel" });
    return;
  }

  switch (body.action) {
    case "publish_create": {
      const sockudoResponse = await sockudoRequest(
        "POST",
        `/apps/${config.appId}/events`,
        {
          name: body.name ?? "sockudo:message.create",
          channel,
          data: encodePublishData(body.data),
          extras: normalizeExtras(body.extras),
          message_id: nextPublishId(requireString(body.messageId, "messageId")),
          client_id: optionalString(body.clientId),
          socket_id: optionalString(body.socketId),
          op_id: optionalString(body.opId),
        },
      );
      sendJson(
        response,
        200,
        normalizeAck(sockudoResponse, body.messageSerial),
      );
      return;
    }
    case "message_append": {
      const messageSerial = requireString(body.messageSerial, "messageSerial");
      const sockudoResponse = await sockudoRequest(
        "POST",
        `/apps/${config.appId}/channels/${encodeURIComponent(channel)}/messages/${encodeURIComponent(messageSerial)}/${
          body.data === "" || body.data === null || body.data === undefined
            ? "update"
            : "append"
        }`,
        mutationBody(body),
      );
      sendJson(response, 200, normalizeAck(sockudoResponse, messageSerial));
      return;
    }
    case "message_update": {
      const messageSerial = requireString(body.messageSerial, "messageSerial");
      const sockudoResponse = await sockudoRequest(
        "POST",
        `/apps/${config.appId}/channels/${encodeURIComponent(channel)}/messages/${encodeURIComponent(messageSerial)}/update`,
        mutationBody(body),
      );
      sendJson(response, 200, normalizeAck(sockudoResponse, messageSerial));
      return;
    }
    case "message_delete": {
      const messageSerial = requireString(body.messageSerial, "messageSerial");
      const sockudoResponse = await sockudoRequest(
        "POST",
        `/apps/${config.appId}/channels/${encodeURIComponent(channel)}/messages/${encodeURIComponent(messageSerial)}/delete`,
        mutationBody(body),
      );
      sendJson(response, 200, normalizeAck(sockudoResponse, messageSerial));
      return;
    }
    case "channel_history": {
      const query = queryString(body.params ?? {});
      const sockudoResponse = await sockudoRequest(
        "GET",
        `/apps/${config.appId}/channels/${encodeURIComponent(channel)}/history${
          query ? `?${query}` : ""
        }`,
      );
      sendJson(response, 200, sockudoResponse);
      return;
    }
    default:
      sendJson(response, 400, {
        error: "unsupported versioned-message action",
      });
  }
}

async function handleChannelAuth(request, response) {
  const body = await readText(request);
  const params = new URLSearchParams(body);
  const socketId = params.get("socket_id");
  const channelName = params.get("channel_name");
  if (!socketId || !channelName || channelName !== config.channelName) {
    sendJson(response, 403, { error: "channel authorization denied" });
    return;
  }
  sendJson(response, 200, channelAuth(socketId, channelName));
}

function channelAuth(socketId, channelName) {
  const signature = createHmac("sha256", config.appSecret)
    .update(`${socketId}:${channelName}`)
    .digest("hex");
  return { auth: `${config.appKey}:${signature}` };
}

function normalizeMessages(body, options = {}) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const includeHistory = process.env.SOCKUDO_DEMO_INCLUDE_HISTORY !== "false";
  const history =
    includeHistory && Array.isArray(body.history) ? body.history : [];
  return [...history, ...messages]
    .filter(isUiMessage)
    .map((message) => sanitizeUiMessage(message, options))
    .filter(Boolean)
    .slice(-12);
}

function isUiMessage(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.role === "string" &&
    Array.isArray(value.parts)
  );
}

function sanitizeUiMessage(message, options) {
  if (message.role !== "user" && message.role !== "assistant") {
    return undefined;
  }
  const parts = message.parts
    .map((part) => sanitizePart(part, message.role, options))
    .filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }
  return {
    id: typeof message.id === "string" ? message.id : undefined,
    role: message.role,
    parts,
  };
}

function sanitizePart(part, role, options) {
  if (!part || typeof part !== "object" || part.type !== "text") {
    return options.preserveTools && role === "assistant"
      ? sanitizeToolPart(part)
      : undefined;
  }
  const text = typeof part.text === "string" ? part.text.trim() : "";
  if (!text) {
    return undefined;
  }
  return {
    type: "text",
    text: clampText(role === "assistant" ? squashRepeatedLines(text) : text),
  };
}

function sanitizeToolPart(part) {
  if (!part || typeof part !== "object") {
    return undefined;
  }
  const type = typeof part.type === "string" ? part.type : "";
  if (type !== "dynamic-tool" && !type.startsWith("tool-")) {
    return undefined;
  }
  const toolName =
    typeof part.toolName === "string"
      ? part.toolName
      : type.startsWith("tool-")
        ? type.slice("tool-".length)
        : undefined;
  const toolCallId =
    typeof part.toolCallId === "string" ? part.toolCallId : undefined;
  const state = typeof part.state === "string" ? part.state : undefined;
  if (!toolCallId || !isAllowedToolState(state)) {
    return undefined;
  }
  return compact({
    type,
    toolName,
    toolCallId,
    state,
    input: part.input,
    output: part.output,
    errorText:
      typeof part.errorText === "string"
        ? clampText(part.errorText)
        : undefined,
    approval: sanitizeApproval(part.approval),
  });
}

function sanitizeApproval(approval) {
  if (!approval || typeof approval !== "object") {
    return undefined;
  }
  const id =
    typeof approval.id === "string"
      ? approval.id
      : typeof approval.approvalId === "string"
        ? approval.approvalId
        : undefined;
  return compact({
    id,
    approvalId:
      typeof approval.approvalId === "string" ? approval.approvalId : id,
    approved:
      typeof approval.approved === "boolean" ? approval.approved : undefined,
    reason:
      typeof approval.reason === "string"
        ? clampText(approval.reason)
        : undefined,
  });
}

function isAllowedToolState(state) {
  return (
    state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-requested" ||
    state === "approval-responded" ||
    state === "output-available" ||
    state === "output-error" ||
    state === "output-denied"
  );
}

function squashRepeatedLines(text) {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const compacted = [];
  for (const line of lines) {
    if (compacted.at(-1) !== line) {
      compacted.push(line);
    }
  }
  return compacted.join("\n");
}

function clampText(text) {
  return text.length <= 1600 ? text : `${text.slice(0, 1600)}...`;
}

async function readJson(request) {
  const raw = await readText(request);
  if (raw.length === 0) {
    return {};
  }
  return JSON.parse(raw);
}

async function readText(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function sockudoRequest(method, pathWithQuery, body) {
  const rawBody =
    body === undefined ? undefined : JSON.stringify(compact(body));
  const url = new URL(
    `http://${config.host}:${String(config.port)}${pathWithQuery}`,
  );
  const path = url.pathname;
  const params = Object.fromEntries(url.searchParams.entries());
  params.auth_key = config.appKey;
  params.auth_timestamp = String(Math.floor(Date.now() / 1000));
  params.auth_version = "1.0";
  if (rawBody !== undefined) {
    params.body_md5 = createHash("md5").update(rawBody).digest("hex");
  }
  const sortedQuery = new URLSearchParams(
    Object.entries(params).sort(([left], [right]) => left.localeCompare(right)),
  ).toString();
  const stringToSign = [method, path, sortedQuery].join("\n");
  const signature = createHmac("sha256", config.appSecret)
    .update(stringToSign)
    .digest("hex");
  url.search = `${sortedQuery}&auth_signature=${signature}`;

  const requestOptions = {
    method,
    headers:
      rawBody === undefined
        ? undefined
        : { "Content-Type": "application/json" },
  };
  if (rawBody !== undefined) {
    requestOptions.body = rawBody;
  }
  const sockudoResponse = await fetch(url, requestOptions);
  const text = await sockudoResponse.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text };
  }
  if (!sockudoResponse.ok) {
    const error = new Error(
      payload.message ?? payload.error ?? "Sockudo request failed",
    );
    error.statusCode = sockudoResponse.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function mutationBody(body) {
  return compact({
    ...(body.data !== undefined ? { data: body.data } : {}),
    name: body.name,
    extras: normalizeExtras(body.extras),
    clear_fields: body.clearFields,
    client_id: body.clientId,
    socket_id: body.socketId,
    description: body.description,
    metadata: body.metadata,
    op_id: body.opId,
  });
}

function normalizeExtras(extras) {
  if (!extras || typeof extras !== "object") {
    return extras;
  }
  const root = { ...extras };
  if (!root.ai || typeof root.ai !== "object") {
    return root;
  }
  const ai = { ...root.ai };
  if (ai.codec && typeof ai.codec === "object") {
    ai.codec = Object.fromEntries(
      Object.entries(ai.codec).map(([key, value]) => [toKebabCase(key), value]),
    );
  }
  root.ai = ai;
  return root;
}

function encodePublishData(data) {
  if (typeof data === "string") {
    return data;
  }
  return JSON.stringify(data ?? null);
}

function nextPublishId(base) {
  publishCounter += 1;
  return `${base}:${Date.now().toString(36)}:${publishCounter.toString(36)}`;
}

function normalizeAck(payload, fallbackMessageSerial) {
  const ack =
    payload.channels && typeof payload.channels === "object"
      ? payload.channels[config.channelName]
      : payload;
  if (!ack || typeof ack !== "object") {
    return {
      messageSerial: fallbackMessageSerial,
    };
  }
  return {
    messageSerial:
      ack.message_serial ?? ack.messageSerial ?? fallbackMessageSerial,
    historySerial: ack.history_serial ?? ack.historySerial,
    deliverySerial: ack.delivery_serial ?? ack.deliverySerial,
    versionSerial: ack.version_serial ?? ack.versionSerial,
    status: ack.status,
  };
}

function requireString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      search.set(toSnakeCase(key), String(value));
    }
  }
  return search.toString();
}

function toSnakeCase(value) {
  return value.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
}

function toKebabCase(value) {
  return value.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

async function loadEnv(path) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^['"]|['"]$/gu, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function shutdown() {
  serverTransport.close();
  realtimeClient.close();
  server.close(() => {
    void vite.close().then(() => process.exit(0));
  });
}
