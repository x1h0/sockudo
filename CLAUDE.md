# CLAUDE.md

This file gives coding agents a compact, code-oriented map of the Sockudo monorepo. Trust the code
over this file if they drift.

## Project Overview

Sockudo is a self-hosted realtime platform:

- Protocol V1 stays strictly Pusher-compatible.
- Protocol V2 adds Sockudo-native serials, message IDs, recovery, durable history, mutable
  messages, annotations, tag filtering, delta compression, presence history, capability-token auth,
  push, and optional AI Transport.
- Official client SDKs, HTTP/server SDKs, docs, dashboard, Helm, Compose, and operational tooling
  now live in this repository.

AI Transport is additive. Build it with Cargo feature `ai-transport`, enable it at runtime with
`[ai_transport] enabled = true`, and extend the existing versioned-message, history, recovery,
annotation, push, and presence subsystems. Do not build parallel AI-only storage or fanout paths.

## Top-Level Layout

```text
crates/              Rust server workspace
benches/ai/          Criterion AI hot-path benchmarks
client-sdks/         Realtime client SDKs and @sockudo/ai-transport
server-sdks/         HTTP/server SDKs
dashboard/           Operator API and Vue UI
docs/                Documentation site
config/              Local config examples
ops/                 Migrations and operational assets
charts/              Helm chart
tests/               Conformance, dashboard, load, and binary fixtures
tools/               Probes, chaos tooling, and support utilities
```

## Rust Workspace

The root Cargo workspace owns the server crates and `benches/ai`. Independently released SDK crates
under `server-sdks/` are excluded from the workspace.

```text
crates/
  sockudo-protocol        protocol messages, V1/V2 prefixes, extras, wire payloads
  sockudo-filter          tag filter parsing and matching
  sockudo-core            traits, config, auth, history, version store, errors
  sockudo-app             app-manager backends
  sockudo-cache           cache backends
  sockudo-queue           queue backends
  sockudo-rate-limiter    rate limiters and Tower middleware
  sockudo-metrics         Prometheus metrics driver
  sockudo-webhook         webhook delivery
  sockudo-delta           delta compression runtime
  sockudo-push            push storage, queues, providers, feedback, scheduler
  sockudo-ai-transport    AI Transport validation, rollup, conformance helpers
  sockudo-adapter         connections, subscriptions, presence, fanout, recovery
  sockudo-server          binary, HTTP/WS routes, bootstrap, durable stores
```

Dependency sketch:

```text
sockudo-protocol --+
sockudo-filter ----+--> sockudo-core --+--> app/cache/queue/rate-limiter/metrics/webhook/delta/push
                   |                  +--> sockudo-adapter --> sockudo-server
                   +--> sockudo-ai-transport
```

Backend-specific durable history and version-store implementations live in `sockudo-server` because
they depend on database clients and runtime bootstrap.

## SDK Layout

Realtime clients:

| Directory | Package |
| --- | --- |
| `client-sdks/sockudo-js` | `@sockudo/client` |
| `client-sdks/sockudo-ai-transport-js` | `@sockudo/ai-transport` |
| `client-sdks/sockudo-swift` | `SockudoSwift` |
| `client-sdks/sockudo-kotlin` | `io.sockudo:sockudo-kotlin` |
| `client-sdks/sockudo-flutter` | `sockudo_flutter` |
| `client-sdks/sockudo-dotnet` | `Sockudo.Client` |
| `client-sdks/sockudo-python` | `sockudo-python` |

HTTP/server SDKs:

| Directory | Package |
| --- | --- |
| `server-sdks/sockudo-http-node` | `sockudo` |
| `server-sdks/sockudo-http-python` | `sockudo-http-python` |
| `server-sdks/sockudo-http-php` | `sockudo/sockudo-php-server` |
| `server-sdks/sockudo-http-ruby` | `sockudo` |
| `server-sdks/sockudo-http-go` | `github.com/sockudo/sockudo-http-go/v5` |
| `server-sdks/sockudo-http-rust` | `sockudo-http` |
| `server-sdks/sockudo-http-java` | `io.sockudo:sockudo-http-java` |
| `server-sdks/sockudo-http-dotnet` | `SockudoServer` |
| `server-sdks/sockudo-http-swift` | `Sockudo` |

Keep SDK package names, manifests, README files, and release metadata stable unless the task is
explicitly about changing an SDK release surface.

The old per-SDK GitHub repositories are legacy mirrors and should be archived. This monorepo is the
source of truth. Until package registry publishing is fixed, install docs should use local paths
inside this monorepo rather than old per-SDK repository URLs.

## Crate Responsibilities

