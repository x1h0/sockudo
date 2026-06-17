# Standalone Node Agent Demo

This demo runs an Express agent process without Next.js. It accepts Sockudo AI Transport poke
requests at `POST /poke`, streams a deterministic fake LLM response, exposes `GET /status`, and
supports suspended human-in-the-loop continuation through `POST /approve/:turnId`.

Run from the repository root:

```bash
pnpm --filter @sockudo/ai-transport-demo-node-agent dev
```

Required Sockudo environment variables default to the local Docker values:

- `SOCKUDO_APP_KEY=demo-key`
- `SOCKUDO_CHANNEL_NAME=private-ai-node-agent`
- `SOCKUDO_HOST=127.0.0.1`
- `SOCKUDO_PORT=6001`
