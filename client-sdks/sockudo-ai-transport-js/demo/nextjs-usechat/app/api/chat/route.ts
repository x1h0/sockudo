import { after } from "next/server";
import { createServerTransport } from "@sockudo/ai-transport/vercel";
import {
  OPENAI_COMPATIBLE_PROVIDER_BASE_URLS,
  createOpenAICompatibleProvider,
  runDirectLlmTurn,
  type OpenAICompatibleProviderName,
} from "@sockudo/ai-transport/providers";
import { config } from "../_lib/config";
import { realtimeClient } from "../_lib/sockudo";

const transport = createServerTransport({
  client: realtimeClient(),
  channelName: config.channelName,
});
const provider = createOpenAICompatibleProvider(providerDefaults());

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;
  const turnId = requireString(body.turnId, "turnId");
  const invocationId = requireString(body.invocationId, "invocationId");
  const inputEventId = requireString(body.inputEventId, "inputEventId");
  const clientId = optionalString(body.clientId);
  const turn = transport.newTurn({
    turnId,
    invocationId,
    inputEventId,
    ...(clientId === undefined ? {} : { clientId }),
    onCancel(request) {
      return (
        request.filter.all === true ||
        request.turnOwners.get(turnId) === clientId
      );
    },
  });

  // @docs-snippet usechat-route
  after(async () => {
    await runDirectLlmTurn(turn, provider, {
      model: demoModel(),
      prompt: latestText(body),
      maxOutputTokens: 160,
    });
  });
  // @docs-snippet-end

  return new Response(null, { status: 202 });
}

function providerDefaults(): Parameters<typeof createOpenAICompatibleProvider>[0] {
  const defaults: Parameters<typeof createOpenAICompatibleProvider>[0] = {
    provider: demoProvider(),
    model: demoModel(),
  };
  if (process.env.SOCKUDO_DEMO_BASE_URL) {
    defaults.baseURL = process.env.SOCKUDO_DEMO_BASE_URL;
  }
  if (process.env.SOCKUDO_DEMO_API_KEY) {
    defaults.apiKey = process.env.SOCKUDO_DEMO_API_KEY;
  }
  return defaults;
}

function demoProvider(): OpenAICompatibleProviderName {
  const value = process.env.SOCKUDO_DEMO_PROVIDER ?? "ollama";
  if (value in OPENAI_COMPATIBLE_PROVIDER_BASE_URLS) {
    return value as OpenAICompatibleProviderName;
  }
  throw new Error(`unsupported SOCKUDO_DEMO_PROVIDER: ${value}`);
}

function demoModel(): string {
  return process.env.SOCKUDO_DEMO_MODEL ?? "qwen:latest";
}

function latestText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages.at(-1);
  if (!last || typeof last !== "object") {
    return "Say hello over Sockudo AI Transport.";
  }
  const parts = (last as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) {
    return "Say hello over Sockudo AI Transport.";
  }
  return parts
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text?: unknown }).text ?? "")
        : "",
    )
    .join("")
    .trim();
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${field}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
