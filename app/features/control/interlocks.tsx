/**
 * UI-ACT-06 인터락 규칙(ACT-06.02, API-ACT-16). 목록(이름, 공간, 조건 요약, 금지 대상, 활성, 최근 7일 차단 수)과 편집.
 * 조건: 측정값(측정 항목·연산자·값, 예: 실외 pm2_5 > 75) 또는 기기 상태(Contact.open == true). 금지: 기능 + 명령 + 인자 조건(mode ∈ {cool, heat}).
 * 데이터가 없으면 "보고 주기 × 3, 최소 5분" 뒤 안전 쪽으로 막는다(BR-ACT-11, 계산은 action). 권한 INTERLOCK_MANAGE.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, SelectField, Table, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { findSpace, type SpaceNode } from "~/lib/spaces";
import { controlAdminApi, type ControlAdminApi } from "./admin-api";
import { INTERLOCK_OPS, conditionText, emptyInterlockForm, forbidText, interlockBody, interlockProblems, interlockToForm, type Interlock, type InterlockForm, type InterlockSummary } from "./model/admin";

type Block = { at: string; commandId: string; deviceId: string; deviceName?: string; capability: string; command: string; message?: string };

export interface InterlockManagerProps {
  initial: InterlockSummary[];
  failed?: boolean;
  spaces: SpaceNode[];
  devices: { id: string; name: string }[];
  timezone: string;
  lang: string;
  api?: ControlAdminApi;
}

export function InterlockManager({ initial, failed, spaces, devices, timezone, lang, api = controlAdminApi }: InterlockManagerProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initial);
  const [conditions, setConditions] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string | null; version: number; form: InterlockForm } | null>(null);
  const [blocks, setBlocks] = useState<{ id: string; rows: Block[] } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const problems = editing ? interlockProblems(editing.form) : [];
  const set = (patch: Partial<InterlockForm>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));
  const err = (key: string, text: string) => (submitted && problems.includes(key) ? text : undefined);
  const spaceName = (id: string) => findSpace(spaces, id)?.name ?? `#${id}`;

  const open = async (id: string | null) => {
    setNotice(null);
    setSubmitted(false);
    if (!id) return setEditing({ id: null, version: 0, form: emptyInterlockForm() });
    const result = await api.interlock(id);
    if (result.ok) {
      setEditing({ id, version: result.data.version, form: interlockToForm(result.data) });
      setConditions((c) => ({ ...c, [id]: conditionText(result.data.condition) }));
    } else setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
  };

  const save = async () => {
    if (!editing) return;
    setSubmitted(true);
    if (problems.length > 0) return;
    const body = interlockBody(editing.form);
    const result = editing.id ? await api.updateInterlock(editing.id, { ...body, baseVersion: editing.version }) : await api.createInterlock(body);
    if (!result.ok) {
      setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
      return;
    }
    const saved: Interlock = result.data;
    const row: InterlockSummary = { interlockId: saved.interlockId, name: saved.name, spaceId: saved.spaceId, includeChildren: saved.includeChildren, forbid: saved.forbid, enabled: saved.enabled, blocks7d: rows.find((r) => r.interlockId === saved.interlockId)?.blocks7d ?? 0, updatedAt: saved.updatedAt };
    setRows((list) => (list.some((r) => r.interlockId === row.interlockId) ? list.map((r) => (r.interlockId === row.interlockId ? row : r)) : [row, ...list]));
    setConditions((c) => ({ ...c, [row.interlockId]: conditionText(saved.condition) }));
    setEditing(null);
    setNotice({ tone: "success", text: t("control.interlocks.saved") });
  };

  const remove = async (row: InterlockSummary) => {
    if (!window.confirm(t("control.interlocks.deleteConfirm", { name: row.name }))) return;
    const result = await api.deleteInterlock(row.interlockId);
    if (result.ok) setRows((list) => list.filter((r) => r.interlockId !== row.interlockId));
    else setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
  };

  const showBlocks = async (row: InterlockSummary) => {
    const result = await api.interlockBlocks(row.interlockId);
    if (result.ok) setBlocks({ id: row.interlockId, rows: result.data.responses ?? [] });
    else setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
  };

  const form = editing?.form;
  return (
    <div className="flex flex-col gap-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card title={t("control.interlocks.title")} actions={<Button variant="primary" onClick={() => void open(null)}>{t("control.interlocks.new")}</Button>}>
        {failed && <Alert tone="warning">{t("control.common.loadFailed")}</Alert>}
        {rows.length === 0 && !failed ? (
          <EmptyState title={t("control.interlocks.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("control.interlocks.name")}</th>
                <th>{t("control.interlocks.space")}</th>
                <th>{t("control.interlocks.condition")}</th>
                <th>{t("control.interlocks.forbid")}</th>
                <th>{t("control.common.enabled")}</th>
                <th>{t("control.interlocks.blocks7d")}</th>
                <th>{t("control.history.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.interlockId}>
                  <td>
                    <button type="button" className="text-accent hover:underline" onClick={() => void open(row.interlockId)}>
                      {row.name}
                    </button>
                  </td>
                  <td>
                    {spaceName(row.spaceId)}
                    {row.includeChildren && <span className="text-muted"> {t("control.interlocks.withChildren")}</span>}
                  </td>
                  <td className="font-mono text-[12px]">{conditions[row.interlockId] ?? "–"}</td>
                  <td className="font-mono text-[12px]">{forbidText(row.forbid)}</td>
                  <td>{row.enabled ? <Badge tone="success">{t("control.common.enabled")}</Badge> : <Badge tone="neutral">{t("control.interlocks.disabled")}</Badge>}</td>
                  <td>
                    <button type="button" className="font-mono text-accent hover:underline" onClick={() => void showBlocks(row)} aria-label={t("control.interlocks.showBlocks", { name: row.name })}>
                      {row.blocks7d ?? 0}
                    </button>
                  </td>
                  <td>
                    <Button variant="ghost" onClick={() => void remove(row)}>
                      {t("common.delete")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {blocks && (
        <Card title={t("control.interlocks.blocksTitle")} actions={<Button onClick={() => setBlocks(null)}>{t("common.close")}</Button>}>
          {blocks.rows.length === 0 ? (
            <EmptyState title={t("control.interlocks.noBlocks")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t("control.history.col.time")}</th>
                  <th>{t("control.history.col.device")}</th>
                  <th>{t("control.history.col.command")}</th>
                  <th>{t("control.history.col.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {blocks.rows.map((b) => (
                  <tr key={b.commandId}>
                    <td>{formatDateTime(b.at, timezone, lang, true)}</td>
                    <td>{b.deviceName ?? b.deviceId}</td>
                    <td className="font-mono">{`${b.capability}.${b.command}`}</td>
                    <td>{b.message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {editing && form && (
        <Card title={editing.id ? t("control.interlocks.edit") : t("control.interlocks.new")} actions={<Button onClick={() => setEditing(null)}>{t("common.close")}</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t("control.interlocks.name")} value={form.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} error={err("name", t("control.interlocks.nameRequired"))} />
            <div className="flex flex-col gap-1">
              <SpaceSelect spaces={spaces} label={t("control.interlocks.space")} value={form.spaceId} onChange={(e) => set({ spaceId: e.target.value })} error={err("space", t("control.interlocks.spaceRequired"))} />
              <Checkbox label={t("control.scenes.includeChildren")} checked={form.includeChildren} onChange={(e) => set({ includeChildren: e.target.checked })} />
            </div>
            <SelectField label={t("control.interlocks.conditionKind")} value={form.kind} onChange={(e) => set({ kind: e.target.value as InterlockForm["kind"] })}>
              <option value="state">{t("control.interlocks.kindState")}</option>
              <option value="metric">{t("control.interlocks.kindMetric")}</option>
            </SelectField>
            <SelectField label={t("control.interlocks.conditionDevice")} value={form.deviceId} onChange={(e) => set({ deviceId: e.target.value })}>
              <option value="">{form.kind === "metric" ? t("control.interlocks.spaceAverage") : t("control.interlocks.measuresRelation")}</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectField>
            {form.kind === "metric" ? (
              <TextField label={t("control.interlocks.metric")} value={form.metric} placeholder="pm2_5" onChange={(e) => set({ metric: e.target.value })} error={err("metric", t("control.interlocks.metricRequired"))} />
            ) : (
              <>
                <TextField label={t("control.scenes.capability")} value={form.capability} onChange={(e) => set({ capability: e.target.value })} error={err("state", t("control.interlocks.stateRequired"))} />
                <TextField label={t("control.interlocks.attribute")} value={form.attribute} onChange={(e) => set({ attribute: e.target.value })} />
              </>
            )}
            <SelectField label={t("control.interlocks.op")} value={form.op} onChange={(e) => set({ op: e.target.value })}>
              {INTERLOCK_OPS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </SelectField>
            <TextField label={t("control.interlocks.value")} value={form.value} onChange={(e) => set({ value: e.target.value })} error={err("condition", t("control.interlocks.conditionInvalid"))} />
            <TextField label={t("control.interlocks.forbidCapability")} value={form.forbidCapability} onChange={(e) => set({ forbidCapability: e.target.value })} error={err("forbid", t("control.interlocks.forbidRequired"))} />
            <TextField label={t("control.interlocks.forbidCommand")} value={form.forbidCommand} onChange={(e) => set({ forbidCommand: e.target.value })} />
            <TextField label={t("control.interlocks.forbidAttribute")} value={form.forbidAttribute} onChange={(e) => set({ forbidAttribute: e.target.value })} />
            <TextField label={t("control.interlocks.forbidValues")} value={form.forbidValues} hint={t("control.interlocks.forbidValuesHint")} onChange={(e) => set({ forbidValues: e.target.value })} />
            <TextField label={t("control.interlocks.message")} value={form.message} maxLength={200} className="sm:col-span-2" onChange={(e) => set({ message: e.target.value })} error={err("message", t("control.interlocks.messageRequired"))} />
            <Checkbox label={t("control.common.enabled")} checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          </div>
          <p className="mt-2 text-[12.5px] text-muted">{t("control.interlocks.staleRule")}</p>
          <p className="mt-1 font-mono text-[12.5px]">
            {conditionText(interlockBody(form).condition as Interlock["condition"])} → {t("control.interlocks.forbidShort")} {forbidText(interlockBody(form).forbid as Interlock["forbid"])}
          </p>
          <div className="mt-3 flex justify-end">
            <Button variant="primary" onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
