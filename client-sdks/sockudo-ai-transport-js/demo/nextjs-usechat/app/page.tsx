"use client";

import { useChat } from "@ai-sdk/react";
import Sockudo from "@sockudo/client";
import { SockudoProvider } from "@sockudo/client/react";
import type { ChatTransport as AiSdkChatTransport, UIMessage } from "ai";
import {
  adaptSockudoClient,
  getCodecHeaders,
  getTransportHeaders,
  type ChannelLike,
  type ClientLike,
  type HistoryOptions,
  type InboundMessage,
  type InboundMessageAction,
  type MessageAck,
  type MessageMutation,
  type PaginatedResult,
  type SockudoClientPeer,
} from "@sockudo/ai-transport";
import {
  ChatTransportProvider,
  useActiveTurns,
  useChatTransport,
  useMessageSync,
  useView,
} from "@sockudo/ai-transport/vercel/react";
import { useEffect, useMemo, useState } from "react";

interface DemoConfig {
  appKey: string;
  channelName: string;
  host: string;
  port: number;
}

export default function Page(): React.ReactElement {
  const [config, setConfig] = useState<DemoConfig>();

  useEffect(() => {
    void fetch("/api/config")
      .then((response) => response.json() as Promise<DemoConfig>)
      .then(setConfig);
  }, []);

  if (!config) {
    return <main className="boot">Loading Sockudo AI Transport...</main>;
  }
  return <UseChatDemo config={config} />;
}

function UseChatDemo({ config }: { config: DemoConfig }): React.ReactElement {
  const clientId = useMemo(
    () => `usechat-${Math.random().toString(36).slice(2)}`,
    [],
  );
  const client = useMemo(
    () => {
      const options = {
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
      } as unknown as ConstructorParameters<typeof Sockudo>[1];
      return new Sockudo(config.appKey, options);
    },
    [clientId, config.appKey, config.host, config.port],
  );
  const realtimeClient = useMemo(
    () => createBrowserProxyClient(client, clientId),
    [client, clientId],
  );

  useEffect(() => () => client.disconnect(), [client]);
  const chatOptions = useMemo(
    () => ({
      prepareSendMessagesRequest(context: {
        trigger: string;
        history: readonly unknown[];
      }) {
        return {
          headers: { "x-demo-trigger": context.trigger },
          body: { demoHistoryCount: context.history.length },
        };
      },
    }),
    [],
  );

  return (
    <SockudoProvider
      client={
        realtimeClient as unknown as Parameters<typeof SockudoProvider>[0]["client"]
      }
    >
      {/* @docs-snippet usechat-provider */}
      <ChatTransportProvider
        api="/api/chat"
        clientId={clientId}
        channelName={config.channelName}
        chatOptions={chatOptions}
      >
        <ChatConsole channelName={config.channelName} />
      </ChatTransportProvider>
      {/* @docs-snippet-end */}
    </SockudoProvider>
  );
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
  const items = rawItems.map((item) =>
    normalizeProxyHistoryItem(item, Number(Date.now())),
  );
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
  const serial =
    stringValue(message.message_serial ?? message.messageSerial) ?? "";
  const historySerial =
    serialValue(wrapper.serial ?? message.serial) ?? fallbackSerial;
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

function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
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
  return typeof value === "string" || typeof value === "number"
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function ChatConsole({
  channelName,
}: {
  channelName: string;
}): React.ReactElement {
  const { chatTransport, transportError } = useChatTransport();
  const chat = useChat<UIMessage>({
    id: channelName,
    transport: chatTransport as unknown as AiSdkChatTransport<UIMessage>,
  });
  const view = useView({ limit: 50 });
  const activeTurns = useActiveTurns();
  const [draft, setDraft] = useState("Say hello over Sockudo AI Transport.");

  // @docs-snippet usechat-sync
  useMessageSync({
    setMessages: chat.setMessages as unknown as Parameters<
      typeof useMessageSync
    >[0]["setMessages"],
  });
  // @docs-snippet-end

  const activeTurnCount = Array.from(activeTurns.values()).reduce(
    (count, turns) => count + turns.size,
    0,
  );

  return (
    <main className="app-shell">
      <header>
        <p>Sockudo AI Transport</p>
        <h1>Vercel useChat quickstart</h1>
        <span>
          {activeTurnCount > 0 ? "streaming" : "idle"} / {chat.status}
        </span>
      </header>
      {transportError && <p className="error">{transportError.message}</p>}
      {chat.error && <p className="error">{chat.error.message}</p>}
      <section className="messages" aria-live="polite">
        {chat.messages.map((message) => (
          <article key={message.id} className={message.role}>
            <strong>{message.role}</strong>
            <p>{message.parts.map((part) => ("text" in part ? part.text : "")).join("")}</p>
          </article>
        ))}
      </section>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) {
            void chat.sendMessage({ text: draft.trim() });
            setDraft("");
          }
        }}
      >
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" disabled={chat.status === "submitted"}>
          Send
        </button>
        <button type="button" onClick={() => void chat.stop()}>
          Stop
        </button>
        <button type="button" onClick={() => void view.loadOlder(50)}>
          Load older
        </button>
      </form>
    </main>
  );
}
