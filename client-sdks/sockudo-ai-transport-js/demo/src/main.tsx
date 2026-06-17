import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useChat } from "@ai-sdk/react";
import Sockudo from "@sockudo/client";
import { SockudoProvider } from "@sockudo/client/react";
import type { ChatTransport as AiSdkChatTransport, UIMessage } from "ai";
import type { ChatTransportOptions } from "@sockudo/ai-transport/vercel";
import {
  ChatTransportProvider,
  useActiveTurns,
  useChatTransport,
  useCreateView,
  useMessageSync,
  useSockudoMessages,
  useTree,
  useView,
} from "@sockudo/ai-transport/vercel/react";
import "./styles.css";

interface DemoConfig {
  appKey: string;
  channelName: string;
  host: string;
  port: number;
  model: string;
}

interface Scenario {
  id: string;
  label: string;
  prompt: string;
  action: string;
}

interface RenderableMessage {
  id: string;
  role: string;
  parts: readonly RenderablePart[];
}

interface RenderablePart {
  type: string;
  text?: unknown;
}

const scenarios: readonly Scenario[] = [
  {
    id: "stream",
    label: "Token stream",
    action: "fresh-submit",
    prompt:
      "Stream five short bullet points about why realtime AI transport matters.",
  },
  {
    id: "branches",
    label: "Branch seed",
    action: "fresh-submit",
    prompt:
      "Answer in one sentence: should I edit or regenerate a turn to compare branches?",
  },
  {
    id: "reasoning",
    label: "Reasoning parts",
    action: "fresh-submit",
    prompt:
      "Think briefly, then answer plainly: what is one risk in distributed AI streaming?",
  },
  {
    id: "tools",
    label: "Tool surface",
    action: "tool-approval",
    prompt:
      "Run the approval-gated demo tool and then summarize the approved result in one sentence.",
  },
  {
    id: "history",
    label: "History page",
    action: "fresh-submit",
    prompt:
      "Create a compact numbered note that will be useful when I reload and load older history.",
  },
];

const presetEditText =
  "Preset edit branch: explain in three crisp points how Sockudo keeps realtime AI state synchronized.";

function App(): React.ReactElement {
  const [config, setConfig] = useState<DemoConfig | undefined>();
  const [configError, setConfigError] = useState<string | undefined>();

  useEffect(() => {
    void fetch("/api/config")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`config request failed: ${String(response.status)}`);
        }
        return response.json() as Promise<DemoConfig>;
      })
      .then(setConfig)
      .catch((error: unknown) => {
        setConfigError(error instanceof Error ? error.message : String(error));
      });
  }, []);

  if (configError) {
    return (
      <main className="boot-screen">
        <strong>Configuration failed</strong>
        <span>{configError}</span>
      </main>
    );
  }
  if (!config) {
    return (
      <main className="boot-screen">
        <strong>Sockudo AI Transport</strong>
        <span>Loading demo configuration...</span>
      </main>
    );
  }
  return <ConnectedApp config={config} />;
}

function ConnectedApp({ config }: { config: DemoConfig }): React.ReactElement {
  const clientId = useMemo(
    () => `demo-${Math.random().toString(36).slice(2, 9)}`,
    [],
  );
  const chatOptions = useMemo<ChatTransportOptions>(
    () => ({
      prepareSendMessagesRequest(context) {
        return {
          headers: {
            "x-sockudo-demo-client": clientId,
            "x-sockudo-demo-trigger": context.trigger,
          },
          body: {
            demoClientId: clientId,
            demoTrigger: context.trigger,
            demoHistoryCount: context.history.length,
            demoMessageCount: context.messages.length,
          },
        };
      },
    }),
    [clientId],
  );
  const client = useMemo(
    () =>
      new Sockudo(config.appKey, {
        cluster: "local",
        forceTLS: false,
        enabledTransports: ["ws"],
        wsHost: config.host,
        wsPort: config.port,
        wssPort: config.port,
        protocolVersion: 2,
        clientId,
        channelAuthorization: {
          transport: "fetch",
          endpoint: "/api/channel-auth",
        },
        versionedMessages: {
          endpoint: "/api/versioned-messages",
        },
      }),
    [clientId, config.appKey, config.host, config.port],
  );

  useEffect(() => {
    return () => {
      client.disconnect();
    };
  }, [client]);

  return (
    <SockudoProvider client={client}>
      <ChatTransportProvider
        channelName={config.channelName}
        api="/api/chat"
        chatOptions={chatOptions}
      >
        <ChatExperience config={config} clientId={clientId} />
      </ChatTransportProvider>
    </SockudoProvider>
  );
}

