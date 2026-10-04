/**
 * UI-DEV-12 일괄 작업(DEV-02.09): 마법사(대상 → 유형·값 → 미리 보기 dryRun → 실행)와 상세(진행률, 기기별 결과, 실패만 보기, 실패분 다시 실행, 취소).
 * API: 실행 API-DEV-70(dryRun이면 {targetCount, sample}), 상세·항목 API-DEV-72, 재실행 API-DEV-73, 취소 API-DEV-74. 진행 중이면 3초마다 다시 읽는다.
 * 권한: 조회 VIEWER 이상, 생성·재실행·취소 DEV_ADMIN, 명령 전송(SEND_COMMAND)은 DEVICE_CONTROL도 필요.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, SelectField, Table, TextField } from "~/components/ui";
import { bffJson, clientIdempotencyKey, type BffJsonResult } from "~/lib/bff-client";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { SpaceNode } from "~/lib/spaces";
import { JOB_TYPES, emptyJobForm, isRunning, jobParams, jobPercent, jobProblems, jobTone, type DeviceJob, type DeviceJobItem, type JobForm, type JobType } from "./model/jobs";

export const JOB_POLL_MS = 3000;

type R<T> = Promise<BffJsonResult<T>>;

export interface DeviceJobsApi {
  create(body: { type: JobType; target: { deviceIds: string[] } | { groupId: string }; params: Record<string, unknown>; dryRun?: boolean }): R<DeviceJob & { targetCount?: number; sample?: { deviceId: string; name?: string; before?: unknown; after?: unknown }[]; deniedCount?: number }>;
  job(id: string): R<DeviceJob>;
  items(id: string, status?: string): R<{ responses: DeviceJobItem[]; totalCount?: number }>;
  retryFailed(id: string): R<DeviceJob>;
  cancel(id: string): R<DeviceJob>;
}

const base = "/bff/api/core/device-jobs";
export const deviceJobsApi: DeviceJobsApi = {
  create: (body) => bffJson(base, { method: "POST", body, idempotencyKey: body.dryRun ? undefined : clientIdempotencyKey() }),
  job: (id) => bffJson(`${base}/${encodeURIComponent(id)}`),
  items: (id, status) => bffJson(`${base}/${encodeURIComponent(id)}/items?size=100${status ? `&status=${status}` : ""}`),
  retryFailed: (id) => bffJson(`${base}/${encodeURIComponent(id)}/retry-failed`, { method: "POST", body: {}, idempotencyKey: clientIdempotencyKey() }),
  cancel: (id) => bffJson(`${base}/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {} }),
};

function jobErrorText(t: (k: string) => string, failure: { code: string; message?: string }, fallback: (f: { code: string; message?: string }) => string | undefined): string {
  if (failure.code === "JOB_LIMIT_EXCEEDED") return t("devices.jobs.concurrentLimit");
  return fallback(failure) ?? "";
}

export interface JobWizardProps {
  deviceIds: string[];
  groups: { id: string; name: string }[];
  models: { id: string; name: string }[];
  spaces: SpaceNode[];
  canControl: boolean;
  api?: DeviceJobsApi;
  onCreated: (job: DeviceJob) => void;
}

export function JobWizard({ deviceIds, groups, models, spaces, canControl, api = deviceJobsApi, onCreated }: JobWizardProps) {
  const { t } = useTranslation();
  const [targetKind, setTargetKind] = useState<"devices" | "group">(deviceIds.length > 0 ? "devices" : "group");
  const [groupId, setGroupId] = useState("");
  const [form, setForm] = useState<JobForm>(emptyJobForm);
  const [preview, setPreview] = useState<{ targetCount: number; sample: { deviceId: string; name?: string }[]; deniedCount?: number } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetCount = targetKind === "devices" ? deviceIds.length : groupId ? 1 : 0;
  const problems = jobProblems(form, targetCount);
  const set = (patch: Partial<JobForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setPreview(null);
  };
  const err = (key: string, text: string) => (submitted && problems.includes(key) ? text : undefined);
  const body = (dryRun: boolean) => ({ type: form.type, target: targetKind === "devices" ? { deviceIds } : { groupId }, params: jobParams(form), dryRun });

  const doPreview = async () => {
    setSubmitted(true);
    setError(null);
    if (problems.length > 0) return;
    const result = await api.create(body(true));
    if (result.ok) setPreview({ targetCount: result.data.targetCount ?? result.data.total ?? 0, sample: result.data.sample ?? [], deniedCount: result.data.deniedCount });
    else setError(jobErrorText(t, result, (f) => errorText(t, f)));
  };

  const run = async () => {
    setSubmitted(true);
    setError(null);
    if (problems.length > 0) return;
    const result = await api.create(body(false));
    if (result.ok) onCreated(result.data);
    else setError(jobErrorText(t, result, (f) => errorText(t, f)));
  };

  const types = JOB_TYPES.filter((type) => type !== "SEND_COMMAND" || canControl);
  return (
    <Card title={t("devices.jobs.wizard")}>
      <ol className="flex flex-col gap-4">
        <li>
          <h3 className="mb-2 text-[13px] font-semibold">{t("devices.jobs.step1")}</h3>
          <div className="flex flex-wrap items-end gap-3">
            <SelectField label={t("devices.jobs.targetKind")} value={targetKind} onChange={(e) => {
                setTargetKind(e.target.value as "devices" | "group");
                setPreview(null);
              }}>
              <option value="devices">{t("devices.jobs.targetDevices", { n: deviceIds.length })}</option>
              <option value="group">{t("devices.jobs.targetGroup")}</option>
            </SelectField>
            {targetKind === "group" && (
              <SelectField label={t("devices.jobs.group")} value={groupId} onChange={(e) => {
                  setGroupId(e.target.value);
                  setPreview(null);
                }}>
                <option value="">{t("devices.jobs.chooseGroup")}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </SelectField>
            )}
          </div>
          {submitted && problems.includes("targetEmpty") && (
            <p role="alert" className="mt-1 text-[12.5px] text-bad">
              {t("devices.jobs.targetEmpty")}
            </p>
          )}
          {problems.includes("targetLimit") && (
            <p role="alert" className="mt-1 text-[12.5px] text-bad">
              {t("devices.jobs.targetLimit")}
            </p>
          )}
        </li>
        <li>
          <h3 className="mb-2 text-[13px] font-semibold">{t("devices.jobs.step2")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label={t("devices.jobs.type")} value={form.type} onChange={(e) => set({ type: e.target.value as JobType })}>
              {types.map((type) => (
                <option key={type} value={type}>
                  {t(`devices.jobs.types.${type}`)}
                </option>
              ))}
            </SelectField>
            {form.type === "SET_MODEL" && (
              <SelectField label={t("devices.model")} value={form.modelId} onChange={(e) => set({ modelId: e.target.value })} error={err("modelId", t("devices.jobs.valueRequired"))}>
                <option value="">{t("devices.chooseModel")}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </SelectField>
            )}
            {form.type === "SET_SPACE" && <SpaceSelect spaces={spaces} label={t("devices.space")} value={form.spaceId} onChange={(e) => set({ spaceId: e.target.value })} error={err("spaceId", t("devices.jobs.valueRequired"))} />}
            {form.type === "SET_STATUS" && (
              <SelectField label={t("devices.status")} value={form.status} onChange={(e) => set({ status: e.target.value as JobForm["status"] })}>
                <option value="ACTIVE">{t("devices.activate")}</option>
                <option value="INACTIVE">{t("devices.deactivate")}</option>
              </SelectField>
            )}
            {(form.type === "ADD_TAGS" || form.type === "REMOVE_TAGS") && <TextField label={t("devices.tags")} value={form.tags} hint={t("devices.tagHint")} onChange={(e) => set({ tags: e.target.value })} error={err("tags", t("devices.jobs.valueRequired"))} />}
            {form.type === "SET_ATTRIBUTES" && (
              <>
                <SelectField label={t("devices.jobs.attrScope")} value={form.attrScope} onChange={(e) => set({ attrScope: e.target.value as JobForm["attrScope"] })}>
                  <option value="SERVER">SERVER</option>
                  <option value="SHARED">SHARED</option>
                </SelectField>
                <TextField label={t("devices.jobs.attributes")} value={form.attributes} onChange={(e) => set({ attributes: e.target.value })} error={err("attributes", t("devices.jobs.jsonRequired"))} />
              </>
            )}
            {form.type === "SEND_COMMAND" && (
              <>
                <TextField label={t("devices.jobs.capability")} value={form.capability} placeholder="Switch" onChange={(e) => set({ capability: e.target.value })} error={err("command", t("devices.jobs.valueRequired"))} />
                <TextField label={t("devices.jobs.command")} value={form.command} onChange={(e) => set({ command: e.target.value })} />
                <TextField label={t("devices.jobs.args")} value={form.args} onChange={(e) => set({ args: e.target.value })} error={err("args", t("devices.jobs.jsonRequired"))} />
              </>
            )}
          </div>
        </li>
        <li>
          <h3 className="mb-2 text-[13px] font-semibold">{t("devices.jobs.step3")}</h3>
          {preview ? (
            <div className="text-[13px]">
              <p>{t("devices.jobs.previewSummary", { n: preview.targetCount, type: t(`devices.jobs.types.${form.type}`) })}</p>
              {(preview.deniedCount ?? 0) > 0 && <Alert tone="warning">{t("devices.jobs.denied", { n: preview.deniedCount })}</Alert>}
              <ul className="mt-1 text-[12.5px] text-muted">
                {preview.sample.slice(0, 10).map((s) => (
                  <li key={s.deviceId}>{s.name ?? s.deviceId}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">{t("devices.jobs.previewFirst")}</p>
          )}
        </li>
      </ol>
      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={() => void doPreview()}>{t("devices.jobs.preview")}</Button>
        <Button variant="primary" disabled={!preview} onClick={() => void run()}>
          {t("devices.jobs.run")}
        </Button>
      </div>
    </Card>
  );
}

export interface JobDetailProps {
  initial: DeviceJob;
  initialItems: DeviceJobItem[];
  canAdmin: boolean;
  timezone: string;
  lang: string;
  api?: DeviceJobsApi;
  pollMs?: number;
  onRetried: (job: DeviceJob) => void;
}

export function JobDetail({ initial, initialItems, canAdmin, timezone, lang, api = deviceJobsApi, pollMs = JOB_POLL_MS, onRetried }: JobDetailProps) {
  const { t } = useTranslation();
  const [job, setJob] = useState(initial);
  const [items, setItems] = useState(initialItems);
  const [failedOnly, setFailedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isRunning(job.status) || !pollMs) return;
    const timer = setTimeout(async () => {
      const [next, rows] = await Promise.all([api.job(job.id), api.items(job.id)]);
      if (next.ok) setJob(next.data);
      if (rows.ok) setItems(rows.data.responses ?? []);
    }, pollMs);
    return () => clearTimeout(timer);
  }, [job, api, pollMs]);

  const retry = async () => {
    setError(null);
    const result = await api.retryFailed(job.id);
    if (result.ok) onRetried(result.data);
    else setError(jobErrorText(t, result, (f) => errorText(t, f)));
  };

  const cancel = async () => {
    setError(null);
    const result = await api.cancel(job.id);
    if (result.ok) setJob(result.data);
    else setError(errorText(t, result) ?? null);
  };

  const shown = failedOnly ? items.filter((i) => i.status === "FAILED") : items;
  const percent = jobPercent(job);
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          {t("devices.jobs.detailTitle", { id: job.id, type: t(`devices.jobs.types.${job.type}`, { defaultValue: job.type }) })}
          <Badge tone={jobTone(job.status)}>{t(`devices.jobs.statuses.${job.status}`, { defaultValue: job.status })}</Badge>
        </span>
      }
    >
      <div role="status" className="mb-3 flex flex-col gap-1 text-[13px]">
        <progress className="w-full" max={100} value={percent} aria-label={t("devices.jobs.progress")} />
        <span>{t("devices.jobs.progressLine", { succeeded: job.succeeded, failed: job.failed, total: job.total })}</span>
        {job.retryOfJobId && <span className="text-muted">{t("devices.jobs.retryOf", { id: job.retryOfJobId })}</span>}
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Checkbox label={t("devices.jobs.failedOnly")} checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} />
        {canAdmin && (
          <div className="flex gap-2">
            {isRunning(job.status) && (
              <Button variant="danger" onClick={() => void cancel()}>
                {t("common.cancel")}
              </Button>
            )}
            {!isRunning(job.status) && job.failed > 0 && (
              <Button variant="primary" onClick={() => void retry()}>
                {t("devices.jobs.retryFailed")}
              </Button>
            )}
          </div>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {shown.length === 0 ? (
        <EmptyState title={t("devices.jobs.noItems")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t("devices.name")}</th>
              <th>{t("devices.status")}</th>
              <th>{t("devices.jobs.error")}</th>
              <th>{t("devices.jobs.finishedAt")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => (
              <tr key={item.id}>
                <td>
                  <a href={`/devices/${encodeURIComponent(item.deviceId)}`} className="text-accent hover:underline">
                    {item.deviceName ?? item.deviceId}
                  </a>
                  {item.commandId && <span className="ml-1 font-mono text-[11.5px] text-muted">{item.commandId}</span>}
                </td>
                <td>
                  <Badge tone={item.status === "SUCCEEDED" ? "success" : item.status === "FAILED" ? "danger" : "neutral"}>{t(`devices.jobs.itemStatuses.${item.status}`, { defaultValue: item.status })}</Badge>
                </td>
                <td>
                  {item.errorCode && <span className="font-mono text-[12px]">{item.errorCode}</span>} {item.errorMessage ?? ""}
                </td>
                <td>{formatDateTime(item.finishedAt, timezone, lang, true)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
