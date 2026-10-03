/**
 * 오른쪽 설정 패널(UI-FLW-02, UI-FLW-16, FLW-01.02): 노드 카탈로그 JSON 스키마로 폼을 자동 생성하고 입력값을 검증한다.
 * 공통 필드(이름 1~60자, 설명, 재시도 0~10회·간격·시간 제한), 기간 위젯, 대상 위젯, 제어 위젯, JS 노드는 Monaco 편집기.
 * 잘못된 값은 필드 아래 빨간 문구 + 캔버스 노드 배지로 표시하고, 저장은 되지만 적용은 막힌다(BR-FLW-05).
 */
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { CodeEditor, type EditorFactory } from "~/components/code-editor";
import { Checkbox, SelectField, TextArea, TextField } from "~/components/ui";
import type { SpaceNode } from "~/lib/spaces";
import type { FlowApi } from "../api";
import { JS_CODE_LIMIT_BYTES, nodeProblems, type ConfigProblem } from "../model/validation";
import type { Catalog } from "../model/flow-graph";
import type { ConfigSchema, FlowNode, RetryPolicy } from "../model/types";
import { ControlFields, type ControlValue } from "./control-fields";
import { DurationField } from "./duration-field";
import { TargetField, type TargetDevice, type TargetValue } from "./target-field";

export interface PanelContext {
  spaces: SpaceNode[];
  devices: TargetDevice[];
  models: { id: string; name: string }[];
  metricKeys: string[];
  api: Pick<FlowApi, "capabilities" | "capability">;
  editorFactory?: EditorFactory;
}

export function problemText(t: TFunction, p: ConfigProblem | undefined): string | undefined {
  if (!p) return undefined;
  return t(`flows.rule.${p.rule}`, { limit: p.limit ?? "", defaultValue: p.rule });
}

const CONTROL_KEYS = new Set(["capability", "command", "args"]);

function clean(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined));
}

function Field({ name, schema, value, onChange, problem, ctx, disabled, nodeType }: { name: string; schema: ConfigSchema; value: unknown; onChange: (v: unknown) => void; problem?: string; ctx: PanelContext; disabled: boolean; nodeType: string }) {
  const { t } = useTranslation();
  const label = t(`flows.field.${name}`, { defaultValue: schema.title ?? name });
  const widget = schema["x-widget"] ?? (schema.format === "duration" ? "duration" : undefined);
  if (widget === "duration") return <DurationField label={label} value={value} onChange={onChange} error={problem} disabled={disabled} />;
  if (widget === "target") return <TargetField label={label} value={value as TargetValue | undefined} onChange={onChange} spaces={ctx.spaces} devices={ctx.devices} models={ctx.models} defaultRelation={nodeType.startsWith("action.") ? "controls" : "measures"} error={problem} disabled={disabled} />;
  if (widget === "code") {
    const code = typeof value === "string" ? value : "";
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[12.5px] font-medium text-muted">{label}</span>
        <CodeEditor label={label} value={code} onChange={onChange} readOnly={disabled} height={240} factory={ctx.editorFactory} />
        <p className="text-[11.5px] text-muted">{t("flows.js.size", { n: new TextEncoder().encode(code).length, max: JS_CODE_LIMIT_BYTES })}</p>
        {problem && (
          <p role="alert" className="text-[12px] text-bad">
            {problem}
          </p>
        )}
      </div>
    );
  }
  if (schema.enum) {
    return (
      <SelectField label={label} value={value === undefined ? "" : String(value)} disabled={disabled} error={problem} onChange={(e) => onChange(e.target.value === "" ? undefined : schema.enum!.find((v) => String(v) === e.target.value))}>
        <option value="">{t("flows.control.unset")}</option>
        {schema.enum.map((v) => (
          <option key={String(v)} value={String(v)}>
            {t(`flows.enum.${String(v)}`, { defaultValue: String(v) })}
          </option>
        ))}
      </SelectField>
    );
  }
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "boolean") return <Checkbox label={label} checked={Boolean(value)} disabled={disabled} error={problem} onChange={(e) => onChange(e.target.checked)} />;
  if (type === "number" || type === "integer") {
    return (
      <TextField
        label={label}
        type="number"
        min={schema.minimum}
        max={schema.maximum}
        step={type === "integer" ? 1 : "any"}
        value={typeof value === "number" ? String(value) : typeof value === "string" ? value : ""}
        disabled={disabled}
        error={problem}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : e.target.value)}
      />
    );
  }
  if (type === "array") {
    const listId = widget === "metric" ? `metrics-${name}` : undefined;
    return (
      <>
        <TextField
          label={label}
          list={listId}
          hint={t("flows.field.commaHint")}
          defaultValue={Array.isArray(value) ? value.join(", ") : ""}
          disabled={disabled}
          error={problem}
          onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
        />
        {listId && <MetricList id={listId} keys={ctx.metricKeys} />}
      </>
    );
  }
  if (type === "object") {
    return (
      <TextArea
        label={label}
        rows={3}
        defaultValue={value === undefined ? "" : JSON.stringify(value)}
        disabled={disabled}
        error={problem}
        onChange={(e) => {
          try {
            onChange(e.target.value.trim() === "" ? undefined : JSON.parse(e.target.value));
          } catch {
            onChange(e.target.value);
          }
        }}
      />
    );
  }
  const listId = widget === "metric" ? `metrics-${name}` : undefined;
  return (
    <>
      <TextField label={label} list={listId} value={typeof value === "string" ? value : value === undefined ? "" : String(value)} disabled={disabled} error={problem} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />
      {listId && <MetricList id={listId} keys={ctx.metricKeys} />}
    </>
  );
}

