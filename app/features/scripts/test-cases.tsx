/**
 * 테스트 케이스 탭(UI-SCR-04, SCR-03.03): 목록(이름·입력 요약·비교 방식·마지막 결과), 새 케이스·편집(입력·컨텍스트·기대 출력 JSON,
 * 비교 방식·필드·허용 오차), [모두 실행](API-SCR-11)과 케이스별 통과/실패·차이, 삭제. 조회 SCRIPT_READ, 쓰기 SCRIPT_WRITE.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Card, EmptyState, SelectField, Table, TextArea, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { ScriptOpsApi } from "./m5-api";
import { COMPARE_MODES, MAX_TEST_CASES, caseDiffLines, caseDraftOf, checkTestCase, emptyCaseDraft, type CaseErrors, type CaseRunResult, type CompareMode, type TestCase, type TestCaseDraft } from "./model/m5";
import { display } from "./model/script-model";

export function summarizeInput(input: unknown): string {
  const text = JSON.stringify(input ?? null);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

export function CaseDiff({ diff }: { diff: unknown }) {
  const { t } = useTranslation();
  const lines = caseDiffLines(diff);
  if (lines.length === 0) return null;
  return (
    <ul className="font-mono text-[12px] text-bad">
      {lines.map((line, i) => (
        <li key={`${line.key}-${i}`}>
          {line.kind === "changed"
            ? t("scripts.cases.diffChanged", { key: line.key, expected: display(line.expected), actual: display(line.actual) })
            : line.kind === "missing"
              ? t("scripts.cases.diffMissing", { key: line.key })
              : t("scripts.cases.diffExtra", { key: line.key })}
        </li>
      ))}
    </ul>
  );
}

export function TestCasesTab({ scriptId, initialCases, canWrite, api }: { scriptId: string; initialCases: TestCase[]; canWrite: boolean; api: Pick<ScriptOpsApi, "listCases" | "createCase" | "updateCase" | "deleteCase" | "runCases"> }) {
  const { t } = useTranslation();
  const [cases, setCases] = useState<TestCase[]>(initialCases);
  const [editing, setEditing] = useState<{ id: string | null; draft: TestCaseDraft } | null>(null);
  const [errors, setErrors] = useState<CaseErrors>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [run, setRun] = useState<{ passed: number; failed: number; results: Map<string, CaseRunResult> } | null>(null);

  const reload = async () => {
    const result = await api.listCases(scriptId);
    if (result.ok) setCases(result.data.responses ?? []);
  };

  const save = async () => {
    if (!editing) return;
    const checked = checkTestCase(editing.draft, cases, editing.id);
    setErrors(checked.errors);
    if (!checked.body) return;
    setBusy(true);
    const result = editing.id ? await api.updateCase(scriptId, editing.id, checked.body) : await api.createCase(scriptId, checked.body);
    setBusy(false);
    if (!result.ok) {
      const nameError = result.errors?.some((e) => e.field === "name");
      if (nameError) return setErrors({ name: "nameDuplicated" });
      return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    }
    setEditing(null);
    setNotice({ tone: "success", text: t("scripts.cases.saved") });
    await reload();
  };

  const remove = async (testCase: TestCase) => {
    if (!window.confirm(t("scripts.cases.confirmDelete", { name: testCase.name }))) return;
    const result = await api.deleteCase(scriptId, testCase.id);
    if (!result.ok) return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    setCases((list) => list.filter((c) => c.id !== testCase.id));
  };

  const runAll = async () => {
    setBusy(true);
    setNotice(null);
    const result = await api.runCases(scriptId, {});
    setBusy(false);
    if (!result.ok) return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    setRun({ passed: result.data.passed, failed: result.data.failed, results: new Map((result.data.results ?? []).map((r) => [String(r.caseId), r])) });
    await reload();
  };

  const set = (patch: Partial<TestCaseDraft>) => setEditing((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current));
  const errorOf = (key: keyof CaseErrors) => (errors[key] ? t(`scripts.cases.validation.${errors[key]}`, { max: MAX_TEST_CASES }) : undefined);

  return (
    <Card
      title={t("scripts.cases.title", { n: cases.length })}
      actions={
        canWrite && (
          <>
            <Button onClick={() => void runAll()} disabled={busy || cases.length === 0}>
              {busy ? t("scripts.cases.running") : t("scripts.cases.runAll")}
            </Button>
            <Button
              variant="primary"
              disabled={cases.length >= MAX_TEST_CASES}
              onClick={() => {
                setErrors({});
                setEditing({ id: null, draft: emptyCaseDraft() });
              }}
            >
              {t("scripts.cases.new")}
            </Button>
          </>
        )
      }
    >
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {run && (
        <Alert tone={run.failed > 0 ? "danger" : "success"}>
          {t("scripts.cases.runSummary", { passed: run.passed, total: run.passed + run.failed })}
        </Alert>
      )}
      {cases.length >= MAX_TEST_CASES && canWrite && <p className="text-[12px] text-warn">{t("scripts.cases.validation.quota", { max: MAX_TEST_CASES })}</p>}
      {cases.length === 0 ? (
        <EmptyState title={t("scripts.cases.empty")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("scripts.cases.name")}</th>
              <th>{t("scripts.cases.input")}</th>
              <th>{t("scripts.cases.compareMode")}</th>
              <th>{t("scripts.cases.lastResult")}</th>
              {canWrite && <th>{t("scripts.cases.actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => {
              const latest = run?.results.get(c.id);
              const passed = latest ? latest.passed : c.lastResult?.passed;
              const diff = latest ? latest.diff : c.lastResult?.diff;
              return (
                <tr key={c.id} data-testid={`case-${c.id}`}>
                  <td>{c.name}</td>
                  <td className="font-mono text-[12px]">{summarizeInput(c.input)}</td>
                  <td>
                    {t(`scripts.cases.modes.${c.compareMode}`)}
                    {c.compareMode === "TOLERANCE" && c.tolerance != null && ` ${c.tolerance}`}
                    {c.compareMode === "FIELDS" && c.compareFields && ` (${c.compareFields.join(", ")})`}
                  </td>
                  <td>
                    {passed === undefined || passed === null ? (
                      <span className="text-muted">–</span>
                    ) : passed ? (
                      <Badge tone="success">{`✔ ${t("scripts.cases.passed")}${c.lastResult?.versionNo ? ` v${c.lastResult.versionNo}` : ""}`}</Badge>
                    ) : (
                      <>
                        <Badge tone="danger">{`✖ ${t("scripts.cases.failed")}`}</Badge>
                        <CaseDiff diff={diff} />
                        {latest?.error?.message && <p className="text-[12px] text-bad">{latest.error.message}</p>}
                      </>
                    )}
                  </td>
                  {canWrite && (
                    <td className="whitespace-nowrap">
                      <Button
                        onClick={() => {
                          setErrors({});
                          setEditing({ id: c.id, draft: caseDraftOf(c) });
                        }}
                      >
                        {t("common.edit")}
                      </Button>{" "}
                      <Button variant="danger" onClick={() => void remove(c)}>
                        {t("common.delete")}
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {editing && (
        <section aria-label={t("scripts.cases.editor")} className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          {errors.quota && <Alert tone="danger">{errorOf("quota")}</Alert>}
          <TextField label={t("scripts.cases.name")} value={editing.draft.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} error={errorOf("name")} />
          <div className="grid gap-2 md:grid-cols-3">
            <TextArea label={t("scripts.cases.inputJson")} value={editing.draft.input} rows={6} spellCheck={false} onChange={(e) => set({ input: e.target.value })} error={errorOf("input")} />
            <TextArea label={t("scripts.cases.contextJson")} value={editing.draft.context} rows={6} spellCheck={false} onChange={(e) => set({ context: e.target.value })} error={errorOf("context")} />
            <TextArea label={t("scripts.cases.expectedJson")} value={editing.draft.expected} rows={6} spellCheck={false} onChange={(e) => set({ expected: e.target.value })} error={errorOf("expected")} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <SelectField label={t("scripts.cases.compareMode")} value={editing.draft.compareMode} onChange={(e) => set({ compareMode: e.target.value as CompareMode })}>
              {COMPARE_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`scripts.cases.modes.${mode}`)}
                </option>
              ))}
            </SelectField>
            {editing.draft.compareMode === "FIELDS" && (
              <TextField label={t("scripts.cases.compareFields")} value={editing.draft.compareFields} placeholder="metrics.temperature, metrics.humidity" onChange={(e) => set({ compareFields: e.target.value })} error={errorOf("compareFields")} />
            )}
            {editing.draft.compareMode === "TOLERANCE" && (
              <TextField label={t("scripts.cases.tolerance")} value={editing.draft.tolerance} inputMode="decimal" onChange={(e) => set({ tolerance: e.target.value })} error={errorOf("tolerance")} />
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </div>
        </section>
      )}
    </Card>
  );
}

/** [테스트 케이스로 저장]에 쓸 비교 방식 기본값 */
export const DEFAULT_SAVE_MODE: CompareMode = "EXACT";
