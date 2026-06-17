# Sockudo AI Transport Demo

This demo runs a Vite React app plus a local `/api/chat` route backed by the Sockudo AI Transport
SDK and Vercel AI Gateway.

Prerequisites:

- Sockudo AI transport compose stack on `127.0.0.1:6001`
- `VERCEL_API_KEY` in `/Users/radudiaconu/Desktop/Code/Rust/sockudo/.env`

Run from the SDK repo root:

```bash
npx pnpm@10.17.0 --filter @sockudo/ai-transport-demo dev
```

Open `http://127.0.0.1:5173`. Open the same URL in a second tab to test multi-device realtime
synchronization.
