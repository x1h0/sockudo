"use client";

import Sockudo from "@sockudo/client";
import {
  adaptSockudoClient,
  getCodecHeaders,
  getTransportHeaders,
  type ChannelLike,
  type ClientLike,
  type HistoryOptions,
  type InboundMessageAction,
  type InboundMessage,
  type MessageAck,
  type MessageMutation,
  type PaginatedResult,
  type SockudoClientPeer,
} from "@sockudo/ai-transport";
import { createClientTransport, type AI } from "@sockudo/ai-transport/vercel";
import { useEffect, useMemo, useRef, useState } from "react";

interface DemoConfig {
  appKey: string;
  channelName: string;
  host: string;
  port: number;
}

interface HarnessState {
  ready: boolean;
  channelName: string;
  normal?: {
    chunks: string[];
    primaryText: string;
    mirrorText: string;
  };
  late?: {
    text: string;
    count: number;
    loadError?: string;
    loadErrorCause?: string;
    nodes: number;
  };
  cancel?: {
    chunks: string[];
    turnId: string;
    ended: boolean;
    cancelEvent: boolean;
    reason?: string;
  };
  debug?: {
    chunks: string[];
    mirrorEvents: string[];
    mirrorText: string;
    primaryEvents: string[];
    primaryText: string;
  };
  error?: string;
}

type BrowserTransport = ReturnType<typeof createClientTransport>;

interface ActiveHarnessTurn {
  stream: ReadableStream<AI.UIMessageChunk>;
  turnId: string;
  cancel(): Promise<void>;
}

