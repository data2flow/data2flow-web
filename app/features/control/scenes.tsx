/**
 * UI-ACT-04 장면 편집·미리보기·실행(ACT-05.01·05.02·05.03).
 * - 항목: 대상(기기 / 관계: 공간 + controls + 기능, 하위 포함), 기능, 목표 상태(`속성=값` 목록). 최대 100개(BR-ACT-16)
 * - 저장 API-ACT-10(수정은 baseVersion), 미리보기 API-ACT-12(기기별 현재 → 바뀔 상태, "변경 없음", 차단 예상·오프라인), 실행 API-ACT-11 → 결과 폴링(API-ACT-11 scene-runs)
 * - 권한: 편집 SCENE_MANAGE, 실행 SCENE_RUN. 권한이 없으면 읽기 전용
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, SelectField, Table, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { findSpace, type SpaceNode } from "~/lib/spaces";
import { controlAdminApi, type ControlAdminApi } from "./admin-api";
import {
  SCENE_ITEM_LIMIT,
  desiredText,
  idText,
  normalizeSceneItem,
  parseDesired,
  previewSummary,
  runSummary,
  sceneProblems,
  stateText,
  type Scene,
  type SceneItem,
  type ScenePreviewItem,
  type SceneRun,
} from "./model/admin";

export const SCENE_RUN_POLL_MS = 2000;

interface Row {
  mode: "device" | "relation";
  deviceId: string;
  spaceId: string;
  includeChildren: boolean;
  capability: string;
  desired: string;
}

const toRow = (item: SceneItem): Row => ({
  mode: item.target.deviceId != null && item.target.deviceId !== "" ? "device" : "relation",
  // core는 대상 ID를 JSON 숫자로 돌려준다
  deviceId: idText(item.target.deviceId) ?? "",
  spaceId: idText(item.target.spaceId) ?? "",
  includeChildren: Boolean(item.target.includeChildren),
  capability: item.capability,
  desired: desiredText(item.desired),
});

export interface SceneEditorProps {
  scene: Scene | null;
  devices: { id: string; name: string }[];
  spaces: SpaceNode[];
  capabilities: string[];
  canManage: boolean;
  canRun: boolean;
  api?: ControlAdminApi;
  onSaved?: (scene: Scene) => void;
  onDeleted?: () => void;
  pollMs?: number;
}

export function SceneEditor({ scene, devices, spaces, capabilities, canManage, canRun, api = controlAdminApi, onSaved, onDeleted, pollMs = SCENE_RUN_POLL_MS }: SceneEditorProps) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<Scene | null>(scene);
  const [name, setName] = useState(scene?.name ?? "");
  const [description, setDescription] = useState(scene?.description ?? "");
  const [rows, setRows] = useState<Row[]>(() => (scene?.items ?? []).map(toRow));
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [preview, setPreview] = useState<ScenePreviewItem[] | null>(null);
  const [run, setRun] = useState<SceneRun | null>(null);
  const runId = useRef<string | null>(null);

  const items: SceneItem[] = rows.map((r) => ({
    target: r.mode === "device" ? { deviceId: r.deviceId || null } : { spaceId: r.spaceId || null, relation: "controls", capability: r.capability, includeChildren: r.includeChildren },
    capability: r.capability,
    desired: parseDesired(r.desired) ?? {},
  }));
  const problems = sceneProblems(name, items);
  const badDesired = rows.map((r) => parseDesired(r.desired) === undefined);
  const dirty =
    !current ||
    name !== current.name ||
    (description ?? "") !== (current.description ?? "") ||
    JSON.stringify(items.map(normalizeSceneItem)) !== JSON.stringify((current.items ?? []).map(normalizeSceneItem));

  useEffect(() => {
    if (!run || run.status !== "RUNNING" || !runId.current) return;
    const id = runId.current;
    const timer = setTimeout(async () => {
      const next = await api.sceneRun(id);
      if (next.ok) setRun(next.data);
    }, pollMs);
    return () => clearTimeout(timer);
  }, [run, api, pollMs]);

  const update = (i: number, patch: Partial<Row>) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const fieldError = (field: string) => (submitted ? problems.find((p) => p.field === field) : undefined);

  const save = async () => {
    setSubmitted(true);
    setNotice(null);
    if (problems.length > 0 || badDesired.some(Boolean)) return;
    const body = { name: name.trim(), description: description.trim() || undefined, items: items.map(normalizeSceneItem) };
    const result = current ? await api.updateScene(current.sceneId, { ...body, baseVersion: current.version }) : await api.createScene(body);
    if (!result.ok) {
      setNotice({ tone: "danger", text: result.code === "VERSION_CONFLICT" ? t("control.scenes.conflict") : (errorText(t, result) ?? "") });
      return;
    }
    setCurrent(result.data);
    setPreview(null);
    setNotice({ tone: "success", text: t("control.scenes.saved") });
    onSaved?.(result.data);
  };

  const doPreview = async () => {
    if (!current) return;
    setNotice(null);
    const result = await api.previewScene(current.sceneId);
    if (result.ok) setPreview(result.data.items ?? []);
    else setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
  };

  const doRun = async () => {
    if (!current) return;
    setNotice(null);
    const result = await api.runScene(current.sceneId);
    if (!result.ok) {
      setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
      return;
    }
    runId.current = result.data.sceneRunId;
    const first = await api.sceneRun(result.data.sceneRunId);
    setRun(first.ok ? first.data : { status: "RUNNING", results: [] });
  };

  const remove = async () => {
    if (!current || !window.confirm(t("control.scenes.deleteConfirm", { name: current.name }))) return;
    const result = await api.deleteScene(current.sceneId);
    if (result.ok) onDeleted?.();
    else setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
  };

  const deviceName = (id: string) => devices.find((d) => d.id === id)?.name ?? id;
  const summary = preview ? previewSummary(preview) : null;
  const result = run ? runSummary(run) : null;

  return (
    <div className="flex flex-col gap-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card title={t("control.scenes.edit")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={t("control.scenes.name")}
            value={name}
            maxLength={60}
            readOnly={!canManage}
            onChange={(e) => setName(e.target.value)}
            error={fieldError("name") ? t("control.scenes.nameInvalid") : undefined}
          />
          <TextField label={t("control.scenes.description")} value={description} readOnly={!canManage} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="mt-3">
          <Table>
            <thead>
              <tr>
                <th>{t("control.scenes.target")}</th>
                <th>{t("control.scenes.capability")}</th>
                <th>{t("control.scenes.desired")}</th>
                {canManage && <th>{t("control.history.col.actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>
                    <div className="flex flex-col gap-1">
                      <SelectField label={t("control.scenes.targetType", { n: i + 1 })} value={row.mode} disabled={!canManage} onChange={(e) => update(i, { mode: e.target.value as Row["mode"] })}>
                        <option value="device">{t("control.scenes.byDevice")}</option>
                        <option value="relation">{t("control.scenes.byRelation")}</option>
                      </SelectField>
                      {row.mode === "device" ? (
                        <SelectField
                          label={t("control.scenes.device", { n: i + 1 })}
                          value={row.deviceId}
                          disabled={!canManage}
                          onChange={(e) => update(i, { deviceId: e.target.value })}
                          error={fieldError(`items[${i}].target`) ? t("control.scenes.targetRequired") : undefined}
                        >
                          <option value="">{t("control.scenes.chooseDevice")}</option>
                          {devices.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </SelectField>
                      ) : (
                        <>
                          <SpaceSelect
                            spaces={spaces}
                            label={t("control.scenes.space", { n: i + 1 })}
                            value={row.spaceId}
                            disabled={!canManage}
                            onChange={(e) => update(i, { spaceId: e.target.value })}
                            error={fieldError(`items[${i}].target`) ? t("control.scenes.targetRequired") : undefined}
                          />
                          <Checkbox
                            label={t("control.scenes.includeChildren")}
                            checked={row.includeChildren}
                            disabled={!canManage}
                            onChange={(e) => update(i, { includeChildren: e.target.checked })}
                          />
                        </>
                      )}
                    </div>
                  </td>
                  <td>
                    <SelectField
                      label={t("control.scenes.capabilityOf", { n: i + 1 })}
                      value={row.capability}
                      disabled={!canManage}
                      onChange={(e) => update(i, { capability: e.target.value })}
                      error={fieldError(`items[${i}].capability`) ? t("control.scenes.capabilityRequired") : undefined}
                    >
                      <option value="">{t("control.scenes.chooseCapability")}</option>
                      {capabilities.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </SelectField>
                  </td>
                  <td>
                    <TextField
                      label={t("control.scenes.desiredOf", { n: i + 1 })}
                      value={row.desired}
                      placeholder="mode=cool, targetTemperature=24"
                      readOnly={!canManage}
                      onChange={(e) => update(i, { desired: e.target.value })}
                      error={submitted && (badDesired[i] || fieldError(`items[${i}].desired`)) ? t("control.scenes.desiredInvalid") : undefined}
                    />
                  </td>
                  {canManage && (
                    <td>
                      <Button variant="ghost" onClick={() => setRows((list) => list.filter((_, j) => j !== i))}>
                        {t("common.delete")}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
          {rows.length === 0 && <EmptyState title={t("control.scenes.noItems")} />}
          {submitted && fieldError("items") && (
            <p role="alert" className="mt-1 text-[12.5px] text-bad-ink">
              {fieldError("items")?.code === "SCENE_ITEM_LIMIT_EXCEEDED" ? t("errors.SCENE_ITEM_LIMIT_EXCEEDED") : t("control.scenes.itemsRequired")}
            </p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            {canManage && (
              <Button
                disabled={rows.length >= SCENE_ITEM_LIMIT}
                onClick={() => setRows((list) => [...list, { mode: "device", deviceId: "", spaceId: "", includeChildren: true, capability: "", desired: "" }])}
              >
                {t("control.scenes.addItem")}
              </Button>
            )}
            {canManage && current && (
              <Button variant="danger" onClick={() => void remove()}>
                {t("common.delete")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button disabled={!current || dirty} onClick={() => void doPreview()}>
              {t("control.scenes.preview")}
            </Button>
            {canManage && (
              <Button variant="primary" onClick={() => void save()}>
                {t("common.save")}
              </Button>
            )}
            {canRun && (
              <Button variant="primary" disabled={!current || dirty} onClick={() => void doRun()}>
                {t("control.scenes.run")}
              </Button>
            )}
          </div>
        </div>
        {current && dirty && <p className="mt-2 text-[12px] text-muted">{t("control.scenes.saveFirst")}</p>}
      </Card>

      {preview && summary && (
        <Card title={t("control.scenes.previewTitle")}>
          <p className="mb-2 text-[13px]">{t("control.scenes.previewSummary", summary)}</p>
          <Table>
            <thead>
              <tr>
                <th>{t("control.history.col.device")}</th>
                <th>{t("control.scenes.capability")}</th>
                <th>{t("control.scenes.current")}</th>
                <th>{t("control.scenes.next")}</th>
                <th>{t("control.scenes.note")}</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((p) => (
                <tr key={`${p.deviceId}-${p.capability}`}>
                  <td>{p.name ?? deviceName(p.deviceId)}</td>
                  <td className="font-mono">{p.capability}</td>
                  <td className="font-mono">{stateText(p.current)}</td>
                  <td className="font-mono">{p.willChange ? stateText(p.target) : t("control.scenes.noChange")}</td>
                  <td>
                    {p.predictedBlock && (
                      <span className="text-bad-ink" title={p.predictedBlock.message ?? undefined}>
                        ⚠ {t("control.scenes.predictedBlock", { message: p.predictedBlock.message ?? p.predictedBlock.reason })}
                      </span>
                    )}
                    {p.offline && <Badge tone="warning">{t("control.connectivity.OFFLINE")}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {run && result && (
        <Card title={t("control.scenes.runTitle")}>
          <p className="mb-2 text-[13px]" role="status">
            {t(`control.scenes.runStatus.${run.status}`, { defaultValue: run.status })} — {t("control.scenes.runSummary", result)}
          </p>
          <Table>
            <thead>
              <tr>
                <th>{t("control.history.col.device")}</th>
                <th>{t("control.history.col.status")}</th>
                <th>{t("control.history.col.reason")}</th>
              </tr>
            </thead>
            <tbody>
              {run.results.map((r) => (
                <tr key={`${r.deviceId}-${r.commandId ?? ""}`}>
                  <td>{deviceName(r.deviceId)}</td>
                  <td>{t(`control.status.${r.status}`, { defaultValue: r.status })}</td>
                  <td>{r.reason ? t(`control.reason.${r.reason}`, { defaultValue: r.reason }) : ""}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

export function sceneSpaceName(spaces: SpaceNode[], id: string | null | undefined): string {
  return id ? (findSpace(spaces, id)?.name ?? `#${id}`) : "–";
}
