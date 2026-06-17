import express from "express";
import Sockudo from "@sockudo/client";
import { adaptSockudoClient } from "@sockudo/ai-transport";
import { createServerTransport } from "@sockudo/ai-transport/vercel";

const config = {
  appKey: process.env.SOCKUDO_APP_KEY ?? "demo-key",
  channelName: process.env.SOCKUDO_CHANNEL_NAME ?? "private-ai-node-agent",
  host: process.env.SOCKUDO_HOST ?? "127.0.0.1",
  port: Number(process.env.SOCKUDO_PORT ?? "6001"),
  httpPort: Number(process.env.PORT ?? "5180"),
};

const realtime = adaptSockudoClient(
  new Sockudo(config.appKey, {
    cluster: "local",
    forceTLS: false,
    enabledTransports: ["ws"],
    wsHost: config.host,
    wsPort: config.port,
    wssPort: config.port,
    protocolVersion: 2,
  }),
);

const transport = createServerTransport({
  client: realtime,
  channelName: config.channelName,
});

const app = express();
app.use(express.json({ limit: "64kb" }));

let agentStatus = "idle";
const suspendedTurns = new Map();

app.get("/status", (_request, response) => {
  response.json({
    channelName: config.channelName,
    status: agentStatus,
    suspended: suspendedTurns.size,
  });
});

// @docs-snippet node-agent-poke
app.post("/poke", async (request, response) => {
  const body = request.body ?? {};
  const turn = transport.newTurn({
    turnId: requireString(body.turnId, "turnId"),
    invocationId: requireString(body.invocationId, "invocationId"),
    inputEventId: requireString(body.inputEventId, "inputEventId"),
    clientId: optionalString(body.clientId),
    onCancel(cancel) {
      return cancel.filter.all === true || cancel.turnOwners.get(turn.turnId) === body.clientId;
    },
  });

  response.status(202).json({ accepted: true, turnId: turn.turnId });
  void runFakeLlmTurn(turn, body).catch((error) => {
    console.error("[node-agent] turn failed", publicError(error));
  });
});
// @docs-snippet-end

app.post("/approve/:turnId", async (request, response) => {
  const suspended = suspendedTurns.get(request.params.turnId);
  if (!suspended) {
    response.status(404).json({ error: "turn not suspended" });
    return;
  }
  suspendedTurns.delete(request.params.turnId);
  await suspended.continue(request.body?.approved === true);
  response.json({ continued: true });
});

app.listen(config.httpPort, () => {
  console.log(`[node-agent] listening on http://127.0.0.1:${config.httpPort}`);
});

// @docs-snippet node-agent-suspended
async function runFakeLlmTurn(turn, body) {
  agentStatus = "thinking";
  await turn.start();
  if (body.requiresApproval === true) {
    suspendedTurns.set(turn.turnId, {
      continue: async (approved) => {
        agentStatus = "streaming";
        await turn.addMessages([
          {
            message: assistantMessage(
              approved
                ? "Approved human-in-the-loop action completed."
                : "The requested action was denied by a reviewer.",
            ),
          },
        ]);
        await turn.end("complete");
        agentStatus = "idle";
      },
    });
    await turn.end("suspended");
    agentStatus = "idle";
    return;
  }
  agentStatus = "streaming";
  await turn.streamResponse(fakeTokenStream("Standalone Node agent response."));
  await turn.end("complete");
  agentStatus = "idle";
}
// @docs-snippet-end

function fakeTokenStream(text) {
  const tokens = text.split(" ");
  return new ReadableStream({
    async start(controller) {
      for (const token of tokens) {
        controller.enqueue({
          type: "text-delta",
          id: "fake-response",
          delta: `${token} `,
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      controller.enqueue({
        type: "finish",
        id: "fake-response",
      });
      controller.close();
    },
  });
}

function assistantMessage(text) {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [{ type: "text", text }],
  };
}

function requireString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing ${field}`);
  }
  return value;
}

function optionalString(value) {
  return typeof value === "string" ? value : undefined;
}

function publicError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    code: error?.code,
    statusCode: error?.statusCode,
  };
}
