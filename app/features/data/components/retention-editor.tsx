/**
 * UI-TSD-04 데이터 보관 설정(TSD-05.01, TSD-02.01, TSD-05.03): 조직 기본(종류별 보관 일수·삭제 전 장기 보관), 재정의 표(측정 항목·모델별),
 * 저장 현황(API-TSD-43), 장기 보관 파일(API-TSD-33 목록). 저장 버튼은 먼저 영향 미리 보기(API-TSD-41)를 부르고, 기간이 줄면
 * 삭제될 행·용량·항목별 내역을 보여 준 뒤 [확인하고 저장](API-TSD-42 + confirmToken). 줄지 않으면 바로 저장한다.
 * 저장은 ADMIN만(보기는 INTEGRATOR도) — 권한 이름은 둘 다 TS_POLICY라 화면은 `canSave`로 받는다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Card, Dialog, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime, formatNumber } from "~/lib/format";
import { defaultDataApi, type DataApi } from "../api";
import {
  OVERRIDABLE,
  maxDays,
  newOverride,
  policyItems,
  splitPolicies,
  usageByTable,
  validateRetention,
  type ArchiveFile,
  type EffectivePolicy,
  type OrgRow,
  type OverrideRow,
  type PreviewResponse,
  type RetentionErrors,
  type StorageStats,
} from "../model/retention";
import { formatBytes } from "../model/storage";

export interface RetentionEditorProps {
  effective: EffectivePolicy[];
  stats: StorageStats | null;
  archives: ArchiveFile[];
  canSave: boolean;
  timezone: string;
  lang: string;
  /** 재정의 대상 후보 */
  metrics: { key: string; name?: string | null }[];
  models: { id: string; name: string }[];
  api?: DataApi;
}

const inputClass = "w-24 rounded border border-line bg-panel px-2 py-1 text-right font-mono text-[12.5px] aria-[invalid=true]:border-bad";