function ChatExperience({
  config,
  clientId,
}: {
  config: DemoConfig;
  clientId: string;
}): React.ReactElement {
  const { chatTransport, transport, chatTransportError, transportError } =
    useChatTransport();
  const chat = useChat<UIMessage>({
    id: config.channelName,
    transport: chatTransport as unknown as AiSdkChatTransport<UIMessage>,
    sendAutomaticallyWhen({ messages }) {
      return lastAssistantHasPendingContinuation(messages);
    },
  });
  const view = useView({ limit: 30 });
  const observerView = useCreateView({ limit: 12 });
  const tree = useTree();
  const rawMessages = useSockudoMessages();
  const activeTurns = useActiveTurns();
  const streaming = useStreamingFlag(chatTransport);
  const renderCount = useRenderCount();
  const conversationRef = useRef<HTMLDivElement>(null);
  const editCounter = useRef(0);
  const [draft, setDraft] = useState(
    "Reply with exactly: Ollama is connected through Sockudo AI Transport.",
  );
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [editDraft, setEditDraft] = useState("");
  const [lastAction, setLastAction] = useState("Ready");
  const [rawCursor, setRawCursor] = useState(0);
  const [showRawPayloads, setShowRawPayloads] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(true);

  useMessageSync({
    setMessages: chat.setMessages as unknown as Parameters<
      typeof useMessageSync
    >[0]["setMessages"],
    skip: !syncEnabled,
  });

  const selectedMessage = useMemo(
    () =>
      selectedId === undefined
        ? undefined
        : lastMessageById(chat.messages, selectedId),
    [chat.messages, selectedId],
  );
  const selectedNode =
    selectedId === undefined ? undefined : tree.getNode(selectedId);
  const selectedSiblings =
    selectedId === undefined ? [] : view.getSiblings(selectedId);
  const selectedSiblingIndex =
    selectedId === undefined ? 0 : view.getSelectedIndex(selectedId);
  const messageSiblings =
    selectedId === undefined
      ? []
      : transport.view.getMessageSiblings(selectedId);
  const selectedMessageSiblingIndex =
    selectedId === undefined
      ? 0
      : transport.view.getSelectedMessageSiblingIndex(selectedId);
  const activeTurnRows = useMemo(
    () =>
      Array.from(activeTurns.entries()).flatMap(([turnClientId, turns]) =>
        Array.from(turns).map((turnId) => ({ clientId: turnClientId, turnId })),
      ),
    [activeTurns],
  );
  const activeTurnCount = activeTurnRows.length;
  const rawSinceClear = rawMessages.slice(rawCursor);
  const canStop =
    chat.status === "streaming" ||
    chat.status === "submitted" ||
    activeTurnCount > 0;
  const assistantMessages = chat.messages.filter(
    (message) => message.role === "assistant",
  );
  const userMessages = chat.messages.filter(
    (message) => message.role === "user",
  );

  useEffect(() => {
    if (selectedId !== undefined) {
      return;
    }
    const last = chat.messages.at(-1);
    if (last) {
      setSelectedId(last.id);
    }
  }, [chat.messages, selectedId]);

  useEffect(() => {
    if (selectedMessage?.role === "user") {
      setEditDraft(messageText(selectedMessage));
    }
  }, [selectedMessage]);

  useEffect(() => {
    const node = conversationRef.current;
    if (!node) {
      return;
    }
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [chat.messages.length, chat.status, streaming]);

  const sendText = useCallback(
    async (text: string, action = "fresh-submit") => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      setLastAction("Fresh submit");
      await chat.sendMessage(
        { text: trimmed },
        {
          body: { demoAction: action },
          headers: { "x-sockudo-demo-action": action },
        },
      );
    },
    [chat],
  );

  const runScenario = useCallback(
    (scenario: Scenario) => {
      setDraft(scenario.prompt);
      void sendText(scenario.prompt, scenario.action);
    },
    [sendText],
  );

  const stopOwnTurns = useCallback(() => {
    setLastAction("Cancel own turns");
    void chat.stop();
    void transport.cancel({ own: true });
  }, [chat, transport]);

  const cancelAllTurns = useCallback(() => {
    setLastAction("Cancel all turns");
    void transport.cancel({ all: true });
  }, [transport]);

  const waitForOwnTurns = useCallback(() => {
    setLastAction("Waiting for own turns");
    void transport.waitForTurn({ own: true }).then(() => {
      setLastAction("Own turns settled");
    });
  }, [transport]);

  const reconnectProbe = useCallback(() => {
    setLastAction("Reconnect probe");
    void chatTransport
      .reconnectToStream({ chatId: config.channelName })
      .then((stream) => {
        setLastAction(
          stream === null ? "Observer mode handles stream" : "Stream resumed",
        );
      });
  }, [chatTransport, config.channelName]);

  const regenerateSelected = useCallback(() => {
    const target =
      selectedMessage?.role === "assistant"
        ? selectedMessage
        : assistantMessages.at(-1);
    if (!target) {
      setLastAction("No assistant message to regenerate");
      return;
    }
    setSelectedId(target.id);
    setLastAction("Regenerate assistant");
    void chat.regenerate({
      messageId: target.id,
      body: { demoAction: "regenerate" },
      headers: { "x-sockudo-demo-action": "regenerate" },
    });
  }, [assistantMessages, chat, selectedMessage]);

  const editSelectedUser = useCallback(() => {
    const target =
      selectedMessage?.role === "user" ? selectedMessage : userMessages.at(-1);
    const text = editDraft.trim();
    if (!target || !text) {
      setLastAction("No user message selected for edit");
      return;
    }
    editCounter.current += 1;
    setSelectedId(target.id);
    setLastAction("Edit user branch");
    void chat.sendMessage(
      {
        text,
        messageId: target.id,
        metadata: { demoEdit: editCounter.current },
      },
      {
        body: { demoAction: "edit-user" },
        headers: { "x-sockudo-demo-action": "edit-user" },
      },
    );
  }, [chat, editDraft, selectedMessage, userMessages]);

  const presetEditSelectedUser = useCallback(() => {
    const target =
      selectedMessage?.role === "user" ? selectedMessage : userMessages.at(-1);
    if (!target) {
      setLastAction("No user message selected for preset edit");
      return;
    }
    editCounter.current += 1;
    setEditDraft(presetEditText);
    setSelectedId(target.id);
    setLastAction("Preset edit branch");
    void chat.sendMessage(
      {
        text: presetEditText,
        messageId: target.id,
        metadata: { demoEdit: editCounter.current, preset: true },
      },
      {
        body: { demoAction: "edit-user" },
        headers: { "x-sockudo-demo-action": "edit-user" },
      },
    );
  }, [chat, selectedMessage, userMessages]);

  const selectTurnSibling = useCallback(
    (direction: -1 | 1) => {
      if (selectedId === undefined || selectedSiblings.length === 0) {
        return;
      }
      view.select(selectedId, selectedSiblingIndex + direction, "user");
      setLastAction("Selected turn sibling");
    },
    [selectedId, selectedSiblingIndex, selectedSiblings.length, view],
  );

  const selectMessageSibling = useCallback(
    (direction: -1 | 1) => {
      if (selectedId === undefined || messageSiblings.length === 0) {
        return;
      }
      transport.view.selectMessageSibling(
        selectedId,
        selectedMessageSiblingIndex + direction,
        "user",
      );
      setLastAction("Selected message sibling");
    },
    [
      messageSiblings.length,
      selectedId,
      selectedMessageSiblingIndex,
      transport.view,
    ],
  );

  const addDemoToolOutput = useCallback(
    (part: UIMessage["parts"][number]) => {
      const record = recordPart(part);
      const toolCallId = stringField(record, "toolCallId");
      const tool = stringField(record, "toolName") ?? "demoTool";
      if (!toolCallId) {
        return;
      }
      setLastAction("Local tool output");
      void chat.addToolOutput({
        tool,
        toolCallId,
        output: { ok: true, value: "Demo tool output from the browser" },
        options: {
          body: { demoAction: "tool-approval" },
          headers: { "x-sockudo-demo-action": "tool-output" },
        },
      });
    },
    [chat],
  );

  const approveDemoTool = useCallback(
    (part: UIMessage["parts"][number], approved: boolean) => {
      const record = recordPart(part);
      const approval = recordField(record, "approval");
      const id =
        approval === undefined
          ? undefined
          : (stringField(approval, "id") ??
            stringField(approval, "approvalId"));
      const fallbackId =
        id ??
        stringField(record, "approvalId") ??
        stringField(record, "toolCallId");
      if (!fallbackId) {
        return;
      }
      setLastAction(
        approved ? "Tool approval granted" : "Tool approval denied",
      );
      void chat.addToolApprovalResponse({
        id: fallbackId,
        approved,
        reason: approved
          ? "Approved in demo console"
          : "Denied in demo console",
        options: {
          body: { demoAction: "tool-approval" },
          headers: { "x-sockudo-demo-action": "tool-approval-response" },
        },
      });
    },
    [chat],
  );

  const errorMessage =
    chatTransportError?.message ??
    transportError?.message ??
    chat.error?.message;

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Sockudo AI Transport</span>
          <h1>Realtime SDK test console</h1>
          <div className="hero-meta">
            <span>{config.channelName}</span>
            <span>{config.model}</span>
            <span>{clientId}</span>
          </div>
        </div>
        <div className="metric-strip">
          <Metric label="Chat" value={chat.status} tone={chat.status} />
          <Metric
            label="Streaming"
            value={streaming ? "on" : "off"}
            tone={streaming ? "on" : "off"}
          />
          <Metric label="Visible" value={String(chat.messages.length)} />
          <Metric label="Tree nodes" value={String(view.nodes.length)} />
          <Metric label="Raw events" value={String(rawMessages.length)} />
          <Metric label="Renders" value={String(renderCount)} />
        </div>
      </section>

      {errorMessage && (
        <section className="error-band">
          <strong>Transport error</strong>
          <span>{errorMessage}</span>
          {chat.error && (
            <button
              type="button"
              className="ghost danger"
              onClick={chat.clearError}
            >
              Clear
            </button>
          )}
        </section>
      )}

      <section className="demo-grid">
        <aside className="left-rail surface">
          <PanelTitle title="Scenarios" detail="send paths" />
          <div className="scenario-list">
            {scenarios.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                className="scenario-button"
                onClick={() => runScenario(scenario)}
                disabled={chat.status === "submitted"}
              >
                <span>{scenario.label}</span>
                <small>{scenario.prompt}</small>
              </button>
            ))}
          </div>

          <PanelTitle title="Turn Controls" detail="cancel + wait" />
          <div className="control-grid">
            <button type="button" onClick={stopOwnTurns} disabled={!canStop}>
              Stop Own
            </button>
            <button
              type="button"
              className="secondary"
              onClick={cancelAllTurns}
            >
              Cancel All
            </button>
            <button
              type="button"
              className="secondary"
              onClick={waitForOwnTurns}
            >
              Wait Own
            </button>
            <button
              type="button"
              className="secondary"
              onClick={reconnectProbe}
            >
              Reconnect
            </button>
          </div>

          <PanelTitle title="History" detail="view paging" />
          <div className="control-grid">
            <button
              type="button"
              className="secondary"
              onClick={() => void view.loadOlder(30)}
              disabled={view.loading}
            >
              Load 30
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void observerView.loadOlder(12)}
              disabled={observerView.loading}
            >
              Observer 12
            </button>
          </div>
          <div className="mini-status">
            <span>
              {view.hasOlder ? "older available" : "at newest window"}
            </span>
            <span>{view.loading ? "loading" : "idle"}</span>
          </div>

          <PanelTitle title="Sync Gate" detail="useMessageSync" />
          <label className="switch-row">
            <input
              type="checkbox"
              checked={syncEnabled}
              onChange={(event) => setSyncEnabled(event.currentTarget.checked)}
            />
            <span>Sync remote view into useChat</span>
          </label>
        </aside>

        <section className="chat-column surface">
          <div
            ref={conversationRef}
            className="conversation"
            aria-live="polite"
          >
            {chat.messages.length === 0 ? (
              <div className="empty-state">
                <strong>No messages yet</strong>
                <span>
                  Send a scenario or type below; open another tab to test
                  observer sync.
                </span>
              </div>
            ) : (
              chat.messages.map((message, index) => (
                <MessageBubble
                  key={`${message.id}:chat:${String(index)}`}
                  message={message}
                  selected={message.id === selectedId}
                  onSelect={setSelectedId}
                  onToolOutput={addDemoToolOutput}
                  onToolApproval={approveDemoTool}
                />
              ))
            )}
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              const text = draft.trim();
              if (!text) {
                return;
              }
              setDraft("");
              void sendText(text);
            }}
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              placeholder="Type a message"
              rows={3}
            />
            <div className="composer-actions">
              <button
                type="submit"
                disabled={!draft.trim() || chat.status === "submitted"}
              >
                Send
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!canStop}
                onClick={stopOwnTurns}
              >
                Stop
              </button>
            </div>
          </form>
        </section>

        <aside className="right-rail">
          <section className="surface inspector-panel">
            <PanelTitle title="Branch Lab" detail={lastAction} />
            <div className="selected-card">
              <span>{selectedMessage?.role ?? "none selected"}</span>
              <strong>{selectedId ?? "select a message"}</strong>
              <p>
                {selectedMessage
                  ? messagePreview(selectedMessage)
                  : "Pick any bubble to inspect branch state."}
              </p>
            </div>
            <textarea
              className="edit-box"
              value={editDraft}
              onChange={(event) => setEditDraft(event.currentTarget.value)}
              placeholder="Edit selected user message"
              rows={3}
            />
            <div className="control-grid">
              <button
                type="button"
                onClick={editSelectedUser}
                disabled={!editDraft.trim()}
              >
                Edit
              </button>
              <button
                type="button"
                className="secondary"
                onClick={presetEditSelectedUser}
                disabled={userMessages.length === 0}
              >
                Preset Edit
              </button>
              <button
                type="button"
                className="secondary"
                onClick={regenerateSelected}
              >
                Regenerate
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => selectTurnSibling(-1)}
                disabled={selectedSiblings.length < 2}
              >
                Prev Turn
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => selectTurnSibling(1)}
                disabled={selectedSiblings.length < 2}
              >
                Next Turn
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => selectMessageSibling(-1)}
                disabled={messageSiblings.length < 2}
              >
                Prev Msg
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => selectMessageSibling(1)}
                disabled={messageSiblings.length < 2}
              >
                Next Msg
              </button>
            </div>
            <KeyValue
              rows={[
                [
                  "turn siblings",
                  branchValue(selectedSiblingIndex, selectedSiblings.length),
                ],
                [
                  "message siblings",
                  branchValue(
                    selectedMessageSiblingIndex,
                    messageSiblings.length,
                  ),
                ],
                ["node", selectedNode ? selectedNode.status : "none"],
                ["client", selectedNode?.clientId ?? "unknown"],
              ]}
            />
          </section>

          <section className="surface inspector-panel">
            <PanelTitle title="Active Turns" detail="cross-client" />
            {activeTurnRows.length === 0 ? (
              <div className="empty-mini">No active or suspended turns.</div>
            ) : (
              <div className="turn-list">
                {activeTurnRows.map((row) => (
                  <div
                    key={`${row.clientId}-${row.turnId}`}
                    className="turn-row"
                  >
                    <span>{row.clientId}</span>
                    <code>{row.turnId}</code>
                    <button
                      type="button"
                      className="tiny"
                      onClick={() =>
                        void transport.cancel({ turnId: row.turnId })
                      }
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="surface inspector-panel">
            <PanelTitle
              title="Observer View"
              detail={`${String(observerView.messages.length)} messages`}
            />
            <div className="observer-list">
              {observerView.messages.slice(-6).map((message, index) => (
                <button
                  key={`${message.id}:observer:${String(index)}`}
                  type="button"
                  className="observer-row"
                  onClick={() => setSelectedId(message.id)}
                >
                  <span>{message.role}</span>
                  <strong>{messagePreview(message)}</strong>
                </button>
              ))}
              {observerView.messages.length === 0 && (
                <div className="empty-mini">Secondary view is empty.</div>
              )}
            </div>
          </section>

          <section className="surface inspector-panel raw-panel">
            <PanelTitle
              title="Raw Firehose"
              detail={`${String(rawSinceClear.length)} since clear`}
            />
            <label className="switch-row">
              <input
                type="checkbox"
                checked={showRawPayloads}
                onChange={(event) =>
                  setShowRawPayloads(event.currentTarget.checked)
                }
              />
              <span>Show payload summaries</span>
            </label>
            <div className="raw-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setRawCursor(rawMessages.length)}
              >
                Clear View
              </button>
            </div>
            <div className="raw-list">
              {rawSinceClear.slice(-12).map((message, index) => (
                <RawMessageRow
                  key={`${String(message.historySerial)}-${String(index)}`}
                  message={message}
                  showPayload={showRawPayloads}
                />
              ))}
              {rawSinceClear.length === 0 && (
                <div className="empty-mini">No raw messages since clear.</div>
              )}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function useStreamingFlag(chatTransport: {
  readonly streaming: boolean;
  onStreamingChange(callback: (streaming: boolean) => void): () => void;
}): boolean {
  const [streaming, setStreaming] = useState(chatTransport.streaming);
  useEffect(() => {
    setStreaming(chatTransport.streaming);
    return chatTransport.onStreamingChange(setStreaming);
  }, [chatTransport]);
  return streaming;
}

function useRenderCount(): number {
  const count = useRef(0);
  count.current += 1;
  return count.current;
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}): React.ReactElement {
  return (
    <div className={`metric ${toneClass(tone)}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelTitle({
  title,
  detail,
}: {
  title: string;
  detail: string;
}): React.ReactElement {
  return (
    <header className="panel-title">
      <h2>{title}</h2>
      <span>{detail}</span>
    </header>
  );
}

function MessageBubble({
  message,
  selected,
  onSelect,
  onToolOutput,
  onToolApproval,
}: {
  message: UIMessage;
  selected: boolean;
  onSelect(id: string): void;
  onToolOutput(part: UIMessage["parts"][number]): void;
  onToolApproval(part: UIMessage["parts"][number], approved: boolean): void;
}): React.ReactNode {
  const parts = message.parts.filter(isVisiblePart);
  if (parts.length === 0) {
    return null;
  }
  return (
    <article
      className={`message ${message.role} ${selected ? "selected" : ""}`}
      onClick={() => onSelect(message.id)}
    >
      <div className="avatar">{message.role === "user" ? "U" : "A"}</div>
      <div className="bubble">
        <header>
          <span>{message.role === "user" ? "You" : "Assistant"}</span>
          <code>{message.id}</code>
        </header>
        {parts.map((part, index) => (
          <Part
            key={`${message.id}-${String(index)}`}
            part={part}
            onToolOutput={onToolOutput}
            onToolApproval={onToolApproval}
          />
        ))}
      </div>
    </article>
  );
}

function Part({
  part,
  onToolOutput,
  onToolApproval,
}: {
  part: UIMessage["parts"][number];
  onToolOutput(part: UIMessage["parts"][number]): void;
  onToolApproval(part: UIMessage["parts"][number], approved: boolean): void;
}): React.ReactNode {
  if (part.type === "text") {
    return part.text.trim() ? <p>{part.text}</p> : null;
  }
  if (part.type === "reasoning") {
    return part.text.trim() ? <p className="reasoning">{part.text}</p> : null;
  }
  if (part.type === "step-start") {
    return <div className="step-marker">step start</div>;
  }
  if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
    const record = recordPart(part);
    const state = stringField(record, "state") ?? "tool";
    const name =
      stringField(record, "toolName") ?? part.type.replace("tool-", "");
    const canAddOutput =
      state === "input-available" || state === "input-streaming";
    const canApprove = state === "approval-requested";
    return (
      <div className="tool-card">
        <div>
          <span>{name}</span>
          <strong>{state.replaceAll("-", " ")}</strong>
        </div>
        {(canAddOutput || canApprove) && (
          <div className="tool-actions">
            {canAddOutput && (
              <button
                type="button"
                className="tiny"
                onClick={() => onToolOutput(part)}
              >
                Output
              </button>
            )}
            {canApprove && (
              <>
                <button
                  type="button"
                  className="tiny"
                  onClick={() => onToolApproval(part, true)}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="tiny danger"
                  onClick={() => onToolApproval(part, false)}
                >
                  Deny
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }
  if (part.type === "file") {
    const record = recordPart(part);
    const url = stringField(record, "url") ?? "";
    return (
      <a className="attachment" href={url} target="_blank" rel="noreferrer">
        {stringField(record, "filename") ?? url}
      </a>
    );
  }
  if (part.type === "source-url") {
    const record = recordPart(part);
    const url = stringField(record, "url") ?? "";
    return (
      <a className="source" href={url} target="_blank" rel="noreferrer">
        {stringField(record, "title") ?? url}
      </a>
    );
  }
  if (part.type === "source-document") {
    const record = recordPart(part);
    return (
      <div className="source">
        {stringField(record, "title") ??
          stringField(record, "sourceId") ??
          "document"}
      </div>
    );
  }
  if (part.type === "data-error") {
    return (
      <p className="error-text">{String(recordPart(part).data ?? "Error")}</p>
    );
  }
  if (part.type.startsWith("data-")) {
    return <pre className="data-part">{safeJson(recordPart(part).data)}</pre>;
  }
  return null;
}

function RawMessageRow({
  message,
  showPayload,
}: {
  message: {
    name: string;
    action: string;
    historySerial: string | number;
    messageSerial: string;
    clientId?: string;
    timestamp: number;
    data: unknown;
    getTransportHeaders(): Record<string, unknown>;
    getCodecHeaders(): Record<string, unknown>;
  };
  showPayload: boolean;
}): React.ReactElement {
  const transportHeaders = message.getTransportHeaders();
  const codecHeaders = message.getCodecHeaders();
  const turnId =
    stringField(transportHeaders, "turn-id") ??
    stringField(transportHeaders, "turnId");
  const codecMessageId =
    stringField(codecHeaders, "msg-id") ??
    stringField(codecHeaders, "messageId");
  return (
    <div className="raw-row">
      <div>
        <strong>{message.name}</strong>
        <span>{message.action}</span>
      </div>
      <code>{turnId ?? codecMessageId ?? message.messageSerial}</code>
      <small>{formatTime(message.timestamp)}</small>
      {showPayload && <pre>{safeJson(message.data)}</pre>}
    </div>
  );
}

function KeyValue({
  rows,
}: {
  rows: readonly (readonly [string, string])[];
}): React.ReactElement {
  return (
    <dl className="key-value">
      {rows.map(([key, value]) => (
        <React.Fragment key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function isVisiblePart(part: UIMessage["parts"][number]): boolean {
  if (part.type === "text" || part.type === "reasoning") {
    const text = recordPart(part).text;
    return typeof text === "string" && text.trim().length > 0;
  }
  if (
    part.type === "dynamic-tool" ||
    part.type.startsWith("tool-") ||
    part.type === "file" ||
    part.type === "source-url" ||
    part.type === "source-document" ||
    part.type === "step-start"
  ) {
    return true;
  }
  return part.type === "data-error" || part.type.startsWith("data-");
}

function messageText(message: RenderableMessage): string {
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("\n")
    .trim();
}

function messagePreview(message: RenderableMessage): string {
  const text = messageText(message);
  if (text) {
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  }
  const firstPart = message.parts[0];
  return firstPart ? firstPart.type : "empty";
}

function lastMessageById(
  messages: readonly UIMessage[],
  id: string,
): UIMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.id === id) {
      return message;
    }
  }
  return undefined;
}

function lastAssistantHasPendingContinuation(
  messages: readonly UIMessage[],
): boolean {
  const message = messages.at(-1);
  if (message?.role !== "assistant") {
    return false;
  }
  const hasFinalText = message.parts.some(
    (part) =>
      part.type === "text" &&
      typeof recordPart(part).text === "string" &&
      String(recordPart(part).text).trim().length > 0,
  );
  if (hasFinalText) {
    return false;
  }
  return message.parts.some((part) => {
    if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-")) {
      return false;
    }
    const state = stringField(recordPart(part), "state");
    return (
      state === "approval-responded" ||
      state === "output-available" ||
      state === "output-error"
    );
  });
}

function branchValue(index: number, count: number): string {
  return count > 0 ? `${String(index + 1)} / ${String(count)}` : "none";
}

function formatTime(timestamp: number): string {
  if (timestamp <= 0) {
    return "no time";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function toneClass(tone: string | undefined): string {
  if (tone === "streaming" || tone === "submitted" || tone === "on") {
    return "hot";
  }
  if (tone === "error") {
    return "bad";
  }
  if (tone === "ready" || tone === "off") {
    return "good";
  }
  return "";
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function recordPart(part: UIMessage["parts"][number]): Record<string, unknown> {
  return part as unknown as Record<string, unknown>;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const rootElement = document.getElementById("root") as DemoRootElement;
rootElement.__sockudoDemoRoot ??= createRoot(rootElement);
rootElement.__sockudoDemoRoot.render(<App />);

interface DemoRootElement extends HTMLElement {
  __sockudoDemoRoot?: Root;
}
