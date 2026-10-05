/**
 * 수식 항목 화면(UI-SCR-07, SCR-01.06): 목록(결과 키·표시 이름·단위·수식·대상·상태)과 편집(결과 키, 표시 이름, 단위, 적용 대상 모델/기기/공간,
 * 수식 입력 — 측정 키·함수 자동완성과 칩, 입력 중 문법 검사와 오류 위치 밑줄, [미리 보기] 최근 24시간 결과 선 + 입력 항목 선, [저장·배포]).
 * 조회 SCRIPT_READ(OPERATOR), 작성 SCRIPT_WRITE(INTEGRATOR·ADMIN). API-SCR-20·21.
 */
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TimeseriesChart, type ChartFactory } from "~/components/charts/timeseries-chart";
import { Alert, Badge, Button, Card, EmptyState, SelectField, Table, TextField } from "~/components/ui";
import type { ChartSeries } from "~/lib/chart-model";
import { errorText } from "~/lib/error-text";
import type { FormulaApi, FormulaBody, FormulaMetric, FormulaPreview, FormulaTarget } from "./m5-api";
import { FORMULA_FUNCTIONS, FORMULA_MAX_LENGTH, checkFormula, checkResultKey, insertAt, suggestions, wordAt, type FormulaCheck } from "./model/formula";

export interface TargetOption {
  id: string;
  name: string;
}

export interface FormulaEditorProps {
  formulas: FormulaMetric[];
  targets: Record<FormulaTarget, TargetOption[]>;
  /** 표준 측정 키(자동완성·키 검사·결과 키 중복 검사) */
  metricKeys: string[];
  canWrite: boolean;
  timezone: string;
  api: FormulaApi;
  /** 저장·삭제 뒤 목록 다시 읽기 */
  onChanged: () => void;
  chartFactory?: ChartFactory;
}

interface Draft {
  id: string | null;
  resultKey: string;
  displayName: string;
  unit: string;
  targetType: FormulaTarget;
  targetId: string;
  expression: string;
  status: "ACTIVE" | "DISABLED";
  version?: number;
}

const TARGETS: FormulaTarget[] = ["MODEL", "DEVICE", "SPACE"];
const PREVIEW_HOURS = [1, 6, 12, 24];

function emptyDraft(targets: FormulaEditorProps["targets"]): Draft {
  return { id: null, resultKey: "", displayName: "", unit: "", targetType: "MODEL", targetId: targets.MODEL[0]?.id ?? "", expression: "", status: "ACTIVE" };
}

/** 오류 위치를 밑줄로 보여 준다(TC-SCR-019) */
export function MarkedExpression({ expression, check }: { expression: string; check: FormulaCheck }) {
  if (check.ok) return null;
  const lines = expression.split("\n");
  const offset = lines.slice(0, check.line - 1).reduce((sum, l) => sum + l.length + 1, 0) + check.col - 1;
  const end = Math.min(expression.length, offset + Math.max(1, /^[A-Za-z_][A-Za-z0-9_]*/.exec(expression.slice(offset))?.[0].length ?? 1));
  return (
    <pre aria-hidden="true" className="mt-1 overflow-x-auto font-mono text-[12.5px] text-muted">
      {expression.slice(0, offset)}
      <span data-testid="formula-error-mark" className="text-bad-ink underline decoration-wavy">
        {expression.slice(offset, end) || " "}
      </span>
      {expression.slice(end)}
    </pre>
  );
}

