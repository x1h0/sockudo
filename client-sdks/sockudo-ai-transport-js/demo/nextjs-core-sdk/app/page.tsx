"use client";

import Sockudo from "@sockudo/client";
import { SockudoProvider } from "@sockudo/client/react";
import type { UIMessage } from "ai";
import { TransportProvider, useCreateView, useView } from "@sockudo/ai-transport/react";
import { UIMessageCodec } from "@sockudo/ai-transport/vercel";
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
  return config ? <CoreDemo config={config} /> : <main className="boot">Loading...</main>;
}

function CoreDemo({ config }: { config: DemoConfig }): React.ReactElement {
  const clientId = useMemo(
    () => `core-${Math.random().toString(36).slice(2)}`,
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
  useEffect(() => () => client.disconnect(), [client]);

  return (
    <SockudoProvider client={client}>
      {/* @docs-snippet core-provider */}
      <TransportProvider
        api="/api/chat"
        channelName={config.channelName}
        codec={UIMessageCodec}
      >
        <CoreConsole />
      </TransportProvider>
      {/* @docs-snippet-end */}
    </SockudoProvider>
  );
}

function CoreConsole(): React.ReactElement {
  const view = useView({ limit: 50 });
  const left = useCreateView({ limit: 50 });
  const right = useCreateView({ limit: 50 });
  const [draft, setDraft] = useState("Explain branch navigation in one sentence.");
  const [selectedId, setSelectedId] = useState<string>();
  const messages = view.messages as readonly UIMessage[];

  const selected = messages.find((message) => message.id === selectedId);

  // @docs-snippet core-branch-views
  const branchPanes = [left, right] as const;
  // @docs-snippet-end

  return (
    <main className="app-shell">
      <header>
        <p>Sockudo AI Transport</p>
        <h1>Core SDK branch console</h1>
      </header>
      <section className="workspace">
        <div className="conversation">
          {messages.map((message) => (
            <button
              key={message.id}
              type="button"
              className={message.role}
              onClick={() => setSelectedId(message.id)}
            >
              <strong>{message.role}</strong>
              <span>{messageText(message)}</span>
            </button>
          ))}
        </div>
        <aside>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button
            type="button"
            onClick={() =>
              void view.send({
                id: crypto.randomUUID(),
                role: "user",
                parts: [{ type: "text", text: draft }],
              })
            }
          >
            Send
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() =>
              selected &&
              void view.edit(selected.id, {
                ...selected,
                parts: [{ type: "text", text: draft }],
              })
            }
          >
            Edit
          </button>
          <button
            type="button"
            disabled={!selectedId}
            onClick={() => selectedId && void view.regenerate(selectedId, selectedId)}
          >
            Regenerate
          </button>
        </aside>
      </section>
      <section className="split">
        {branchPanes.map((pane, index) => (
          <div key={index}>
            <h2>View {index + 1}</h2>
            {(pane.messages as readonly UIMessage[]).map((message) => (
              <p key={message.id}>{messageText(message)}</p>
            ))}
          </div>
        ))}
      </section>
    </main>
  );
}

function messageText(message: UIMessage): string {
  return message.parts
    .map((part) => ("text" in part ? part.text : ""))
    .join("")
    .trim();
}
