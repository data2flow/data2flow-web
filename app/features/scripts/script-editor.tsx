/**
 * 스크립트 편집기 화면 본문(UI-SCR-02, SCR-03.01·03.02·04.05): Monaco 편집기 + 입력 중 정적 검사(500ms) + 문제 목록,
 * [저장](DRAFT, 충돌 시 비교 대화상자), [배포](오류가 있으면 비활성, 메모 필수, ADMIN 강제 배포), 오른쪽 테스트 패널.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CodeEditor, type EditorApi, type EditorFactory } from "~/components/code-editor";
import { Alert, Badge, Button, Dialog, TextArea, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { latestVersionNo, type ScriptApi, type ScriptDetail } from "./api";
import { CONTRACT_TYPES } from "./model/contract-types";
import { CODE_LIMIT_BYTES, byteSize, canDeploy, checkMemo, createDebouncer, requiredFunctionProblem, type Problem } from "./model/script-model";
import { ProblemsList } from "./problems-list";
import { TestPanel, type RawMessageOption } from "./test-panel";

export interface ScriptEditorProps {
  script: ScriptDetail;
  canWrite: boolean;
  canForce: boolean;
  recent: RawMessageOption[];
  recentFailed: boolean;
  timezone: string;
  api: ScriptApi;
  /** 테스트에서 Monaco 대신 textarea를 쓴다 */
  editorFactory?: EditorFactory;
  /** 정적 검사 대기(ms) */
  debounceMs?: number;
}

/** 서버 결과에 필수 함수 검사(화면 쪽)를 더한다. 서버가 같은 문제를 주면 하나만 */
function withRequired(kind: ScriptDetail["kind"], code: string, problems: Problem[], missingMessage: (fn: string) => string): Problem[] {
  const required = requiredFunctionProblem(kind, code);
  const server = problems.filter((p) => p.code !== "SCRIPT_FUNCTION_MISSING");
  return required ? [{ ...required, message: missingMessage(required.message) }, ...server] : server;
}