export function RetentionEditor({ effective, stats, archives, canSave, timezone, lang, metrics, models, api = defaultDataApi }: RetentionEditorProps) {
  const { t } = useTranslation();
  const initial = splitPolicies(effective);
  const [org, setOrg] = useState<OrgRow[]>(initial.org);
  const [overrides, setOverrides] = useState<OverrideRow[]>(initial.overrides);
  const [errors, setErrors] = useState<RetentionErrors>({});
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [failure, setFailure] = useState<{ code: string; message?: string }>();
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setOrgRow = (dc: string, patch: Partial<OrgRow>) => setOrg((rows) => rows.map((r) => (r.dataClass === dc ? { ...r, ...patch } : r)));
  const setOv = (key: string, patch: Partial<OverrideRow>) => setOverrides((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const errText = (key: string) => (errors[key] ? t(`data.retention.errors.${errors[key]}`) : undefined);

  const save = async (confirmToken?: string | null) => {
    setBusy(true);
    setFailure(undefined);
    const result = await api.saveRetention(policyItems(org, overrides), confirmToken);
    setBusy(false);
    setPreview(null);
    if (result.ok) {
      const next = splitPolicies(result.data.effective);
      setOrg(next.org);
      setOverrides(next.overrides);
      setSaved(result.data.appliesAt ?? "");
    } else setFailure({ code: result.code, message: result.message });
  };

  const start = async () => {
    setSaved(null);
    const found = validateRetention(org, overrides);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailure(undefined);
    const result = await api.previewRetention(policyItems(org, overrides));
    setBusy(false);
    if (!result.ok) {
      setFailure({ code: result.code, message: result.message });
      return;
    }
    if (result.data.shortened) setPreview(result.data);
    else await save();
  };

  const scopeName = (row: { scope: string; scopeRef: string }) => (row.scope === "MODEL" ? (models.find((m) => m.id === row.scopeRef)?.name ?? row.scopeRef) : row.scopeRef);
  const usage = usageByTable(stats);

  return (
    <div className="flex flex-col gap-4">
      <Card title={t("data.retention.orgDefault")}>
        <Table>
          <thead>
            <tr>
              <th>{t("data.retention.dataClass")}</th>
              <th>{t("data.retention.days")}</th>
              <th>{t("data.retention.allowed")}</th>
              <th>{t("data.retention.archive")}</th>
            </tr>
          </thead>
          <tbody>
            {org.map((row) => (
              <tr key={row.dataClass}>
                <td>{t(`data.retention.classes.${row.dataClass}`)}</td>
                <td>
                  <input
                    aria-label={t("data.retention.daysOf", { name: t(`data.retention.classes.${row.dataClass}`) })}
                    aria-invalid={errors[`org.${row.dataClass}`] ? true : undefined}
                    className={inputClass}
                    inputMode="numeric"
                    disabled={!canSave}
                    value={row.retainDays}
                    onChange={(e) => setOrgRow(row.dataClass, { retainDays: e.target.value })}
                  />
                  {errors[`org.${row.dataClass}`] && (
                    <p role="alert" className="text-[12px] text-bad-ink">
                      {errText(`org.${row.dataClass}`)}
                    </p>
                  )}
                </td>
                <td className="text-[12px] text-muted">{row.dataClass === "AGG_1D" ? t("data.retention.forever") : t("data.retention.range", { min: row.minDays, max: maxDays(row.dataClass) })}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={t("data.retention.archiveOf", { name: t(`data.retention.classes.${row.dataClass}`) })}
                    disabled={!canSave}
                    checked={row.archiveBeforeDelete}
                    onChange={(e) => setOrgRow(row.dataClass, { archiveBeforeDelete: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card
        title={t("data.retention.overrides")}
        actions={
          canSave && (
            <Button onClick={() => setOverrides((rows) => [...rows, newOverride()])}>{t("data.retention.addOverride")}</Button>
          )
        }
      >
        {overrides.length === 0 ? (
          <p className="text-[13px] text-muted">{t("data.retention.noOverrides")}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("data.retention.scope")}</th>
                <th>{t("data.retention.target")}</th>
                <th>{t("data.retention.dataClass")}</th>
                <th>{t("data.retention.days")}</th>
                <th>{t("data.retention.archive")}</th>
                <th>{t("data.retention.storeMode")}</th>
                <th>
                  <span className="sr-only">{t("data.common.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((row, i) => (
                <tr key={row.key}>
                  <td>
                    <select aria-label={t("data.retention.scopeOf", { n: i + 1 })} disabled={!canSave} className="rounded border border-line bg-panel px-1 text-[12.5px]" value={row.scope} onChange={(e) => setOv(row.key, { scope: e.target.value as OverrideRow["scope"], scopeRef: "" })}>
                      <option value="METRIC">{t("data.retention.scopes.METRIC")}</option>
                      <option value="MODEL">{t("data.retention.scopes.MODEL")}</option>
                    </select>
                  </td>
                  <td>
                    <select aria-label={t("data.retention.targetOf", { n: i + 1 })} disabled={!canSave} className="max-w-48 rounded border border-line bg-panel px-1 text-[12.5px]" value={row.scopeRef} onChange={(e) => setOv(row.key, { scopeRef: e.target.value })}>
                      <option value="">{t("data.schedule.choose")}</option>
                      {row.scope === "METRIC"
                        ? metrics.map((m) => (
                            <option key={m.key} value={m.key}>
                              {m.name ? `${m.name} (${m.key})` : m.key}
                            </option>
                          ))
                        : models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                      {row.scopeRef && !(row.scope === "METRIC" ? metrics.some((m) => m.key === row.scopeRef) : models.some((m) => m.id === row.scopeRef)) && <option value={row.scopeRef}>{scopeName(row)}</option>}
                    </select>
                  </td>
                  <td>
                    <select aria-label={t("data.retention.classOf", { n: i + 1 })} disabled={!canSave} className="rounded border border-line bg-panel px-1 text-[12.5px]" value={row.dataClass} onChange={(e) => setOv(row.key, { dataClass: e.target.value as OverrideRow["dataClass"] })}>
                      {OVERRIDABLE.map((dc) => (
                        <option key={dc} value={dc}>
                          {t(`data.retention.classes.${dc}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input aria-label={t("data.retention.overrideDaysOf", { n: i + 1 })} aria-invalid={errors[`ov.${row.key}`] ? true : undefined} disabled={!canSave} className={inputClass} inputMode="numeric" value={row.retainDays} onChange={(e) => setOv(row.key, { retainDays: e.target.value })} />
                    {errors[`ov.${row.key}`] && (
                      <p role="alert" className="text-[12px] text-bad-ink">
                        {errText(`ov.${row.key}`)}
                      </p>
                    )}
                  </td>
                  <td>
                    <input type="checkbox" aria-label={t("data.retention.overrideArchiveOf", { n: i + 1 })} disabled={!canSave} checked={row.archiveBeforeDelete} onChange={(e) => setOv(row.key, { archiveBeforeDelete: e.target.checked })} />
                  </td>
                  <td>
                    {row.scope === "METRIC" && row.dataClass === "TELEMETRY" ? (
                      <select aria-label={t("data.retention.storeModeOf", { n: i + 1 })} disabled={!canSave} className="rounded border border-line bg-panel px-1 text-[12.5px]" value={row.storeMode} onChange={(e) => setOv(row.key, { storeMode: e.target.value as OverrideRow["storeMode"] })}>
                        <option value="ALL">{t("data.retention.storeModes.ALL")}</option>
                        <option value="ON_CHANGE">{t("data.retention.storeModes.ON_CHANGE")}</option>
                      </select>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                  <td>
                    {canSave && (
                      <Button variant="ghost" aria-label={t("data.retention.removeOf", { n: i + 1 })} onClick={() => setOverrides((rows) => rows.filter((r) => r.key !== row.key))}>
                        {t("common.delete")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {failure && <Alert tone="danger">{errorText(t, failure)}</Alert>}
      {saved !== null && <Alert tone="success">{saved ? t("data.retention.savedAt", { at: formatDateTime(saved, timezone, lang) }) : t("common.saved")}</Alert>}
      {canSave && (
        <div className="flex justify-end">
          <Button variant="primary" disabled={busy} onClick={() => void start()}>
            {t("data.retention.previewAndSave")}
          </Button>
        </div>
      )}

      <Card title={t("data.retention.storage")}>
        {!stats ? (
          <p className="text-[13px] text-muted">{t("data.common.loadFailed")}</p>
        ) : (
          <>
            <p className="mb-2 text-[13px]">{t("data.retention.totalBytes", { size: formatBytes(stats.totalBytes) })}</p>
            <Table>
              <thead>
                <tr>
                  <th>{t("data.retention.table")}</th>
                  <th>{t("data.retention.partitions")}</th>
                  <th>{t("data.jobs.rows")}</th>
                  <th>{t("data.jobs.size")}</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.table}>
                    <td className="font-mono">{u.table}</td>
                    <td className="font-mono">{u.partitions}</td>
                    <td className="font-mono">{formatNumber(u.rows, lang)}</td>
                    <td className="font-mono">{formatBytes(u.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <details className="mt-2 text-[12.5px]">
              <summary className="cursor-pointer text-accent">{t("data.retention.partitionDetail")}</summary>
              <Table>
                <thead>
                  <tr>
                    <th>{t("data.retention.partition")}</th>
                    <th>{t("data.retention.state")}</th>
                    <th>{t("data.jobs.rows")}</th>
                    <th>{t("data.jobs.size")}</th>
                    <th>{t("data.retention.compression")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.partitions.map((p) => (
                    <tr key={`${p.table}.${p.name}`}>
                      <td className="font-mono">{p.name}</td>
                      <td>{p.state ? <Badge tone="neutral">{p.state}</Badge> : "–"}</td>
                      <td className="font-mono">{formatNumber(p.rows ?? null, lang)}</td>
                      <td className="font-mono">{formatBytes(p.bytes)}</td>
                      <td className="font-mono">{p.compressionRatio ? `${p.compressionRatio.toFixed(1)}×` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </details>
          </>
        )}
      </Card>

      <Card title={t("data.retention.archives")}>
        {archives.length === 0 ? (
          <p className="text-[13px] text-muted">{t("data.retention.noArchives")}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("data.retention.dataClass")}</th>
                <th>{t("data.retention.period")}</th>
                <th>{t("data.jobs.rows")}</th>
                <th>{t("data.jobs.size")}</th>
                <th>{t("data.jobs.createdAt")}</th>
              </tr>
            </thead>
            <tbody>
              {archives.map((a) => (
                <tr key={a.id}>
                  <td>{t(`data.retention.classes.${a.dataClass}`, { defaultValue: a.dataClass })}</td>
                  <td>{`${formatDateTime(a.rangeFrom, timezone, lang)} ~ ${formatDateTime(a.rangeTo, timezone, lang)}`}</td>
                  <td className="font-mono">{formatNumber(a.rowsCount, lang)}</td>
                  <td className="font-mono">{formatBytes(a.bytes)}</td>
                  <td>{formatDateTime(a.createdAt, timezone, lang)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={t("data.retention.previewTitle")}
        footer={
          <>
            <Button onClick={() => setPreview(null)}>{t("common.cancel")}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void save(preview?.confirmToken)}>
              {t("data.retention.confirmSave")}
            </Button>
          </>
        }
      >
        {preview && (
          <>
            <p className="text-[13px]">{t("data.retention.previewBody", { rows: formatNumber(preview.affectedRows, lang), size: formatBytes(preview.affectedBytes) })}</p>
            <Table>
              <thead>
                <tr>
                  <th>{t("data.retention.target")}</th>
                  <th>{t("data.retention.dataClass")}</th>
                  <th>{t("data.jobs.rows")}</th>
                  <th>{t("data.jobs.size")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.byMetric.map((m, i) => (
                  <tr key={i}>
                    <td>{m.scope === "ORG" ? t("data.retention.scopes.ORG") : scopeName({ scope: m.scope, scopeRef: m.scopeRef ?? "" })}</td>
                    <td>{t(`data.retention.classes.${m.dataClass}`, { defaultValue: m.dataClass })}</td>
                    <td className="font-mono">{formatNumber(m.rows, lang)}</td>
                    <td className="font-mono">{formatBytes(m.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="text-[12px] text-muted">{t("data.retention.previewNote")}</p>
          </>
        )}
      </Dialog>
    </div>
  );
}
