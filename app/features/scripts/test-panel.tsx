/**
 * 테스트 실행 패널(SCR-03.02, UI-SCR-02 오른쪽): 입력(최근 원본 / 직접 입력 JSON), 컨텍스트, [실행],
 * 결과 탭(출력·차이·로그·정보). 아무것도 저장하지 않는다(BR-SCR-08).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, SelectField, cx } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { ScriptApi } from "./api";
import { collapseLogs, diffRows, display, parseJsonInput, type ScriptKind, type TestRunResult } from "./model/script-model";

export interface RawMessageOption {
  id: string;
  receivedAt?: string;
  topic?: string;
  deviceName?: string | null;
  status?: string;
}

type Tab = "output" | "diff" | "logs" | "info";

export function TestPanel({
  kind,
  code,
  scriptId,
  recent,
  recentFailed,
  defaultContext,
  api,
  timezone,
  injected,
  onSaveCase,
}: {
  kind: ScriptKind;
  code: string;
  scriptId: string;
  recent: RawMessageOption[];
  recentFailed: boolean;
  defaultContext: unknown;
  api: Pick<ScriptApi, "testRun">;
  timezone: string;
  /** 오류 목록 [이 입력으로 테스트](SCR-05.01): 직접 입력에 채운다. seq가 바뀔 때마다 다시 채운다 */
  injected?: { input: unknown; seq: number } | null;
  /** [테스트 케이스로 저장](UI-SCR-02 → API-SCR-10). 실패하면 오류 문구를 돌려준다 */
  onSaveCase?: (payload: { input: unknown; context: unknown; expected: unknown }) => Promise<string | null>;
}) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<"recent" | "direct">(recent.length > 0 ? "recent" : "direct");
  const [rawId, setRawId] = useState(recent[0]?.id ?? "");
  const [input, setInput] = useState(kind === "TRANSFORM" ? '{\n  "externalId": "24e124136d151606",\n  "measuredAt": "2026-10-03T00:00:00Z",\n  "metrics": [{ "key": "temperature", "value": 22.3 }]\n}' : '{\n  "topic": "application/1/device/24e124136d151606/event/up",\n  "payload": {},\n  "receivedAt": "2026-10-03T00:00:00Z",\n  "source": { "code": "chirpstack-s3" }\n}');
  const [context, setContext] = useState(JSON.stringify(defaultContext ?? {}, null, 2));
  const [inputError, setInputError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestRunResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("output");
  const [lastRun, setLastRun] = useState<{ input: unknown; context: unknown } | null>(null);
  const [caseNotice, setCaseNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    if (!injected) return;
    setMode("direct");
    setInput(JSON.stringify(injected.input, null, 2));
    setResult(null);
    setCaseNotice(null);
  }, [injected]);

  const jsonMessage = (text: string) => {
    const parsed = parseJsonInput(text);
    if (parsed.ok) return { value: parsed.value };
    if (parsed.reason === "tooLarge") return { error: t("scripts.validation.jsonTooLarge") };
    if (parsed.reason === "empty") return { error: t("scripts.validation.jsonEmpty") };
    return { error: t("scripts.validation.json", { line: parsed.line, col: parsed.col }) };
  };

  const run = async () => {
    setInputError(null);
    setFailure(null);
    let payload: { input?: unknown; rawMessageId?: string };
    if (mode === "direct") {
      const parsed = jsonMessage(input);
      if ("error" in parsed) return setInputError(parsed.error ?? null);
      payload = { input: parsed.value };
    } else payload = { rawMessageId: rawId };
    let ctx: unknown = undefined;
    if (context.trim()) {
      const parsed = jsonMessage(context);
      if ("error" in parsed) return setInputError(parsed.error ?? null);
      ctx = parsed.value;
    }
    setRunning(true);
    setCaseNotice(null);
    setLastRun("input" in payload ? { input: payload.input, context: ctx } : null);
    const response = await api.testRun({ kind, code, scriptId, context: ctx, ...payload });
    setRunning(false);
    if (!response.ok) {
      setResult(null);
      return setFailure(errorText(t, response) ?? null);
    }
    setResult(response.data);
    setTab(response.data.ok ? "output" : "info");
  };

  const rows = diffRows(result?.diff);
  const logs = collapseLogs(result?.logs);
  const timedOut = result?.error?.code === "SCRIPT_TIMEOUT";
  const tabs: Tab[] = ["output", "diff", "logs", "info"];

  return (
    <section aria-label={t("scripts.test.title")} className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold">{t("scripts.test.title")}</h2>
      <fieldset className="flex gap-3 text-[12.5px]">
        <legend className="sr-only">{t("scripts.test.input")}</legend>
        <label className="flex items-center gap-1">
          <input type="radio" name="test-input" checked={mode === "recent"} onChange={() => setMode("recent")} disabled={recent.length === 0} />
          {t("scripts.test.recent")}
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="test-input" checked={mode === "direct"} onChange={() => setMode("direct")} />
          {t("scripts.test.direct")}
        </label>
      </fieldset>
      {recentFailed && <p className="text-[12px] text-muted">{t("scripts.test.noRecent")}</p>}
      {mode === "recent" ? (
        <SelectField label={t("scripts.test.pickRecent")} value={rawId} onChange={(e) => setRawId(e.target.value)}>
          {recent.map((m) => (
            <option key={m.id} value={m.id}>
              {`#${m.id} · ${formatDateTime(m.receivedAt, timezone, i18n.language, true)} · ${m.deviceName ?? m.topic ?? ""}${m.status ? ` · ${m.status}` : ""}`}
            </option>
          ))}
        </SelectField>
      ) : (
        <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
          {t("scripts.test.json")}
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={7} spellCheck={false} className="rounded-md border border-line bg-panel p-2 font-mono text-[12.5px] text-text" />
        </label>
      )}
      <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
        {t("scripts.test.context")}
        <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={4} spellCheck={false} className="rounded-md border border-line bg-panel p-2 font-mono text-[12.5px] text-text" />
      </label>
      {inputError && (
        <p role="alert" className="text-[12px] text-bad">
          {inputError}
        </p>
      )}
      <div>
        <Button variant="primary" onClick={() => void run()} disabled={running || (mode === "recent" && !rawId)}>
          {running ? t("scripts.test.running") : t("scripts.test.run")}
        </Button>
      </div>
      {failure && <Alert tone="danger">{failure}</Alert>}
      {onSaveCase && result?.ok && (
        <div className="flex flex-col gap-1">
          <div>
            <Button
              disabled={!lastRun}
              title={lastRun ? undefined : t("scripts.cases.saveNeedsDirect")}
              onClick={() => {
                if (!lastRun) return;
                void onSaveCase({ input: lastRun.input, context: lastRun.context, expected: result.output ?? null }).then((error) =>
                  setCaseNotice(error ? { tone: "danger", text: error } : { tone: "success", text: t("scripts.cases.savedFromRun") }),
                );
              }}
            >
              {t("scripts.cases.saveFromRun")}
            </Button>
          </div>
          {!lastRun && <p className="text-[12px] text-muted">{t("scripts.cases.saveNeedsDirect")}</p>}
          {caseNotice && <Alert tone={caseNotice.tone}>{caseNotice.text}</Alert>}
        </div>
      )}
      {result && (
        <div className="rounded-md border border-line">
          <div className="flex items-center gap-1 border-b border-line px-2" role="tablist">
            {tabs.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cx("-mb-px border-b-2 px-2 py-1.5 text-[12.5px]", tab === key ? "border-accent font-semibold text-accent" : "border-transparent text-muted")}
              >
                {t(`scripts.test.tabs.${key}`)}
              </button>
            ))}
            <span className="ml-auto">
              {timedOut && <Badge tone="danger">{t("scripts.test.timeout")}</Badge>}
              {result.error && !timedOut && <Badge tone="danger">{t("scripts.test.failed")}</Badge>}
            </span>
          </div>
          <div className="p-2 text-[12.5px]" role="tabpanel">
            {result.error && (
              <p role="alert" className="mb-2 text-bad">
                {`${result.error.message}${result.error.line ? ` (${result.error.line}:${result.error.col ?? 1})` : ""}`}
              </p>
            )}
            {tab === "output" && <pre className="max-h-64 overflow-auto font-mono">{result.output === undefined || result.output === null ? "null" : JSON.stringify(result.output, null, 2)}</pre>}
            {tab === "diff" &&
              (rows.length === 0 ? (
                <p className="text-muted">{t("scripts.test.noDiff")}</p>
              ) : (
                <ul>
                  {rows.map((row) => (
                    <li key={`${row.kind}:${row.key}`} data-diff={row.kind} className={cx("font-mono", row.kind === "added" ? "text-good" : row.kind === "removed" ? "text-bad" : "text-warn")}>
                      {`${t(`scripts.test.${row.kind}`)} ${row.key}: ${row.kind === "changed" ? `${display(row.from)} → ${display(row.to)}` : display(row.kind === "added" ? row.to : row.from)}`}
                    </li>
                  ))}
                </ul>
              ))}
            {tab === "logs" &&
              (logs.length === 0 ? (
                <p className="text-muted">{t("scripts.test.noLogs")}</p>
              ) : (
                <ul className="font-mono">
                  {logs.map((log, i) => (
                    <li key={i}>
                      {log.message}
                      {log.count > 1 && <span className="ml-2 text-muted">{`x ${log.count}`}</span>}
                    </li>
                  ))}
                </ul>
              ))}
            {tab === "info" && (
              <p className="text-muted">
                {t("scripts.test.duration", { ms: result.durationMs ?? 0 })} · {t("scripts.test.bytes", { kb: ((result.outputBytes ?? 0) / 1024).toFixed(1) })}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