| Crate | Main responsibilities | Key files |
| --- | --- | --- |
| `sockudo-protocol` | Pusher-compatible messages, V2 prefixing, extras, versioned realtime frames | `src/messages.rs`, `src/protocol_version.rs`, `src/versioned_messages.rs` |
| `sockudo-filter` | Tag-filter expression model and matching | `src/node.rs`, `src/ops.rs` |
| `sockudo-core` | Traits, config, auth, errors, `HistoryStore`, `VersionStore`, annotations, presence history | `src/options.rs`, `src/history.rs`, `src/version_store.rs`, `src/annotations.rs`, `src/presence_history.rs` |
| `sockudo-app` | App-manager backends | `src/*_app_manager.rs` |
| `sockudo-cache` | Memory/Redis cache managers | `src/*` |
| `sockudo-queue` | Memory and external queue managers | `src/*` |
| `sockudo-rate-limiter` | Rate limit drivers and Tower middleware | `src/*` |
| `sockudo-metrics` | Prometheus metrics exporter and metric catalog | `src/prometheus.rs` |
| `sockudo-webhook` | Webhook event transformation and delivery | `src/*` |
| `sockudo-delta` | Delta compression state and algorithms | `src/*` |
| `sockudo-push` | Credentials, device registrations, subscriptions, publish planning, queues, dispatch, feedback | `src/domain.rs`, `src/storage.rs`, `src/pipeline.rs`, `src/dispatch.rs`, `src/scheduler.rs` |
| `sockudo-ai-transport` | AI extras validation, lifecycle conventions, append rollup, conformance helpers | `src/lib.rs`, `tests/` |
| `sockudo-adapter` | Connection manager, local/horizontal fanout, subscriptions, presence, recovery, rollup egress | `src/handler/*`, `src/local_adapter.rs`, `src/replay_buffer.rs` |
| `sockudo-server` | HTTP/WS routes, startup, database-backed history/version stores, push HTTP API | `src/main.rs`, `src/http_handler.rs`, `src/push_http.rs`, `src/history_*.rs` |

## Feature Flags

Important server features:

- `v2`: Protocol V2 bundle.
- `ai-transport`: AI Transport validation, rollup, and conformance surfaces. Not default.
- `push`: push HTTP/runtime support through `sockudo-push`.
- `redis`, `redis-cluster`, `nats`, `pulsar`, `rabbitmq`, `google-pubsub`, `kafka`, `iggy`:
  adapter/cache/queue integrations as applicable.
- `mysql`, `postgres`, `dynamodb`, `surrealdb`, `scylladb`: app, history, version-store, and push
  storage backends as applicable.
- `sqs`, `sns`, `lambda`: queue/webhook/cloud integrations.
- `full`: all production integrations plus `ai-transport` and `push` where wired.

Build examples:

```bash
cargo build -p sockudo
cargo build -p sockudo --features "v2,ai-transport,redis,postgres,push"
cargo build -p sockudo --release --features full
cargo build --workspace
```

## Core Subsystems

### Protocol V1 And V2

V1 clients receive Pusher-compatible frames with Sockudo-only fields stripped. V2 clients get
`sockudo:` prefixes, serials, message IDs, extras, recovery frames, delta/filter features,
mutable-message actions, annotations, and AI Transport conventions when enabled.

Key files: `sockudo-protocol/src/protocol_version.rs`,
`sockudo-adapter/src/local_adapter.rs`, `sockudo-server/src/ws_handler.rs`.

### Versioned Mutable Messages

`MessageAction` supports `create`, `update`, `delete`, `append`, and `summary`. `VersionStore`
reserves gapless delivery positions, appends versions, reads latest visible state, pages version
history, replays after delivery serial, projects latest-by-history, and purges expired records.

HTTP surfaces include publish-created mutable messages through `/events`, mutation endpoints under
`/channels/{channel}/messages/{message_serial}/{update|delete|append}`, latest reads, and version
history. Own-scoped mutation grants require verified connection identity.

Key files: `sockudo-protocol/src/versioned_messages.rs`,
`sockudo-core/src/versioned_messages.rs`, `sockudo-core/src/version_store.rs`,
`sockudo-core/src/versioned_message_auth.rs`, `sockudo-server/src/http_handler.rs`.

### Durable History, Rewind, And Recovery

`HistoryStore` is distinct from the hot replay buffer. Durable history owns retention, cursors,
stream state, reset/purge, and cold recovery. Protocol V2 recovery first tries hot replay, then
durable history when continuity can be proven. Subscribe-time rewind reads recent history and
`until_attach` bounds client history pages at the attach serial so late joiners get gapless history
plus live delivery.

