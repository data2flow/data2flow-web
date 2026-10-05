/**
 * 조건 빌더(UI-RUL-02 "조건"·"복합 조건", RUL-01.01~06·01.12, TC-RUL-019).
 * 조건 종류: 임계값(연산자·값·범위, 지속 시간, 해제 기준, 반복 횟수, 대상 기준), 변화율, 무수신. 그룹 AND/OR, 조건 10개·중첩 2단계.
 * 한도에 닿으면 [조건 추가]·[그룹 추가]를 끄고 이유를 보여 준다.
 */
import { useTranslation } from "react-i18next";
import { DurationField } from "~/features/flows/components/duration-field";
import { Button, cx } from "~/components/ui";
import {
  MAX_CONDITIONS,
  MAX_DEPTH,
  addToGroup,
  canAddCondition,
  canAddGroup,
  changeOp,
  depthOf,
  isGroup,
  newLeaf,
  nextUid,
  removeNode,
  supportsClear,
  updateNode,
  type ConditionProblems,
  type EditorGroup,
  type EditorLeaf,
  type EditorNode,
  type FieldProblem,
} from "../model/condition";
import { AGGREGATES, THRESHOLD_OPS, type LeafCondition, type MetricInfo, type ThresholdOp } from "../model/types";

const input = "rounded-md border border-line bg-panel px-2 py-1.5 text-[13px] aria-[invalid=true]:border-bad";

interface Props {
  root: EditorGroup;
  metrics: MetricInfo[];
  problems: ConditionProblems;
  onChange: (next: EditorGroup) => void;
  disabled?: boolean;
}

export function ConditionBuilder({ root, metrics, problems, onChange, disabled }: Props) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-[12.5px] font-medium text-muted">{t("rules.form.condition")}</legend>
      <GroupView group={root} root={root} metrics={metrics} problems={problems} onChange={onChange} />
    </fieldset>
  );
}

function useProblem() {
  const { t } = useTranslation();
  return (problem: FieldProblem | undefined) => (problem ? t(problem.key, problem.params ?? {}) : undefined);
}

function GroupView({ group, root, metrics, problems, onChange }: { group: EditorGroup; root: EditorGroup; metrics: MetricInfo[]; problems: ConditionProblems; onChange: (next: EditorGroup) => void }) {
  const { t } = useTranslation();
  const depth = depthOf(root, group.uid) ?? 1;
  const addAllowed = canAddCondition(root);
  const groupAllowed = canAddGroup(root, group.uid);
  const isRoot = group.uid === root.uid;
  return (
    <div className={cx("flex flex-col gap-2", !isRoot && "rounded-md border border-dashed border-line p-2")} role="group" aria-label={t("rules.cond.groupLabel", { depth })}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[12.5px] text-muted">
          {t("rules.cond.groupOp")}
          <select className={input} value={group.op} onChange={(e) => onChange(updateNode(root, group.uid, { op: e.target.value as "AND" | "OR" }))} aria-label={t("rules.cond.groupOpLabel", { depth })}>
            <option value="AND">{t("rules.cond.and")}</option>
            <option value="OR">{t("rules.cond.or")}</option>
          </select>
        </label>
        {!isRoot && (
          <Button variant="ghost" onClick={() => onChange(removeNode(root, group.uid))}>
            {t("rules.cond.removeGroup")}
          </Button>
        )}
      </div>
      {group.items.map((item) =>
        isGroup(item) ? (
          <GroupView key={item.uid} group={item} root={root} metrics={metrics} problems={problems} onChange={onChange} />
        ) : (
          <LeafView key={item.uid} leaf={item} root={root} metrics={metrics} problems={problems} onChange={onChange} removable={root.items.length > 1 || group.uid !== root.uid || group.items.length > 1} />
        ),
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => onChange(addToGroup(root, group.uid, newLeaf("threshold")))} disabled={!addAllowed}>
          {t("rules.cond.add")}
        </Button>
        {depth < MAX_DEPTH && (
          <Button onClick={() => onChange(addToGroup(root, group.uid, { kind: "group", uid: nextUid(), op: "OR", items: [newLeaf("threshold")] } as EditorNode))} disabled={!groupAllowed}>
            {t("rules.cond.addGroup")}
          </Button>
        )}
        {!addAllowed && isRoot && (
          <p role="status" className="text-[12px] text-fair-ink">
            {t("rules.cond.limitReached", { n: MAX_CONDITIONS })}
          </p>
        )}
        {isRoot && <p className="text-[12px] text-muted">{t("rules.cond.depthHint", { n: MAX_DEPTH })}</p>}
      </div>
    </div>
  );
}

function MetricSelect({ value, metrics, onChange, error, label, optional }: { value: string; metrics: MetricInfo[]; onChange: (v: string) => void; error?: string; label: string; optional?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-col">
      <select className={input} aria-label={label} value={value} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)}>
        <option value="">{optional ? t("rules.cond.anyMetric") : t("rules.cond.chooseMetric")}</option>
        {metrics.map((m) => (
          <option key={m.key} value={m.key}>
            {m.displayName && m.displayName !== m.key ? `${m.displayName} (${m.key})` : m.key}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-[12px] text-bad-ink">
          {error}
        </span>
      )}
    </span>
  );
}

