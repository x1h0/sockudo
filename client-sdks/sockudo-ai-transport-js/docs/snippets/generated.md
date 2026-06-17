# Generated Demo Snippets

Do not edit by hand. Run `pnpm docs:snippets:update` after changing demo snippet markers.

<!-- prettier-ignore-start -->

## core-branch-views

Source: `demo/nextjs-core-sdk/app/page.tsx`

<!-- snippet:core-branch-views -->

```tsx
  const branchPanes = [left, right] as const;
```

## core-route

Source: `demo/nextjs-core-sdk/app/api/chat/route.ts`

<!-- snippet:core-route -->

```ts
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
```

## node-agent-poke

Source: `demo/node-agent/src/server.mjs`

<!-- snippet:node-agent-poke -->

```ts
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
```

## node-agent-suspended

Source: `demo/node-agent/src/server.mjs`

<!-- snippet:node-agent-suspended -->

```ts
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
```

## usechat-route

Source: `demo/nextjs-usechat/app/api/chat/route.ts`

<!-- snippet:usechat-route -->

```ts
  after(async () => {
    await turn.start();
    const result = streamText({
      model: process.env.SOCKUDO_DEMO_MODEL ?? "openai/gpt-4.1-mini",
      prompt: latestText(body),
      maxOutputTokens: 160,
    });
    const uiStream = result.toUIMessageStream() as unknown as Parameters<
      typeof turn.streamResponse
    >[0];
    const pipe = await turn.streamResponse(uiStream);
    await turn.end(await vercelTurnEndReason(pipe, Promise.resolve(result.finishReason)));
  });
```

## usechat-sync

Source: `demo/nextjs-usechat/app/page.tsx`

<!-- snippet:usechat-sync -->

```tsx
  useMessageSync({
    setMessages: chat.setMessages as unknown as Parameters<
      typeof useMessageSync
    >[0]["setMessages"],
  });
```

<!-- prettier-ignore-end -->