Key files: `sockudo-core/src/history.rs`, `sockudo-adapter/src/replay_buffer.rs`,
`sockudo-adapter/src/handler/recovery.rs`, `sockudo-adapter/src/handler/history_frames.rs`,
`sockudo-adapter/src/handler/subscription_management.rs`, `sockudo-server/src/history_*.rs`.

### Annotations

Annotations are V2 mutable side records with publish/delete, summary projection, raw subscription
mode, own/any delete authorization, and metrics. They are feature/config gated and delivered only
to V2 clients that request annotation mode.

Key files: `sockudo-core/src/annotations.rs`, `sockudo-adapter/src/handler/annotations.rs`,
`sockudo-server/src/http_handler.rs`.

### Push

`sockudo-push` handles provider credentials, device registrations, channel subscriptions, publish
requests, durable idempotency/status, fanout planning, queues, retries, circuit breakers, provider
dispatch, feedback, scheduled-job cancellation, and cleanup. Realtime publishes may trigger channel
push through `extras.push` or `[[push_rules]]`.

Key files: `sockudo-push/src/domain.rs`, `sockudo-push/src/storage.rs`,
`sockudo-push/src/pipeline.rs`, `sockudo-push/src/dispatch.rs`, `sockudo-server/src/push_http.rs`.

### Presence History

Presence history records authoritative joins/leaves separately from current membership. It can use
memory or durable history as storage and supports paging, snapshots, degraded/reset-required state,
retention, and metrics.

Key files: `sockudo-core/src/presence_history.rs`, `sockudo-adapter/src/presence.rs`,
`sockudo-server/src/presence_history.rs`.

### AI Transport

AI Transport defines a session-as-channel model, lifecycle events (`ai-input`, `ai-output`,
`ai-turn-start`, `ai-turn-end`, `ai-cancel`), typed `extras.ai.transport` and `extras.ai.codec`,
turn/stream validation, append rollup, orphan cancellation, conformance tests, load/chaos tooling,
and capacity docs. It depends on versioned messages, durable history, recovery, presence, push, and
capability-token auth rather than replacing them.

Key files: `crates/sockudo-ai-transport/src/lib.rs`,
`crates/sockudo-ai-transport/tests/`, `tests/ai-conformance/`, `tests/load/`, `tools/chaos/`,
`docs/specs/ai-transport-wire-protocol.md`.

## Configuration Surfaces

Important sections:

- `[versioned_messages]`
- `[history]` and backend subsections
- `[presence_history]`
- `[annotations]`
- `[push]`, `[push.retry]`, `[push.circuit_breaker]`, `[push.default_quotas]`,
  `[push.payload_redaction]`
- `[[push_rules]]`
- `[ai_transport]`, `[[ai_transport.channels]]`, `[ai_transport.rollup]`

Protocol V2 capability tokens are accepted by V2 connection query `token` and refreshed with
`sockudo:auth`; they are not a TOML feature switch.

Reference docs: `docs/content/docs/reference/configuration.mdx`,
`docs/content/docs/reference/environment-variables.mdx`.

## Test Locations

- Rust unit tests: inline `#[cfg(test)]` modules in each crate.
- Rust integration tests: each crate's `tests/` directory.
- AI Transport Rust conformance: `crates/sockudo-ai-transport/tests/`.
- SDK-facing AI conformance: `tests/ai-conformance/`.
- Scale and load: `tests/load/`.
- Dashboard tests: `tests/dashboard/`.
- AI Criterion budgets: `benches/ai/`.
- Push integration smoke: `crates/sockudo-push/tests/`.
- SDK package tests: package-local `test`, `tests`, `spec`, or native language test folders.

## Development Commands

Server:

```bash
cargo fmt --all
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo build -p sockudo --features "v2,ai-transport,redis,postgres,push"
scripts/ai-transport-bench-guard.sh
AIT_CONFORMANCE_OFFLINE=1 scripts/ai-conformance-node.sh
```

Docs:

```bash
cd docs
npm run types:check
npm run build
```

SDKs are package-local. Read the SDK manifest and README, then use the native toolchain: `bun`,
`pnpm`, `npm`, `pytest`, `cargo`, `go test`, `gradle`, `swift test`, `dotnet test`, `composer`, or
`bundle`.

## Compatibility Rules

- Preserve V1 wire output unless the task explicitly changes Pusher compatibility.
- AI Transport, capability tokens, mutable messages, annotations, client history frames, and rollup
  are V2-only.
- No client-asserted `client_id` is authoritative; identity comes from signed-in socket state or
  trusted app-key HTTP context.
- No locks across `.await` in hot fanout paths, no unbounded queues, and no avoidable per-message
  allocations on broadcast paths.
- Update docs and tests whenever a protocol-visible shape, config key, feature flag, endpoint, SDK
  public API, or recovery/history semantic changes.