function NumberInput({ label, value, onChange, error, unit, step }: { label: string; value: unknown; onChange: (v: number | null) => void; error?: string; unit?: string | null; step?: string }) {
  return (
    <span className="flex flex-col">
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={step ?? "any"}
          className={cx(input, "w-28")}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
        {unit && <span className="text-[12px] text-muted">{unit}</span>}
      </span>
      {error && (
        <span role="alert" className="text-[12px] text-bad-ink">
          {error}
        </span>
      )}
    </span>
  );
}

function LeafView({ leaf, root, metrics, problems, onChange, removable }: { leaf: EditorLeaf; root: EditorGroup; metrics: MetricInfo[]; problems: ConditionProblems; onChange: (next: EditorGroup) => void; removable: boolean }) {
  const { t } = useTranslation();
  const problem = useProblem();
  const patch = (p: Partial<EditorLeaf>) => onChange(updateNode(root, leaf.uid, p));
  const err = (field: string) => problem(problems[`${leaf.uid}.${field}`]);
  const metric = "metric" in leaf ? metrics.find((m) => m.key === leaf.metric) : undefined;
  const unit = metric?.unit ?? null;
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-md bg-bg/50 p-2" role="group" aria-label={t("rules.cond.itemLabel")}>
      <select
        className={input}
        aria-label={t("rules.cond.kind")}
        value={leaf.kind}
        onChange={(e) => {
          const next = newLeaf(e.target.value as LeafCondition["kind"], "metric" in leaf ? (leaf.metric ?? "") : "");
          onChange(removeNode(addToGroupAfter(root, leaf.uid, next), leaf.uid));
        }}
      >
        {(["threshold", "rateOfChange", "noData"] as const).map((k) => (
          <option key={k} value={k}>
            {t(`rules.cond.kinds.${k}`)}
          </option>
        ))}
        {leaf.kind === "anomaly" && <option value="anomaly">{t("rules.cond.kinds.anomaly")}</option>}
      </select>
      {leaf.kind === "threshold" && (
        <>
          <MetricSelect label={t("rules.cond.metric")} value={leaf.metric} metrics={metrics} onChange={(v) => patch({ metric: v })} error={err("metric")} />
          <select className={input} aria-label={t("rules.cond.op")} value={leaf.op} onChange={(e) => patch(changeOp(leaf, e.target.value as ThresholdOp))}>
            {THRESHOLD_OPS.map((op) => (
              <option key={op} value={op}>
                {t(`rules.cond.ops.${op === ">" ? "gt" : op === ">=" ? "gte" : op === "<" ? "lt" : op === "<=" ? "lte" : op === "==" ? "eq" : op === "!=" ? "ne" : op}`)}
              </option>
            ))}
          </select>
          {leaf.op === "outside" || leaf.op === "inside" ? (
            <span className="flex flex-col">
              <span className="flex items-center gap-1">
                <NumberInput label={t("rules.cond.rangeLow")} value={leaf.range?.[0]} onChange={(v) => patch({ range: [v as number, leaf.range?.[1] as number] })} />
                <span>~</span>
                <NumberInput label={t("rules.cond.rangeHigh")} value={leaf.range?.[1]} onChange={(v) => patch({ range: [leaf.range?.[0] as number, v as number] })} unit={unit} />
              </span>
              {err("range") && (
                <span role="alert" className="text-[12px] text-bad-ink">
                  {err("range")}
                </span>
              )}
            </span>
          ) : metric?.valueType === "BOOLEAN" ? (
            <select className={input} aria-label={t("rules.cond.value")} value={leaf.value === true || leaf.value === 1 ? "true" : leaf.value === false || leaf.value === 0 ? "false" : ""} onChange={(e) => patch({ value: e.target.value === "" ? null : e.target.value === "true" })}>
              <option value="">{t("rules.cond.chooseValue")}</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : metric?.valueType === "ENUM" ? (
            <input className={input} aria-label={t("rules.cond.value")} value={String(leaf.value ?? "")} onChange={(e) => patch({ value: e.target.value })} />
          ) : (
            <NumberInput label={t("rules.cond.value")} value={leaf.value} onChange={(v) => patch({ value: v })} error={err("value")} unit={unit} />
          )}
          <DurationField label={t("rules.cond.for")} value={leaf.for ?? ""} onChange={(iso) => patch({ for: iso ?? null })} error={err("for")} />
          {supportsClear(leaf.op) && <NumberInput label={t("rules.cond.clear")} value={leaf.clear} onChange={(v) => patch({ clear: v })} error={err("clear")} unit={unit} />}
          <NumberInput label={t("rules.cond.repeat")} value={leaf.repeat ?? 1} onChange={(v) => patch({ repeat: v })} error={err("repeat")} step="1" />
          <AggregateSelect value={leaf.aggregate} onChange={(aggregate) => patch({ aggregate })} />
        </>
      )}
      {leaf.kind === "rateOfChange" && (
        <>
          <MetricSelect label={t("rules.cond.metric")} value={leaf.metric} metrics={metrics} onChange={(v) => patch({ metric: v })} error={err("metric")} />
          <select className={input} aria-label={t("rules.cond.direction")} value={leaf.direction} onChange={(e) => patch({ direction: e.target.value as "up" | "down" | "any" })}>
            {(["up", "down", "any"] as const).map((d) => (
              <option key={d} value={d}>
                {t(`rules.cond.directions.${d.toUpperCase()}`)}
              </option>
            ))}
          </select>
          <NumberInput label={t("rules.cond.delta")} value={leaf.delta} onChange={(v) => patch({ delta: v as number })} error={err("delta")} unit={unit} />
          <DurationField label={t("rules.cond.window")} value={leaf.window} onChange={(iso) => patch({ window: iso ?? "" })} error={err("window")} />
          <AggregateSelect value={leaf.aggregate} onChange={(aggregate) => patch({ aggregate })} />
        </>
      )}
      {leaf.kind === "noData" && (
        <>
          <MetricSelect label={t("rules.cond.metric")} value={leaf.metric ?? ""} metrics={metrics} onChange={(v) => patch({ metric: v || null })} optional />
          <DurationField label={t("rules.cond.window")} value={leaf.window} onChange={(iso) => patch({ window: iso ?? "" })} error={err("window")} />
        </>
      )}
      {leaf.kind === "anomaly" && <span className="text-[13px]">{t("rules.cond.anomalySummary", { score: leaf.minScore })}</span>}
      {removable && (
        <Button variant="ghost" onClick={() => onChange(removeNode(root, leaf.uid))} aria-label={t("rules.cond.remove")}>
          ✕
        </Button>
      )}
    </div>
  );
}

function AggregateSelect({ value, onChange }: { value: string | undefined; onChange: (v: (typeof AGGREGATES)[number]) => void }) {
  const { t } = useTranslation();
  return (
    <select className={input} aria-label={t("rules.cond.aggregate")} value={value ?? "perDevice"} onChange={(e) => onChange(e.target.value as (typeof AGGREGATES)[number])}>
      {AGGREGATES.map((a) => (
        <option key={a} value={a}>
          {t(`rules.cond.aggregates.${a}`)}
        </option>
      ))}
    </select>
  );
}

/** 종류를 바꿀 때 같은 자리에 새 조건을 둔다 */
function addToGroupAfter(root: EditorGroup, uid: string, node: EditorLeaf): EditorGroup {
  const walk = (group: EditorGroup): EditorGroup => ({
    ...group,
    items: group.items.flatMap((item) => (item.uid === uid ? [item, node] : isGroup(item) ? [walk(item)] : [item])),
  });
  return walk(root);
}
