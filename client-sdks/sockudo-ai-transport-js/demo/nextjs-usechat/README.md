# Next.js useChat Demo

Vercel-path quickstart for `@sockudo/ai-transport/vercel/react`.

Run from the repository root:

```bash
make demo
```

Open `http://127.0.0.1:5174`. Open a second tab to verify tab-close resume and multi-device message
sync. The UI exposes a Stop button wired through Vercel `useChat.stop()` and Sockudo `ai-cancel`.
The chat route defaults to Ollama through `@sockudo/ai-transport/providers`:

```bash
ollama serve
ollama pull qwen:latest
SOCKUDO_DEMO_PROVIDER=ollama SOCKUDO_DEMO_MODEL=qwen:latest make demo
```

For another OpenAI-compatible endpoint, set `SOCKUDO_DEMO_PROVIDER`, `SOCKUDO_DEMO_MODEL`, and
optionally `SOCKUDO_DEMO_BASE_URL` / `SOCKUDO_DEMO_API_KEY`.

Local-only run against an already running Sockudo server:

```bash
make local-usechat
```

The app exposes:

- `POST /api/auth` for Sockudo capability JWTs.
- `POST /api/channel-auth` for private-channel HMAC auth.
- `POST /api/versioned-messages` for mutable create/append/update/history proxying.
- `POST /api/chat` for `createServerTransport`, direct provider streaming, and `after()`.