function MetricList({ id, keys }: { id: string; keys: string[] }) {
  return (
    <datalist id={id}>
      {keys.map((k) => (
        <option key={k} value={k} />
      ))}
    </datalist>
  );
}

export function PropertyPanel({ node, catalog, readOnly, ctx, onChange }: { node: FlowNode; catalog: Catalog; readOnly: boolean; ctx: PanelContext; onChange: (patch: Partial<FlowNode>) => void }) {
  const { t } = useTranslation();
  const nodeType = catalog.get(node.type);
  const problems = nodeProblems(node, catalog);
  const problemOf = (path: string) => problemText(t, problems.find((p) => p.path === path || p.path.startsWith(`${path}.`) || p.path.startsWith(`${path}[`)));
  const setConfig = (patch: Record<string, unknown>) => onChange({ config: clean({ ...node.config, ...patch }) });
  const setRetry = (patch: RetryPolicy) => onChange({ retry: { ...node.retry, ...patch } });
  const isControl = node.type === "action.control";
  const properties = Object.entries(nodeType?.configSchema?.properties ?? {}).filter(([key]) => !(isControl && CONTROL_KEYS.has(key)));
  const num = (v: string) => (v === "" ? undefined : Number(v));
  return (
    <section aria-label={t("flows.panel.label", { name: node.name })} className="flex flex-col gap-3">
      <header>
        <p className="text-[10.5px] font-semibold uppercase text-muted">
          {nodeType?.name ?? node.type} · <span className="font-mono">{node.id}</span>
        </p>
        {nodeType?.description && <p className="text-[12px] text-muted">{nodeType.description}</p>}
        {readOnly && <p className="text-[12px] text-muted">{t("flows.panel.readOnly")}</p>}
      </header>
      <TextField label={t("flows.panel.name")} value={node.name} maxLength={60} disabled={readOnly} error={problemOf("name")} onChange={(e) => onChange({ name: e.target.value })} />
      <TextArea label={t("flows.panel.description")} rows={2} value={node.description ?? ""} disabled={readOnly} onChange={(e) => onChange({ description: e.target.value || undefined })} />
      {properties.map(([key, schema]) => (
        <Field key={key} name={key} schema={schema} value={node.config[key]} onChange={(v) => setConfig({ [key]: v })} problem={problemOf(key)} ctx={ctx} disabled={readOnly} nodeType={node.type} />
      ))}
      {isControl && <ControlFields value={node.config as ControlValue} api={ctx.api} disabled={readOnly} onChange={(patch) => setConfig(patch as Record<string, unknown>)} />}
      {isControl && (problemOf("capability") || problemOf("command") || problemOf("args")) && (
        <p role="alert" className="text-[12px] text-bad">
          {problemOf("capability") ?? problemOf("command") ?? problemOf("args")}
        </p>
      )}
      <fieldset className="flex flex-col gap-2 rounded-md border border-line p-2">
        <legend className="text-[12.5px] font-medium text-muted">{t("flows.panel.retry")}</legend>
        <TextField label={t("flows.panel.maxAttempts")} type="number" min={0} max={10} value={node.retry?.maxAttempts ?? ""} disabled={readOnly} error={problemOf("retry")} onChange={(e) => setRetry({ maxAttempts: num(e.target.value) })} />
        <TextField label={t("flows.panel.intervalMs")} type="number" min={0} value={node.retry?.intervalMs ?? ""} disabled={readOnly} onChange={(e) => setRetry({ intervalMs: num(e.target.value) })} />
        <TextField label={t("flows.panel.timeoutMs")} type="number" min={0} value={node.retry?.timeoutMs ?? ""} disabled={readOnly} onChange={(e) => setRetry({ timeoutMs: num(e.target.value) })} />
      </fieldset>
    </section>
  );
}