export function ScriptEditor({ script, canWrite, canForce, recent, recentFailed, timezone, api, editorFactory, debounceMs = 500 }: ScriptEditorProps) {
  const { t } = useTranslation();
  const missing = useCallback((fn: string) => t("scripts.problems.missingFunction", { fn }), [t]);
  const initialCode = script.draft?.code ?? script.activeVersion?.code ?? "";
  const [code, setCode] = useState(initialCode);
  const [savedCode, setSavedCode] = useState(initialCode);
  const [baseVersionNo, setBaseVersionNo] = useState(latestVersionNo(script));
  const [draft, setDraft] = useState(script.draft ? { versionId: script.draft.versionId, versionNo: script.draft.versionNo } : null);
  const [active, setActive] = useState(script.activeVersion ? { versionId: script.activeVersion.versionId, versionNo: script.activeVersion.versionNo } : null);
  const [problems, setProblems] = useState<Problem[]>(() => withRequired(script.kind, initialCode, script.draft?.staticCheck?.problems ?? [], missing));
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [conflict, setConflict] = useState<{ code: string; versionNo: number } | null>(null);
  const [deployTarget, setDeployTarget] = useState<{ versionId: string; versionNo: number } | null>(null);
  const editorApi = useRef<EditorApi | null>(null);
  const dirty = code !== savedCode;

  const checkSeq = useRef(0);
  const debouncer = useMemo(
    () =>
      createDebouncer<string>(async (value) => {
        const seq = ++checkSeq.current;
        setChecking(true);
        const result = await api.check(script.kind, value);
        if (seq !== checkSeq.current) return;
        setChecking(false);
        if (result.ok) setProblems(withRequired(script.kind, value, result.data.problems ?? [], missing));
      }, debounceMs),
    [api, script.kind, missing, debounceMs],
  );
  useEffect(() => () => debouncer.cancel(), [debouncer]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = t("scripts.editor.leaveWarning");
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, t]);

  const onChange = (value: string) => {
    setCode(value);
    if (!canWrite) return;
    setProblems((current) => withRequired(script.kind, value, current, missing));
    debouncer.schedule(value);
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    const result = await api.save(script.id, { code, baseVersionNo });
    setSaving(false);
    if (result.ok) {
      setSavedCode(code);
      setBaseVersionNo(result.data.versionNo);
      setDraft({ versionId: result.data.versionId, versionNo: result.data.versionNo });
      setProblems(withRequired(script.kind, code, result.data.staticCheck?.problems ?? [], missing));
      setNotice({ tone: "success", text: t("scripts.editor.saved", { n: result.data.versionNo }) });
      return;
    }
    if (result.status === 409) {
      const latest = await api.detail(script.id);
      if (latest.ok) setConflict({ code: latest.data.draft?.code ?? latest.data.activeVersion?.code ?? "", versionNo: latestVersionNo(latest.data) });
      else setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
      return;
    }
    setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
  };

  const tooLarge = byteSize(code) > CODE_LIMIT_BYTES;
  const deployable = canDeploy(problems, Boolean(draft));
  const processed = (script.usage?.bindings ?? []).reduce((sum, b) => sum + (b.processed24h ?? 0), 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone="info">{t(`scripts.kind.${script.kind}`)}</Badge>
          <span className="font-mono text-[12.5px]">
            {active ? t("scripts.editor.active", { n: active.versionNo }) : t("scripts.editor.noActive")}
            {draft && ` · ${t("scripts.editor.draft", { n: draft.versionNo })}`}
          </span>
          {dirty && (
            <span className="text-accent" title={t("scripts.editor.unsaved")} aria-label={t("scripts.editor.unsaved")}>
              ●
            </span>
          )}
          {(script.bindings ?? []).map((b) => (
            <Badge key={`${b.targetType}:${b.targetId}`} tone="neutral">{`${b.targetType} ${b.name ?? b.targetId}`}</Badge>
          ))}
          <span className={tooLarge ? "ml-auto text-[12px] text-bad" : "ml-auto text-[12px] text-muted"}>
            {tooLarge ? t("scripts.editor.tooLarge") : t("scripts.editor.size", { kb: (byteSize(code) / 1024).toFixed(1) })}
          </span>
          {canWrite && (
            <>
              <Button onClick={() => void save()} disabled={saving || !dirty || tooLarge}>
                {saving ? t("scripts.editor.saving") : t("scripts.editor.save")}
              </Button>
              <Button variant="primary" onClick={() => setDeployTarget(draft)} disabled={!deployable}>
                {t("scripts.editor.deploy")}
              </Button>
            </>
          )}
        </div>
        {!canWrite && <Alert tone="info">{t("scripts.editor.readOnly")}</Alert>}
        {canWrite && !deployable && problems.some((p) => p.severity === "ERROR") && <p className="mb-1 text-[12px] text-muted">{t("scripts.deploy.blocked")}</p>}
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        <div className="mt-2">
          <CodeEditor label={t("scripts.editor.code")} value={code} onChange={onChange} problems={problems} readOnly={!canWrite} contractTypes={CONTRACT_TYPES} factory={editorFactory} apiRef={editorApi} />
        </div>
        <ProblemsList problems={problems} checking={checking} onSelect={(p) => editorApi.current?.reveal(p.line, p.col)} />
      </div>
      {canWrite && <TestPanel kind={script.kind} code={code} scriptId={script.id} recent={recent} recentFailed={recentFailed} defaultContext={{ device: { attributes: {} }, last: {}, config: script.config ?? {} }} api={api} timezone={timezone} />}

      <Dialog title={t("scripts.conflict.title")} open={conflict !== null} onClose={() => setConflict(null)}>
        <p className="text-[13px]">{t("scripts.conflict.body")}</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[12px] font-semibold">{t("scripts.conflict.mine")}</p>
            <pre data-testid="conflict-mine" className="max-h-48 overflow-auto rounded border border-line p-1 font-mono text-[11.5px]">{code}</pre>
          </div>
          <div>
            <p className="text-[12px] font-semibold">{t("scripts.conflict.latest", { n: conflict?.versionNo ?? 0 })}</p>
            <pre data-testid="conflict-latest" className="max-h-48 overflow-auto rounded border border-line p-1 font-mono text-[11.5px]">{conflict?.code}</pre>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => {
              if (!conflict) return;
              setCode(conflict.code);
              setSavedCode(conflict.code);
              setBaseVersionNo(conflict.versionNo);
              setConflict(null);
            }}
          >
            {t("scripts.conflict.reload")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!conflict) return;
              setBaseVersionNo(conflict.versionNo);
              setConflict(null);
            }}
          >
            {t("scripts.conflict.keepMine")}
          </Button>
        </div>
      </Dialog>

      {deployTarget && (
        <DeployDialog
          script={script}
          draft={deployTarget}
          activeVersionId={active?.versionId ?? null}
          problems={problems}
          dirty={dirty}
          processed={processed}
          canForce={canForce}
          api={api}
          onClose={() => setDeployTarget(null)}
          onDeployed={(versionId) => {
            setActive({ versionId, versionNo: deployTarget.versionId === versionId ? deployTarget.versionNo : (active?.versionNo ?? 0) });
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}

function DeployDialog({
  script,
  draft,
  activeVersionId,
  problems,
  dirty,
  processed,
  canForce,
  api,
  onClose,
  onDeployed,
}: {
  script: ScriptDetail;
  draft: { versionId: string; versionNo: number };
  activeVersionId: string | null;
  problems: Problem[];
  dirty: boolean;
  processed: number;
  canForce: boolean;
  api: Pick<ScriptApi, "deploy">;
  onClose: () => void;
  onDeployed: (versionId: string) => void;
}) {
  const { t } = useTranslation();
  const [memo, setMemo] = useState("");
  const [force, setForce] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [memoError, setMemoError] = useState(false);
  const [reasonError, setReasonError] = useState(false);
  const [applied, setApplied] = useState<{ reported: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const hasErrors = problems.some((p) => p.severity === "ERROR");

  const submit = async (forced: boolean) => {
    const memoOk = checkMemo(memo);
    const reasonOk = !forced || reason.trim().length >= 2;
    setMemoError(!memoOk);
    setReasonError(!reasonOk);
    if (!memoOk || !reasonOk) return;
    setBusy(true);
    setError(null);
    const result = await api.deploy(script.id, { versionId: draft.versionId, memo: memo.trim(), baseActiveVersionId: activeVersionId, ...(forced ? { force: true, forceReason: reason.trim() } : {}) });
    setBusy(false);
    if (!result.ok) return setError(errorText(t, result) ?? null);
    setApplied(result.data.applied ?? { reported: 0, total: 0 });
    onDeployed(result.data.activeVersionId);
  };

  return (
    <Dialog title={t("scripts.deploy.title")} open onClose={onClose}>
      <p className="text-[13px]">{t("scripts.deploy.target", { n: draft.versionNo })}</p>
      <p className="text-[13px]">
        {t("scripts.deploy.check")}: <span className={hasErrors ? "text-bad" : "text-good"}>{hasErrors ? `✖ ${t("scripts.deploy.checkFail")}` : `✔ ${t("scripts.deploy.checkOk")}`}</span>
      </p>
      <p className="text-[12.5px] text-muted">{t("scripts.deploy.impact", { bindings: script.bindings?.length ?? 0, processed })}</p>
      {dirty && <Alert tone="warning">{t("scripts.deploy.unsavedNote")}</Alert>}
      {applied ? (
        <Alert tone="success">{t("scripts.deploy.applied", applied)}</Alert>
      ) : (
        <>
          <TextArea label={t("scripts.deploy.memo")} value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} error={memoError ? t("scripts.validation.memo") : undefined} />
          {canForce && (
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              {t("scripts.deploy.force")}
            </label>
          )}
          {canForce && force && <TextField label={t("scripts.deploy.forceReason")} value={reason} onChange={(e) => setReason(e.target.value)} error={reasonError ? t("scripts.validation.forceReason") : undefined} />}
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            {canForce && force ? (
              <Button variant="danger" disabled={busy} onClick={() => void submit(true)}>
                {t("scripts.deploy.force")}
              </Button>
            ) : (
              <Button variant="primary" disabled={busy || hasErrors} onClick={() => void submit(false)}>
                {t("scripts.deploy.submit")}
              </Button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
