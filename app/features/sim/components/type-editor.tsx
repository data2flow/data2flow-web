/**
 * UI-SIM-14 사용자 정의 가상 기기 유형(SIM-09.06): 기본(이름·분류·아이콘·설명·연결 실제 모델), 센서는 측정 항목(기본 출처 물리/생성기),
 * 장비는 기능(Capability), 특성 정의 표(키·이름·타입·단위·최소·최대·기본값·설명, 50개 이하), 물리 영향(장비: 영향 종류 → 특성).
 * 저장·삭제는 /sim/catalog 화면 action이 API-SIM-03으로 보낸다(SIM_MANAGE). 입력 검증은 브라우저와 서버에서 같은 규칙.
 */
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { Alert, Button, Card, Checkbox, CsrfField, SelectField, TextField } from "~/components/ui";
import { PHYSICS_EFFECTS, METRIC_SOURCES, emptyDef, validateDraft, type DefRow, type TypeDraft } from "../model/custom-type";
import { simErrorText, type SimFailure } from "../model/sim-error";
import type { Problem } from "../model/sim";
import { useProblemText } from "./common";

export interface TypeEditorResult {
  intent?: string;
  error?: SimFailure;
  fieldErrors?: Record<string, Problem>;
}

export function TypeEditor({
  initial,
  typeId,
  baseVersion,
  canManage,
  metricOptions,
  capabilityOptions,
  modelOptions,
  result,
  backTo,
}: {
  initial: TypeDraft;
  typeId: string | null;
  baseVersion?: number | null;
  canManage: boolean;
  metricOptions: string[];
  capabilityOptions: string[];
  modelOptions: { code: string; name: string }[];
  result?: TypeEditorResult;
  backTo: string;
}) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const [draft, setDraft] = useState<TypeDraft>(initial);
  const [problems, setProblems] = useState<Record<string, Problem>>({});
  const set = (patch: Partial<TypeDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setDef = (i: number, patch: Partial<DefRow>) => setDraft((d) => ({ ...d, defs: d.defs.map((row, j) => (j === i ? { ...row, ...patch } : row)) }));
  // 브라우저 검사 결과가 먼저, 없으면 서버가 돌려준 검사 결과(같은 규칙)
  const err = (key: string) => problemText(problems[key] ?? result?.fieldErrors?.[key]);
  const readOnly = !canManage;

  const submit = (event: FormEvent) => {
    const found = validateDraft(draft);
    setProblems(found);
    if (Object.keys(found).length) event.preventDefault();
  };
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const numericKeys = draft.defs.filter((d) => d.type === "number" && d.key).map((d) => d.key);

  return (
    <div className="flex flex-col gap-4">
      <p>
        <Link to={backTo} className="text-[13px] text-accent hover:underline">
          {t("sim.types.back")}
        </Link>
      </p>
      {result?.error && <Alert tone="danger">{simErrorText(t, result.error)}</Alert>}
      <Form method="post" onSubmit={submit} className="flex flex-col gap-4" aria-label={t("sim.types.formLabel")}>
        <CsrfField />
        <input type="hidden" name="intent" value="saveType" />
        {typeId && <input type="hidden" name="typeId" value={typeId} />}
        {baseVersion !== null && baseVersion !== undefined && <input type="hidden" name="baseVersion" value={baseVersion} />}
        <input type="hidden" name="draft" value={JSON.stringify(draft)} />
        <Card title={t("sim.types.basic")}>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField label={t("sim.types.name")} value={draft.name} disabled={readOnly} error={err("name")} onChange={(e) => set({ name: e.target.value })} />
            <SelectField label={t("sim.types.category")} value={draft.category} disabled={readOnly || Boolean(typeId)} onChange={(e) => set({ category: e.target.value as TypeDraft["category"] })}>
              <option value="SENSOR">{t("sim.catalog.tab.sensor")}</option>
              <option value="ACTUATOR">{t("sim.catalog.tab.actuator")}</option>
            </SelectField>
            <TextField label={t("sim.types.icon")} value={draft.icon} disabled={readOnly} onChange={(e) => set({ icon: e.target.value })} />
            <SelectField label={t("sim.types.linkedModel")} value={draft.linkedModelCode} disabled={readOnly} onChange={(e) => set({ linkedModelCode: e.target.value })}>
              <option value="">{t("sim.types.noModel")}</option>
              {modelOptions.map((m) => (
                <option key={m.code} value={m.code}>
                  {`${m.name} (${m.code})`}
                </option>
              ))}
            </SelectField>
            <TextField className="md:col-span-2" label={t("sim.types.description")} value={draft.description} disabled={readOnly} onChange={(e) => set({ description: e.target.value })} />
          </div>
        </Card>
        {draft.category === "SENSOR" ? (
          <Card title={t("sim.types.metrics")}>
            {err("metrics") && <p role="alert" className="mb-2 text-[12px] text-bad-ink">{err("metrics")}</p>}
            <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {metricOptions.map((key) => {
                const chosen = draft.metrics.find((m) => m.key === key);
                return (
                  <li key={key} className="flex flex-wrap items-center gap-2">
                    <Checkbox label={key} checked={Boolean(chosen)} disabled={readOnly} onChange={() => set({ metrics: chosen ? draft.metrics.filter((m) => m.key !== key) : [...draft.metrics, { key, source: "PHYSICS" }] })} />
                    {chosen && (
                      <select aria-label={t("sim.types.metricSource", { key })} value={chosen.source} disabled={readOnly} className="rounded border border-line bg-panel px-1 text-[12px]" onChange={(e) => set({ metrics: draft.metrics.map((m) => (m.key === key ? { ...m, source: e.target.value as TypeDraft["metrics"][number]["source"] } : m)) })}>
                        {METRIC_SOURCES.map((s) => (
                          <option key={s} value={s}>
                            {t(`sim.types.source.${s}`)}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : (
          <Card title={t("sim.types.capabilities")}>
            {err("capabilities") && <p role="alert" className="mb-2 text-[12px] text-bad-ink">{err("capabilities")}</p>}
            <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {capabilityOptions.map((name) => (
                <li key={name}>
                  <Checkbox label={name} checked={draft.capabilities.includes(name)} disabled={readOnly} onChange={() => set({ capabilities: toggle(draft.capabilities, name) })} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card title={t("sim.types.defs")} actions={!readOnly && <Button type="button" onClick={() => set({ defs: [...draft.defs, emptyDef()] })} disabled={draft.defs.length >= 50}>{t("sim.types.addDef")}</Button>}>
          {err("defs") && <p role="alert" className="mb-2 text-[12px] text-bad-ink">{err("defs")}</p>}
          {draft.defs.length === 0 ? (
            <p className="text-[13px] text-muted">{t("sim.types.noDefs")}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {draft.defs.map((d, i) => (
                <li key={i} className="grid gap-2 rounded border border-line p-2 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("sim.types.defRow", { n: i + 1 })}>
                  <TextField label={t("sim.types.key")} value={d.key} disabled={readOnly} error={err(`defs.${i}.key`)} onChange={(e) => setDef(i, { key: e.target.value })} />
                  <TextField label={t("sim.types.defName")} value={d.name} disabled={readOnly} error={err(`defs.${i}.name`)} onChange={(e) => setDef(i, { name: e.target.value })} />
                  <SelectField label={t("sim.types.type")} value={d.type} disabled={readOnly} onChange={(e) => setDef(i, { type: e.target.value as DefRow["type"] })}>
                    {(["number", "enum", "boolean"] as const).map((ty) => (
                      <option key={ty} value={ty}>
                        {t(`sim.types.valueType.${ty}`)}
                      </option>
                    ))}
                  </SelectField>
                  <TextField label={t("sim.types.unit")} value={d.unit} disabled={readOnly} onChange={(e) => setDef(i, { unit: e.target.value })} />
                  {d.type === "number" && (
                    <>
                      <TextField label={t("sim.types.min")} inputMode="decimal" value={d.min} disabled={readOnly} error={err(`defs.${i}.min`)} onChange={(e) => setDef(i, { min: e.target.value })} />
                      <TextField label={t("sim.types.max")} inputMode="decimal" value={d.max} disabled={readOnly} error={err(`defs.${i}.max`)} onChange={(e) => setDef(i, { max: e.target.value })} />
                    </>
                  )}
                  {d.type === "enum" && <TextField label={t("sim.types.enumValues")} value={d.enumValues} disabled={readOnly} error={err(`defs.${i}.enumValues`)} onChange={(e) => setDef(i, { enumValues: e.target.value })} />}
                  {d.type === "boolean" ? (
                    <SelectField label={t("sim.types.default")} value={d.default} disabled={readOnly} error={err(`defs.${i}.default`)} onChange={(e) => setDef(i, { default: e.target.value })}>
                      <option value="">–</option>
                      <option value="true">{t("sim.types.yes")}</option>
                      <option value="false">{t("sim.types.no")}</option>
                    </SelectField>
                  ) : (
                    <TextField label={t("sim.types.default")} value={d.default} disabled={readOnly} error={err(`defs.${i}.default`)} onChange={(e) => setDef(i, { default: e.target.value })} />
                  )}
                  <TextField label={t("sim.types.defDescription")} value={d.description} disabled={readOnly} onChange={(e) => setDef(i, { description: e.target.value })} />
                  {!readOnly && (
                    <div className="flex items-end">
                      <Button type="button" variant="ghost" onClick={() => set({ defs: draft.defs.filter((_, j) => j !== i), effects: draft.effects.filter((e) => e.propertyKey !== d.key) })}>
                        {t("sim.types.removeDef")}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>
        {draft.category === "ACTUATOR" && (
          <Card title={t("sim.types.effects")} actions={!readOnly && <Button type="button" onClick={() => set({ effects: [...draft.effects, { effect: PHYSICS_EFFECTS[0], propertyKey: numericKeys[0] ?? "" }] })}>{t("sim.types.addEffect")}</Button>}>
            {draft.effects.length === 0 ? (
              <p className="text-[13px] text-muted">{t("sim.types.noEffects")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {draft.effects.map((e, i) => (
                  <li key={i} className="grid gap-2 sm:grid-cols-3">
                    <SelectField label={t("sim.types.effect")} value={e.effect} disabled={readOnly} onChange={(ev) => set({ effects: draft.effects.map((x, j) => (j === i ? { ...x, effect: ev.target.value } : x)) })}>
                      {PHYSICS_EFFECTS.map((effect) => (
                        <option key={effect} value={effect}>
                          {t(`sim.types.effectKind.${effect}`)}
                        </option>
                      ))}
                    </SelectField>
                    <SelectField label={t("sim.types.effectProperty")} value={e.propertyKey} disabled={readOnly} error={err(`effects.${i}`)} onChange={(ev) => set({ effects: draft.effects.map((x, j) => (j === i ? { ...x, propertyKey: ev.target.value } : x)) })}>
                      <option value="">–</option>
                      {numericKeys.map((key) => (
                        <option key={key} value={key}>
                          {key}
                        </option>
                      ))}
                    </SelectField>
                    {!readOnly && (
                      <div className="flex items-end">
                        <Button type="button" variant="ghost" onClick={() => set({ effects: draft.effects.filter((_, j) => j !== i) })}>
                          {t("sim.types.removeEffect")}
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {!readOnly && (
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              {t("sim.types.save")}
            </Button>
          </div>
        )}
      </Form>
      {!readOnly && typeId && (
        <Form method="post" className="flex justify-end">
          <CsrfField />
          <input type="hidden" name="intent" value="deleteType" />
          <input type="hidden" name="typeId" value={typeId} />
          <Button type="submit" variant="danger">
            {t("sim.types.delete")}
          </Button>
        </Form>
      )}
    </div>
  );
}