export function FormulaEditor({ formulas, targets, metricKeys, canWrite, timezone, api, onChanged, chartFactory }: FormulaEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cursor, setCursor] = useState(0);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Partial<Record<"displayName" | "targetId", string>>>({});
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [preview, setPreview] = useState<FormulaPreview | null>(null);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  const check = useMemo(() => (draft ? checkFormula(draft.expression, metricKeys) : null), [draft, metricKeys]);
  const word = draft ? wordAt(draft.expression, cursor) : { word: "", start: 0 };
  const items = draft ? suggestions(word.word, metricKeys) : [];

  const formulaMessage = (c: FormulaCheck | null) => (c && !c.ok ? `${t(`scripts.formulas.errors.${c.code}`, { name: "", token: "", min: 0, max: FORMULA_MAX_LENGTH, ...c.params })} (${c.line}:${c.col})` : null);

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const insert = (text: string, replaceWord = false) => {
    if (!draft) return;
    const base = replaceWord ? `${draft.expression.slice(0, word.start)}${draft.expression.slice(cursor)}` : draft.expression;
    const at = replaceWord ? word.start : cursor;
    const next = insertAt(base, at, text);
    set({ expression: next.text });
    setCursor(next.cursor);
    queueMicrotask(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const validate = (): FormulaBody | null => {
    if (!draft) return null;
    const taken = [...metricKeys, ...formulas.filter((f) => f.id !== draft.id).map((f) => f.resultKey)];
    const keyProblem = draft.id ? null : checkResultKey(draft.resultKey, taken);
    setKeyError(keyProblem ? t(`scripts.formulas.validation.${keyProblem}`) : null);
    const fields: Partial<Record<"displayName" | "targetId", string>> = {};
    if (!draft.displayName.trim() || draft.displayName.trim().length > 80) fields.displayName = t("scripts.formulas.validation.displayName");
    if (!draft.targetId) fields.targetId = t("scripts.formulas.validation.target");
    setFieldError(fields);
    if (keyProblem || Object.keys(fields).length > 0 || !check?.ok) return null;
    return {
      resultKey: draft.resultKey,
      displayName: draft.displayName.trim(),
      ...(draft.unit.trim() ? { unit: draft.unit.trim() } : {}),
      expression: draft.expression.trim(),
      targetType: draft.targetType,
      targetId: draft.targetId,
      status: draft.status,
      ...(draft.id ? { baseVersion: draft.version } : {}),
    };
  };

  const runPreview = async () => {
    if (!draft || !check?.ok || !draft.targetId) return;
    setBusy(true);
    const result = await api.preview({ expression: draft.expression.trim(), targetType: draft.targetType, targetId: draft.targetId, hours });
    setBusy(false);
    if (!result.ok) return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    setNotice(null);
    setPreview(result.data);
  };

  const save = async () => {
    const body = validate();
    if (!body || !draft) return;
    setBusy(true);
    const result = draft.id ? await api.update(draft.id, body) : await api.create(body);
    setBusy(false);
    if (!result.ok) {
      if (result.code === "SCRIPT_FORMULA_KEY_CONFLICT") return setKeyError(t("scripts.formulas.validation.conflict"));
      if (result.code === "VERSION_CONFLICT") return setNotice({ tone: "warning", text: t("scripts.formulas.versionConflict") });
      return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    }
    setDraft(null);
    setPreview(null);
    setNotice({ tone: "success", text: t("scripts.formulas.saved", { key: result.data.resultKey }) });
    onChanged();
  };

  const remove = async (formula: FormulaMetric) => {
    if (!window.confirm(t("scripts.formulas.confirmDelete", { key: formula.resultKey }))) return;
    const result = await api.remove(formula.id);
    if (!result.ok) return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    if (draft?.id === formula.id) setDraft(null);
    onChanged();
  };

  const previewSeries: ChartSeries[] = useMemo(() => {
    if (!preview || !draft) return [];
    const toPoints = (rows: { t: string; value: number | null }[] | null | undefined) => (rows ?? []).map((p) => [p.t, p.value, null] as [string, number | null, null]);
    return [
      { key: draft.resultKey || "result", label: draft.displayName || draft.resultKey || t("scripts.formulas.result"), unit: draft.unit || null, points: toPoints(preview.series) },
      ...Object.entries(preview.inputs ?? {}).map(([key, rows]) => ({ key: `input:${key}`, label: key, unit: null, points: toPoints(rows) })),
    ];
  }, [preview, draft, t]);

  return (
    <div className="flex flex-col gap-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card
        title={t("scripts.formulas.title")}
        actions={
          canWrite && (
            <Button
              variant="primary"
              onClick={() => {
                setDraft(emptyDraft(targets));
                setPreview(null);
                setKeyError(null);
                setFieldError({});
                setCursor(0);
              }}
            >
              {t("scripts.formulas.new")}
            </Button>
          )
        }
      >
        {formulas.length === 0 ? (
          <EmptyState title={t("scripts.formulas.empty")} body={t("scripts.formulas.emptyBody")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("scripts.formulas.resultKey")}</th>
                <th>{t("scripts.formulas.displayName")}</th>
                <th>{t("scripts.formulas.unit")}</th>
                <th>{t("scripts.formulas.expression")}</th>
                <th>{t("scripts.formulas.target")}</th>
                <th>{t("scripts.formulas.status")}</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {formulas.map((f) => (
                <tr key={f.id}>
                  <td className="font-mono">{f.resultKey}</td>
                  <td>{f.displayName}</td>
                  <td>{f.unit || "–"}</td>
                  <td className="font-mono text-[12.5px]">{f.expression}</td>
                  <td>{`${t(`scripts.formulas.targets.${f.targetType}`)} ${f.targetName ?? f.targetId}`}</td>
                  <td>
                    <Badge tone={f.status === "ACTIVE" ? "success" : "neutral"}>{t(`scripts.formulas.statuses.${f.status}`)}</Badge>
                  </td>
                  {canWrite && (
                    <td className="whitespace-nowrap">
                      <Button
                        onClick={() => {
                          setDraft({ id: f.id, resultKey: f.resultKey, displayName: f.displayName, unit: f.unit ?? "", targetType: f.targetType, targetId: f.targetId, expression: f.expression, status: f.status, version: f.version });
                          setPreview(null);
                          setKeyError(null);
                          setFieldError({});
                          setCursor(f.expression.length);
                        }}
                      >
                        {t("common.edit")}
                      </Button>{" "}
                      <Button variant="danger" onClick={() => void remove(f)}>
                        {t("common.delete")}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {draft && canWrite && (
        <Card title={draft.id ? t("scripts.formulas.edit", { key: draft.resultKey }) : t("scripts.formulas.new")}>
          <div className="flex flex-wrap items-end gap-2">
            <TextField label={t("scripts.formulas.resultKey")} value={draft.resultKey} disabled={Boolean(draft.id)} maxLength={64} placeholder="thi" onChange={(e) => set({ resultKey: e.target.value })} error={keyError ?? undefined} />
            <TextField label={t("scripts.formulas.displayName")} value={draft.displayName} maxLength={80} onChange={(e) => set({ displayName: e.target.value })} error={fieldError.displayName} />
            <TextField label={t("scripts.formulas.unit")} value={draft.unit} maxLength={20} onChange={(e) => set({ unit: e.target.value })} />
            <SelectField label={t("scripts.formulas.targetType")} value={draft.targetType} onChange={(e) => set({ targetType: e.target.value as FormulaTarget, targetId: targets[e.target.value as FormulaTarget][0]?.id ?? "" })}>
              {TARGETS.map((type) => (
                <option key={type} value={type}>
                  {t(`scripts.formulas.targets.${type}`)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("scripts.formulas.target")} value={draft.targetId} onChange={(e) => set({ targetId: e.target.value })} error={fieldError.targetId}>
              <option value="">{t("scripts.formulas.pickTarget")}</option>
              {targets[draft.targetType].map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("scripts.formulas.status")} value={draft.status} onChange={(e) => set({ status: e.target.value as Draft["status"] })}>
              <option value="ACTIVE">{t("scripts.formulas.statuses.ACTIVE")}</option>
              <option value="DISABLED">{t("scripts.formulas.statuses.DISABLED")}</option>
            </SelectField>
          </div>
          <label className="mt-2 flex flex-col gap-1 text-[12.5px] font-medium text-muted">
            {t("scripts.formulas.expression")}
            <textarea
              ref={input}
              value={draft.expression}
              rows={2}
              maxLength={FORMULA_MAX_LENGTH}
              spellCheck={false}
              aria-invalid={check ? !check.ok && draft.expression.trim() !== "" : undefined}
              placeholder="thi(temperature, humidity)"
              onChange={(e) => {
                set({ expression: e.target.value });
                setCursor(e.target.selectionStart ?? e.target.value.length);
              }}
              onSelect={(e) => setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
              className="rounded-md border border-line bg-panel p-2 font-mono text-[13px] text-text"
            />
          </label>
          {items.length > 0 && (
            <ul role="listbox" aria-label={t("scripts.formulas.suggestions")} className="mt-1 flex flex-wrap gap-1">
              {items.map((item) => (
                <li key={item.label}>
                  <button type="button" role="option" aria-selected={false} className="rounded border border-line px-1.5 py-0.5 font-mono text-[12px]" onClick={() => insert(item.insert, true)}>
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {check && !check.ok && draft.expression.trim() !== "" && (
            <>
              <MarkedExpression expression={draft.expression} check={check} />
              <p role="alert" className="text-[12px] text-bad-ink">
                {formulaMessage(check)}
              </p>
            </>
          )}
          <details className="mt-2 text-[12px]">
            <summary className="cursor-pointer text-muted">{t("scripts.formulas.chips")}</summary>
            <div className="mt-1 flex flex-wrap gap-1">
              {metricKeys.map((key) => (
                <button key={key} type="button" className="rounded-full border border-line px-2 py-0.5 font-mono" onClick={() => insert(key)}>
                  {key}
                </button>
              ))}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.keys(FORMULA_FUNCTIONS).map((fn) => (
                <button key={fn} type="button" className="rounded-full border border-dashed border-line px-2 py-0.5 font-mono" onClick={() => insert(`${fn}(`)}>
                  {`${fn}()`}
                </button>
              ))}
            </div>
          </details>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <SelectField label={t("scripts.formulas.previewHours")} value={String(hours)} onChange={(e) => setHours(Number(e.target.value))}>
              {PREVIEW_HOURS.map((h) => (
                <option key={h} value={h}>
                  {t("scripts.formulas.hours", { n: h })}
                </option>
              ))}
            </SelectField>
            <Button disabled={busy || !check?.ok || !draft.targetId} onClick={() => void runPreview()}>
              {t("scripts.formulas.preview")}
            </Button>
            <span className="flex-1" />
            <Button onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {t("scripts.formulas.save")}
            </Button>
          </div>
          {preview && (
            <div className="mt-3" aria-label={t("scripts.formulas.previewTitle")}>
              {(preview.series ?? []).length === 0 ? (
                <p className="text-[12.5px] text-muted">{t("scripts.formulas.previewEmpty")}</p>
              ) : (
                <TimeseriesChart series={previewSeries} timezone={timezone} height={220} factory={chartFactory} title={t("scripts.formulas.previewTitle")} />
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
