import { after } from "next/server";
import { streamText } from "ai";
import { createServerTransport } from "@sockudo/ai-transport";
import { UIMessageCodec } from "@sockudo/ai-transport/vercel";
import { config, realtimeClient } from "../_lib/sockudo";

const transport = createServerTransport({
  client: realtimeClient(),
  channelName: config.channelName,
  codec: UIMessageCodec,
});

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;
  const clientId = optionalString(body.clientId);
  const turn = transport.newTurn({
    turnId: requireString(body, "turnId"),
    invocationId: requireString(body, "invocationId"),
    inputEventId: requireString(body, "inputEventId"),
    ...(clientId === undefined ? {} : { clientId }),
  });

  // @docs-snippet core-route
  after(async () => {
    await turn.start();
    const result = streamText({
      model: process.env.SOCKUDO_DEMO_MODEL ?? "openai/gpt-4.1-mini",
      prompt: latestText(body),
      maxOutputTokens: 140,
    });
    const uiStream = result.toUIMessageStream() as unknown as Parameters<
      typeof turn.streamResponse
    >[0];
    await turn.streamResponse(uiStream);
    await turn.end("complete");
  });
  // @docs-snippet-end

  return new Response(null, { status: 202 });
}

function latestText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages.at(-1);
  if (!last || typeof last !== "object") {
    return "Explain branch navigation in one sentence.";
  }
  const parts = (last as { parts?: unknown }).parts;
  return Array.isArray(parts)
    ? parts
        .map((part) =>
          part && typeof part === "object" && "text" in part
            ? String((part as { text?: unknown }).text ?? "")
            : "",
        )
        .join("")
    : "Explain branch navigation in one sentence.";
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${field}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
