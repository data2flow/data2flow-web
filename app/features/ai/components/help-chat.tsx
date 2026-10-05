/**
 * 도움말 대화(UI-AIA-01의 도움말 모드, AIA-09.01, API-AIA-02 `mode: HELP`·API-AIA-10). 모든 화면 오른쪽 아래 버튼 → 오른쪽 패널(420px).
 * M6는 도움말 모드만 연다(데이터 질문 AIA-03은 M7, 서버도 DATA를 400으로 막는다). 현재 화면 주소를 맥락(screenId)으로 함께 보낸다.
 * - 답은 스트리밍(`delta`), 근거 문서는 `citation` 카드(제목·링크)
 * - 503이면 "AI 서비스에 잠시 연결할 수 없습니다" + [다시 시도], 429면 한도 안내와 입력 막기, 조직 AI가 꺼져 있으면 버튼을 숨긴다
 * - Esc로 닫고 포커스를 버튼으로 돌린다. 대화 목록·삭제·[전체 삭제](확인)
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { Alert, Button, cx } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { AiApi } from "../api";
import type { ConversationSummary } from "../model/types";
import { AiMarkdown } from "./ai-markdown";

const MAX_LENGTH = 2000;

interface ChatMessage {
  role: "USER" | "ASSISTANT";
  content: string;
  citations: { target?: string; link?: string | null; tool?: string }[];
}

export function HelpPanel({ api, onClose, screenId }: { api: AiApi; onClose: () => void; screenId: string }) {
  const { t } = useTranslation();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ code: string; message?: string } | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [list, setList] = useState<ConversationSummary[] | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => textarea.current?.focus(), []);

  const send = async (question: string) => {
    const content = question.trim();
    if (!content || content.length > MAX_LENGTH || busy) return;
    setFailure(null);
    setBusy(true);
    setLastQuestion(content);
    setInput("");
    setMessages((m) => [...m, { role: "USER", content, citations: [] }, { role: "ASSISTANT", content: "", citations: [] }]);
    const controller = new AbortController();
    abort.current = controller;
    const outcome = await api.ask(
      conversationId,
      { content, mode: "HELP", context: { screenId } },
      (e) => {
        if (e.event === "conversation") setConversationId(String((e.data as { conversationId?: string })?.conversationId ?? ""));
        else if (e.event === "delta")
          setMessages((m) => {
            const last = m[m.length - 1];
            return [...m.slice(0, -1), { ...last, content: last.content + String((e.data as { text?: string })?.text ?? "") }];
          });
        else if (e.event === "citation")
          setMessages((m) => {
            const last = m[m.length - 1];
            return [...m.slice(0, -1), { ...last, citations: [...last.citations, e.data as ChatMessage["citations"][number]] }];
          });
      },
      controller.signal,
    );
    abort.current = null;
    setBusy(false);
    if (!outcome.ok) {
      setMessages((m) => (m[m.length - 1]?.role === "ASSISTANT" && !m[m.length - 1].content ? m.slice(0, -1) : m));
      setFailure({ code: outcome.code, message: outcome.message });
    }
  };

  const openList = async () => {
    setShowList((v) => !v);
    const res = await api.conversations();
    setList(res.ok ? res.data.responses : []);
  };
  const openConversation = async (id: string) => {
    const res = await api.conversation(id);
    if (!res.ok) return;
    setConversationId(id);
    setMessages(res.data.messages.filter((m) => m.role !== "TOOL").map((m) => ({ role: m.role as "USER", content: m.content, citations: (m.citations ?? []) as ChatMessage["citations"] })));
    setShowList(false);
  };
  const remove = async (id: string) => {
    await api.deleteConversation(id);
    setList((l) => (l ?? []).filter((c) => c.conversationId !== id));
    if (id === conversationId) {
      setConversationId(null);
      setMessages([]);
    }
  };
  const removeAll = async () => {
    setConfirmAll(false);
    await api.deleteAllConversations();
    setList([]);
    setConversationId(null);
    setMessages([]);
  };

  const quota = failure?.code === "AI_QUOTA_EXCEEDED";
  const examples = [1, 2, 3, 4].map((n) => t(`ai.help.example${n}`));
  return (
    <aside role="dialog" aria-modal="false" aria-label={t("ai.help.title")} onKeyDown={(e) => e.key === "Escape" && onClose()} className="fixed top-0 right-0 bottom-0 z-40 flex w-full max-w-[420px] flex-col border-l border-line bg-panel shadow-lg">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[14px] font-semibold">{t("ai.help.title")}</h2>
        <span className="text-[11.5px] text-muted">{t("ai.help.mode")}</span>
        <span className="ml-auto flex gap-1">
          <Button
            variant="ghost"
            onClick={() => {
              setConversationId(null);
              setMessages([]);
              setFailure(null);
            }}
          >
            {t("ai.help.new")}
          </Button>
          <Button variant="ghost" aria-expanded={showList} onClick={() => void openList()}>
            {t("ai.help.list")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        </span>
      </header>
      {showList && (
        <div className="max-h-64 overflow-auto border-b border-line p-3 text-[13px]">
          {list === null ? (
            <p className="text-muted">{t("common.loading")}</p>
          ) : list.length === 0 ? (
            <p className="text-muted">{t("ai.help.noConversations")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {list.map((c) => (
                <li key={c.conversationId} className="flex items-center gap-2">
                  <button type="button" className="flex-1 truncate text-left text-accent hover:underline" onClick={() => void openConversation(c.conversationId)}>
                    {c.title}
                  </button>
                  <Button variant="ghost" aria-label={t("ai.help.deleteOne", { title: c.title })} onClick={() => void remove(c.conversationId)}>
                    {t("common.delete")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {list && list.length > 0 && (
            <div className="mt-2 flex justify-end">
              {confirmAll ? (
                <span className="flex items-center gap-2">
                  <span>{t("ai.help.deleteAllConfirm")}</span>
                  <Button variant="danger" onClick={() => void removeAll()}>
                    {t("common.yes")}
                  </Button>
                  <Button onClick={() => setConfirmAll(false)}>{t("common.no")}</Button>
                </span>
              ) : (
                <Button variant="danger" onClick={() => setConfirmAll(true)}>
                  {t("ai.help.deleteAll")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex-1 overflow-auto p-3" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-muted">{t("ai.help.intro")}</p>
            <div className="flex flex-wrap gap-1.5">
              {examples.map((q) => (
                <button key={q} type="button" className="rounded-full border border-line px-2.5 py-1 text-[12px] hover:border-accent" onClick={() => void send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <li key={i} className={cx("rounded-lg px-3 py-2", m.role === "USER" ? "ml-8 bg-accent-soft" : "mr-4 border border-line")}>
                {m.role === "USER" ? <p className="whitespace-pre-wrap text-[13px]">{m.content}</p> : <AiMarkdown text={m.content || "…"} />}
                {m.citations.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1" aria-label={t("ai.help.sources")}>
                    {m.citations.map((c, j) => (
                      <li key={j} className="rounded border border-line bg-bg px-2 py-1 text-[12px]">
                        <span className="text-muted">{t("ai.help.source")}</span> {c.target}
                        {c.link && c.link.startsWith("/") && (
                          <>
                            {" "}
                            <Link to={c.link} className="text-accent underline">
                              {t("ai.help.open")}
                            </Link>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
        {failure && (
          <div className="mt-3">
            {failure.code === "AI_PROVIDER_UNAVAILABLE" || failure.code === "SERVICE_UNAVAILABLE" ? (
              <Alert tone="warning">
                {t("ai.help.unavailable")}{" "}
                {lastQuestion && (
                  <Button variant="ghost" onClick={() => void send(lastQuestion)}>
                    {t("common.retry")}
                  </Button>
                )}
              </Alert>
            ) : (
              <Alert tone={quota ? "warning" : "danger"}>{errorText(t, failure)}</Alert>
            )}
          </div>
        )}
      </div>
      <form
        className="flex flex-col gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          ref={textarea}
          aria-label={t("ai.help.input")}
          rows={2}
          value={input}
          disabled={quota}
          placeholder={t("ai.help.placeholder")}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
          className="w-full resize-none rounded-md border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
        />
        {input.length > MAX_LENGTH && (
          <p role="alert" className="text-[12px] text-bad">
            {t("ai.help.tooLong", { max: MAX_LENGTH })}
          </p>
        )}
        <div className="flex justify-end gap-2">
          {busy ? (
            <Button onClick={() => abort.current?.abort()}>{t("ai.help.stop")}</Button>
          ) : (
            <Button type="submit" variant="primary" disabled={quota || !input.trim() || input.length > MAX_LENGTH}>
              {t("ai.help.send")}
            </Button>
          )}
        </div>
      </form>
    </aside>
  );
}

/** 오른쪽 아래 [도움말] 버튼. 처음 그릴 때 대화 목록을 한 번 읽어 조직 AI가 꺼져 있으면(409 AI_DISABLED) 버튼을 숨긴다 */
export function HelpLauncher({ api }: { api: AiApi }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    void api.conversations().then((res) => {
      if (live && !res.ok && (res.code === "AI_DISABLED" || res.status === 403)) setHidden(true);
    });
    return () => {
      live = false;
    };
  }, [api]);
  if (hidden) return null;
  return (
    <>
      {!open && (
        <button ref={button} type="button" onClick={() => setOpen(true)} className="fixed right-5 bottom-5 z-30 rounded-full border border-accent bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-md hover:opacity-90">
          {t("ai.help.launcher")}
        </button>
      )}
      {open && (
        <HelpPanel
          api={api}
          screenId={pathname}
          onClose={() => {
            setOpen(false);
            setTimeout(() => button.current?.focus(), 0);
          }}
        />
      )}
    </>
  );
}