export default function E2EHarnessPage(): React.ReactElement {
  const [config, setConfig] = useState<DemoConfig>();
  const [state, setState] = useState<HarnessState>({
    ready: false,
    channelName: "",
  });
  const clientsRef = useRef<Sockudo[]>([]);
  const primaryRef = useRef<BrowserTransport | undefined>(undefined);
  const mirrorRef = useRef<BrowserTransport | undefined>(undefined);
  const observedRef = useRef<
    { source: "primary" | "mirror"; name: string; reason?: string }[]
  >([]);
  const channelName = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const requested = new URLSearchParams(window.location.search).get(
      "channel",
    );
    return requested?.startsWith("private-ai-e2e-") ? requested : "";
  }, []);

  useEffect(() => {
    void fetch("/api/config")
      .then((response) => response.json() as Promise<DemoConfig>)
      .then(setConfig);
  }, []);

  useEffect(() => {
    if (!config) {
      return;
    }
    const targetChannel = channelName || config.channelName;
    const primary = createHarnessTransport(config, targetChannel, "primary");
    const mirror = createHarnessTransport(config, targetChannel, "mirror");
    clientsRef.current = [primary.raw, mirror.raw];
    primaryRef.current = primary.transport;
    mirrorRef.current = mirror.transport;
    const unsubscribes = [
      observe(primary.transport, "primary", observedRef.current),
      observe(mirror.transport, "mirror", observedRef.current),
    ];
    let active = true;
    void Promise.all([primary.attached, mirror.attached])
      .then(() => {
        if (active) {
          setState({ ready: true, channelName: targetChannel });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            ready: false,
            channelName: targetChannel,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      active = false;
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      void primary.transport.close();
      void mirror.transport.close();
      for (const client of clientsRef.current) {
        client.disconnect();
      }
      clientsRef.current = [];
    };
  }, [channelName, config]);

  const runNormal = async (): Promise<void> => {
    await runStep(async () => {
      const primary = requireTransport(primaryRef.current);
      const mirror = requireTransport(mirrorRef.current);
      const active = (await primary.view.send(
        userMessage("browser-normal", "browser normal"),
        {
          body: { scenario: "normal" },
        },
      )) as ActiveHarnessTurn;
      const chunks = await readChunks(active.stream);
      setState((current) => ({
        ...current,
        debug: {
          chunks: chunks.map((chunk) => chunk.type),
          primaryText: assistantText(primary.view.getMessages()),
          mirrorText: assistantText(mirror.view.getMessages()),
          primaryEvents: observedNames("primary", observedRef.current),
          mirrorEvents: observedNames("mirror", observedRef.current),
        },
      }));
      await waitFor(() =>
        assistantText(mirror.view.getMessages()).includes(
          "Echo: browser normal",
        ),
      );
      setState((current) => ({
        ...current,
        normal: {
          chunks: chunks.map((chunk) => chunk.type),
          primaryText: assistantText(primary.view.getMessages()),
          mirrorText: assistantText(mirror.view.getMessages()),
        },
      }));
    });
  };

  const loadLate = async (): Promise<void> => {
    await runStep(async () => {
      const currentConfig = requireConfig(config);
      const targetChannel = requireChannel(state.channelName);
      const late = createHarnessTransport(currentConfig, targetChannel, "late");
      clientsRef.current.push(late.raw);
      await late.transport.view.loadOlder(20);
      const messages = late.transport.view.getMessages();
      setState((current) => ({
        ...current,
        late: {
          count: messages.length,
          text: assistantText(messages),
          nodes: late.transport.view.flattenNodes().length,
          ...(late.transport.view.loadError?.message === undefined
            ? {}
            : { loadError: late.transport.view.loadError.message }),
          ...optional("loadErrorCause", errorMessage(late.transport.view.loadError?.cause)),
        },
      }));
      await late.transport.close();
      late.raw.disconnect();
    });
  };

  const runCancel = async (): Promise<void> => {
    await runStep(async () => {
      const primary = requireTransport(primaryRef.current);
      const active = (await primary.view.send(
        userMessage("browser-cancel", "cancel me"),
        {
          body: { scenario: "slow" },
        },
      )) as ActiveHarnessTurn;
      const reader = active.stream.getReader();
      const chunks: AI.UIMessageChunk[] = [];
      const first = await reader.read();
      if (!first.done) {
        chunks.push(first.value);
      }
      await active.cancel();
      for (;;) {
        const next = await reader.read();
        if (next.done) {
          break;
        }
        chunks.push(next.value);
      }
      reader.releaseLock();
      await waitFor(() =>
        observedRef.current.some(
          (event) =>
            event.name === "ai-turn-end" &&
            event.reason === "cancelled" &&
            event.source === "primary",
        ),
      );
      const ended = observedRef.current.some(
        (event) => event.name === "ai-turn-end" && event.reason === "cancelled",
      );
      setState((current) => ({
        ...current,
        cancel: {
          chunks: chunks.map((chunk) => chunk.type),
          turnId: active.turnId,
          ended,
          cancelEvent: observedRef.current.some(
            (event) => event.name === "ai-cancel",
          ),
          reason: "cancelled",
        },
      }));
    });
  };

  async function runStep(step: () => Promise<void>): Promise<void> {
    try {
      setState((current) => {
        const { error: _error, ...rest } = current;
        return rest;
      });
      await step();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((current) => ({ ...current, error: message }));
    }
  }

  return (
    <main className="app-shell">
      <header>
        <p>Sockudo AI Transport</p>
        <h1>Browser E2E harness</h1>
        <span data-testid="ready">{state.ready ? "ready" : "loading"}</span>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <button
          data-testid="run-normal"
          type="button"
          onClick={() => void runNormal()}
        >
          Run normal
        </button>
        <button
          data-testid="load-late"
          type="button"
          onClick={() => void loadLate()}
        >
          Load late
        </button>
        <button
          data-testid="run-cancel"
          type="button"
          onClick={() => void runCancel()}
        >
          Run cancel
        </button>
      </form>
      <pre data-testid="state">{JSON.stringify(state, null, 2)}</pre>
    </main>
  );
}

function createHarnessTransport(
  config: DemoConfig,
  channelName: string,
  label: string,
): { attached: Promise<void>; raw: Sockudo; transport: BrowserTransport } {
  const clientId = `e2e-${label}-${crypto.randomUUID()}`;
  const raw = new Sockudo(config.appKey, {
    cluster: "local",
    forceTLS: false,
    enabledTransports: ["ws"],
    wsHost: config.host,
    wsPort: config.port,
    wssPort: config.port,
    protocolVersion: 2,
    clientId,
    channelAuthorization: { transport: "ajax", endpoint: "/api/channel-auth" },
    versionedMessages: { endpoint: "/api/versioned-messages" },
  } as unknown as ConstructorParameters<typeof Sockudo>[1]);
  const client = createBrowserProxyClient(raw, clientId);
  const attached = waitForChannelAttached(client.channels.get(channelName));
  const transport = createClientTransport({
    client,
    channelName,
    clientId,
    api: "/api/e2e-ai",
  });
  return { attached, raw, transport };
}

function waitForChannelAttached(channel: ChannelLike): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${channel.name} to attach`));
    }, 10_000);
    const cleanup = (): void => {
      clearTimeout(timer);
      offAttached();
      offFailed();
    };
    const offAttached = channel.on("attached", () => {
      cleanup();
      resolve();
    });
    const offFailed = channel.on("failed", (error) => {
      cleanup();
      reject(error);
    });
  });
}

function createBrowserProxyClient(raw: Sockudo, clientId: string): ClientLike {
  const realtime = adaptSockudoClient(raw as unknown as SockudoClientPeer);
  return {
    channels: {
      get(name, options) {
        const live = realtime.channels.get(name, options);
        return {
          ...live,
          publish(message) {
            return versionedProxy<MessageAck>({
              action: "publish_create",
              channel: name,
              name: message.name,
              data: message.data,
              extras: message.extras,
              messageId: message.messageId,
              messageSerial: message.messageSerial,
              clientId: message.clientId ?? clientId,
              socketId: message.socketId,
              opId: message.opId,
            });
          },
          appendMessage(messageSerial, data, mutation = {}) {
            return versionedProxy<MessageAck>({
              action: "message_append",
              channel: name,
              messageSerial,
              data,
              ...mutationPayload(mutation, clientId),
            });
          },
          updateMessage(messageSerial, mutation = {}) {
            return versionedProxy<MessageAck>({
              action: "message_update",
              channel: name,
              messageSerial,
              ...mutationPayload(mutation, clientId),
            });
          },
          deleteMessage(messageSerial, mutation = {}) {
            return versionedProxy<MessageAck>({
              action: "message_delete",
              channel: name,
              messageSerial,
              ...mutationPayload(mutation, clientId),
            });
          },
          history(historyOptions = {}) {
            return readProxyHistory(name, historyOptions);
          },
        } satisfies ChannelLike;
      },
    },
    connection: realtime.connection,
    close: realtime.close,
  };
}

async function readProxyHistory(
  channel: string,
  options: HistoryOptions,
): Promise<PaginatedResult<InboundMessage>> {
  const payload = await versionedProxy<{
    items?: unknown;
    next?: string;
    has_more?: boolean;
  }>({
    action: "channel_history",
    channel,
    params: historyParams(options),
  });
  const rawItems = Array.isArray(payload.items) ? [...payload.items] : [];
  if (options.direction === "newest_first") {
    rawItems.reverse();
  }
  const items =
    rawItems.length > 0
      ? rawItems.map((item) =>
        normalizeProxyHistoryItem(item, Number(Date.now())),
      )
    : [];
  const cursor = typeof payload.next === "string" ? payload.next : undefined;
  return {
    items,
    hasNext() {
      return Boolean(cursor ?? payload.has_more);
    },
    next() {
      return readProxyHistory(
        channel,
        cursor === undefined ? options : { ...options, cursor },
      );
    },
  };
}

function normalizeProxyHistoryItem(
  item: unknown,
  fallbackSerial: number,
): InboundMessage {
  const wrapper = record(item);
  const message = record(wrapper.message ?? item);
  const serial = stringValue(message.message_serial ?? message.messageSerial) ?? "";
  const historySerial = serialValue(wrapper.serial ?? message.serial) ?? fallbackSerial;
  const extras = message.extras;
  const transport = getTransportHeaders(extras);
  return {
    name: stringValue(message.name) ?? stringValue(message.event) ?? "",
    data: parseJsonish(message.data),
    action: historyAction(message.data, transport),
    messageSerial: serial,
    historySerial,
    timestamp: Number(message.time_ms ?? message.timestamp ?? Date.now()),
    raw: item,
    ...optional("messageId", stringValue(message.message_id ?? message.messageId)),
    ...optional("extras", extras),
    getTransportHeaders() {
      return transport;
    },
    getCodecHeaders() {
      return getCodecHeaders(extras);
    },
  };
}

function historyAction(
  data: unknown,
  transport: Record<string, string>,
): InboundMessageAction {
  return transport.stream === "true" && typeof data === "string"
    ? "update"
    : "create";
}

function mutationPayload(
  mutation: Omit<MessageMutation, "data"> | MessageMutation,
  clientId: string,
): Record<string, unknown> {
  return {
    name: mutation.name,
    data: "data" in mutation ? mutation.data : undefined,
    extras: mutation.extras,
    clearFields: mutation.clearFields,
    opId: mutation.opId,
    clientId: mutation.clientId ?? clientId,
    socketId: mutation.socketId,
    description: mutation.description,
    metadata: mutation.metadata,
  };
}

function historyParams(options: HistoryOptions): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      limit: options.limit,
      direction: options.direction,
      cursor: options.cursor,
      start: options.start,
      end: options.end,
      startSerial: options.startSerial,
      endSerial: options.endSerial,
      startTimeMs: options.startTimeMs,
      endTimeMs: options.endTimeMs,
    })
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}

async function versionedProxy<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/versioned-messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(stripUndefined(body)),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`versioned proxy failed ${String(response.status)}: ${text}`);
  }
  return (text.length > 0 ? JSON.parse(text) : {}) as T;
}

function stripUndefined(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined),
  );
}

function observe(
  transport: BrowserTransport,
  source: "primary" | "mirror",
  events: { source: "primary" | "mirror"; name: string; reason?: string }[],
): () => void {
  return transport.on("message", (message) => {
    const headers = message.getTransportHeaders();
    events.push({
      source,
      name: message.name,
      ...(headers["turn-reason"] !== undefined
        ? { reason: headers["turn-reason"] }
        : {}),
    });
  });
}

function observedNames(
  source: "primary" | "mirror",
  events: { source: "primary" | "mirror"; name: string; reason?: string }[],
): string[] {
  return events
    .filter((event) => event.source === source)
    .map((event) =>
      event.reason === undefined ? event.name : `${event.name}:${event.reason}`,
    );
}

function errorMessage(value: unknown): string | undefined {
  return value instanceof Error ? value.message : undefined;
}

function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function userMessage(id: string, text: string): AI.UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

async function readChunks(
  stream: ReadableStream<AI.UIMessageChunk>,
): Promise<AI.UIMessageChunk[]> {
  const reader = stream.getReader();
  const chunks: AI.UIMessageChunk[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        return chunks;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
}

function assistantText(messages: readonly AI.UIMessage[]): string {
  return messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .map((part) => ("text" in part ? part.text : ""))
    .join("");
}

async function waitFor(predicate: () => boolean): Promise<void> {
  let last = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    last = predicate();
    if (last) {
      return;
    }
    await sleep(50);
  }
  throw new Error("timed out waiting for browser E2E condition");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function requireTransport(
  transport: BrowserTransport | undefined,
): BrowserTransport {
  if (!transport) {
    throw new Error("transport is not ready");
  }
  return transport;
}

function requireConfig(config: DemoConfig | undefined): DemoConfig {
  if (!config) {
    throw new Error("config is not ready");
  }
  return config;
}

function requireChannel(channelName: string): string {
  if (!channelName) {
    throw new Error("channel is not ready");
  }
  return channelName;
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

function serialValue(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
