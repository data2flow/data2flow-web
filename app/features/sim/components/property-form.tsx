/**
 * UI-SIM-04 특성 편집(상속 표시) 공통 폼(SIM-09.02·09.03, BR-SIM-02·03).
 * - 폼은 특성 정의(타입·단위·범위·설명)로만 만든다: 카탈로그에 특성이 늘어도 화면을 고치지 않는다
 * - 출처 배지: 편집 층(프로필 편집이면 PROFILE, 기기면 DEVICE)의 값은 "직접 설정", 그 밖은 "카탈로그"·"프로필"(상속 값은 회색)
 * - [기본값으로 되돌리기]: 그 키를 null로 보내 상위 값으로 돌린다(저장 뒤 출처가 상속으로 바뀜)
 * - 저장은 바꾼 값만 보낸다. 범위 밖 값은 바로 오류를 보이고 저장하지 않는다
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Table, cx } from "~/components/ui";
import { checkPropertyValue, coerceProperty, originLabelKey, overridesDiff } from "../model/sim";
import type { PropertyOrigin, PropertyRow } from "../model/types";
import { useProblemText } from "./common";

export interface PropertyFormProps {
  rows: PropertyRow[];
  layer: PropertyOrigin;
  canEdit: boolean;
  onSave: (overrides: Record<string, unknown>) => Promise<{ ok: boolean; message?: string }>;
  title?: string;
}

function display(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function PropertyForm({ rows, layer, canEdit, onSave, title }: PropertyFormProps) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const problems = useMemo(() => {
    const out: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(edits)) {
      if (value === null) continue;
      const row = rows.find((r) => r.key === key);
      if (row) out[key] = problemText(checkPropertyValue(row.def, coerceProperty(row.def, value)));
    }
    return out;
  }, [edits, rows, problemText]);
  const hasProblem = Object.values(problems).some(Boolean);
  const diff = overridesDiff(rows, edits);
  const changed = Object.keys(diff).length > 0;

  const save = async () => {
    if (hasProblem || !changed) return;
    setSaving(true);
    const result = await onSave(diff);
    setSaving(false);
    if (result.ok) {
      setEdits({});
      setNotice({ tone: "good", text: t("sim.property.saved") });
    } else setNotice({ tone: "bad", text: result.message ?? t("errors.UNKNOWN") });
  };

  return (
    <div className="flex flex-col gap-3">
      {title && <h3 className="text-[13.5px] font-semibold">{title}</h3>}
      <Table>
        <thead>
          <tr>
            <th>{t("sim.property.col.name")}</th>
            <th>{t("sim.property.col.value")}</th>
            <th>{t("sim.property.col.unit")}</th>
            <th>{t("sim.property.col.origin")}</th>
            <th>{t("sim.property.col.action")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { def } = row;
            const pending = Object.prototype.hasOwnProperty.call(edits, row.key) ? edits[row.key] : undefined;
            const reverted = pending === null;
            const value = pending === undefined || pending === null ? row.value : pending;
            const direct = row.origin === layer && !reverted;
            const inherited = !direct && pending === undefined;
            const label = `${def.name}${def.unit ? ` (${def.unit})` : ""}`;
            const range = def.type === "number" && (def.min !== null && def.min !== undefined) && (def.max !== null && def.max !== undefined) ? t("sim.property.range", { min: def.min, max: def.max }) : "";
            const error = problems[row.key];
            const set = (v: unknown) => {
              setNotice(null);
              setEdits((prev) => ({ ...prev, [row.key]: v }));
            };
            return (
              <tr key={row.key}>
                <td>
                  <span title={def.description ?? undefined} className={def.description ? "cursor-help underline decoration-dotted underline-offset-2" : undefined}>
                    {def.name}
                  </span>
                </td>
                <td>
                  {def.type === "boolean" ? (
                    <input type="checkbox" aria-label={label} checked={value === true} disabled={!canEdit} onChange={(e) => set(e.target.checked)} className="h-4 w-4" />
                  ) : def.type === "enum" ? (
                    <select aria-label={label} value={display(value)} disabled={!canEdit} onChange={(e) => set(e.target.value)} className={cx("rounded-md border border-line bg-panel px-2 py-1 text-[13px]", inherited && "text-muted")}>
                      {(def.enumValues ?? []).map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={label}
                      inputMode="decimal"
                      value={display(value)}
                      disabled={!canEdit}
                      aria-invalid={error ? true : undefined}
                      onChange={(e) => set(e.target.value)}
                      className={cx("w-28 rounded-md border border-line bg-panel px-2 py-1 font-mono text-[13px] aria-[invalid=true]:border-bad", inherited && "text-muted")}
                    />
                  )}
                  {range && <span className="ml-2 text-[11.5px] text-muted">{range}</span>}
                  {error && (
                    <p role="alert" className="text-[12px] text-bad-ink">
                      {error}
                    </p>
                  )}
                </td>
                <td className="text-muted">{def.unit ?? ""}</td>
                <td>
                  {reverted ? (
                    <Badge tone="warning">{t("sim.property.revertPending")}</Badge>
                  ) : pending !== undefined ? (
                    <Badge tone="info">{t("sim.property.origin.direct")}</Badge>
                  ) : (
                    <Badge tone={direct ? "info" : "neutral"}>{t(`sim.property.origin.${originLabelKey(row.origin, layer)}`)}</Badge>
                  )}
                </td>
                <td>
                  {canEdit && row.origin === layer && !reverted && (
                    <Button variant="ghost" onClick={() => set(null)}>
                      {t("sim.property.revert")}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {notice && (
        <p role="status" className={notice.tone === "good" ? "text-[12.5px] text-good-ink" : "text-[12.5px] text-bad-ink"}>
          {notice.text}
        </p>
      )}
      {canEdit && (
        <div className="flex justify-end gap-2">
          <Button onClick={() => setEdits({})} disabled={!changed && Object.keys(edits).length === 0}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={save} disabled={!changed || hasProblem || saving}>
            {t("common.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
