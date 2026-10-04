/**
 * UI-ACT-03 일괄 제어(ACT-02.06, API-ACT-05). 기기 목록에서 여러 대를 고르거나 공간(+하위, 기능 필터)을 대상으로 한 번에 명령한다.
 * - 대상 500대 이하(BR-ACT-17, COMMAND_BULK_LIMIT_EXCEEDED), 기능 정의(API-ACT-25)로 인자 입력을 만든다
 * - [미리보기]: 기기별 현재 → 목표, 변경 없음·경고 / [실행]: 202 {bulkJobId} → 진행률 폴링(대기·실패 수)
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Dialog, SelectField, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { controlAdminApi, type BulkRequest, type ControlAdminApi } from "./admin-api";
import { AttributeInput } from "./control-panel";
import { BULK_LIMIT, bulkDone, stateText, type BulkJob, type BulkPreviewDevice, type CapabilityDefinition } from "./model/admin";
import { attributeRange, changedArgs, validateArgs, writableAttributes } from "./model/control";

export const BULK_POLL_MS = 2000;

export interface BulkControlDialogProps {
  open: boolean;
  onClose: () => void;
  target: { deviceIds: string[] } | { spaceId: string; includeChildren: boolean };
  /** 고를 수 있는 기능(기본 표준 기능) */
  capabilities?: string[];
  api?: ControlAdminApi;
  pollMs?: number;
}

export function BulkControlDialog({
  open,
  onClose,
  target,
  capabilities = ["Switch", "Thermostat", "FanSpeed", "Ventilation", "Dimmer", "Lock"],
  api = controlAdminApi,
  pollMs = BULK_POLL_MS,
}: BulkControlDialogProps) {
  const { t } = useTranslation();
  const [capability, setCapability] = useState("");
  const [definition, setDefinition] = useState<CapabilityDefinition | null>(null);
  const [args, setArgs] = useState<Record<string, unknown>>({});
  const [preview, setPreview] = useState<BulkPreviewDevice[] | null>(null);
  const [job, setJob] = useState<{ id: string; data: BulkJob | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const count = "deviceIds" in target ? target.deviceIds.length : null;
  const tooMany = count !== null && count > BULK_LIMIT;

  useEffect(() => {
    if (!capability) return setDefinition(null);
    let cancelled = false;
    void api.capability(capability).then((result) => {
      if (!cancelled) setDefinition(result.ok ? result.data : null);
    });
    return () => {
      cancelled = true;
    };
  }, [capability, api]);

  useEffect(() => {
    if (!job || (job.data && bulkDone(job.data))) return;
    const timer = setTimeout(async () => {
      const next = await api.bulkJob(job.id);
      if (next.ok) setJob({ id: job.id, data: next.data });
    }, pollMs);
    return () => clearTimeout(timer);
  }, [job, api, pollMs]);

  const control = definition ? { name: definition.name, attributes: definition.attributes, commands: definition.commands } : null;
  const sent = control ? changedArgs(null, control.name, args) : {};
  const problems = control ? validateArgs(control, sent) : [];
  const request = (): BulkRequest => ({
    target: "deviceIds" in target ? { deviceIds: target.deviceIds } : { spaceId: target.spaceId, includeChildren: target.includeChildren, capability },
    capability,
    command: "set",
    args: sent,
  });
  const ready = Boolean(control) && Object.keys(sent).length > 0 && problems.length === 0 && !tooMany;

  const doPreview = async () => {
    setError(null);
    const result = await api.bulkPreview(request());
    if (result.ok) setPreview(result.data.devices ?? []);
    else setError(errorText(t, result) ?? null);
  };

  const run = async () => {
    setError(null);
    const result = await api.bulkRun(request());
    if (!result.ok) return setError(errorText(t, result) ?? null);
    setJob({ id: result.data.bulkJobId, data: { total: result.data.total, succeeded: 0, failed: 0, queued: 0, skipped: 0, items: [] } });
  };

  const close = () => {
    setPreview(null);
    setJob(null);
    setArgs({});
    setError(null);
    onClose();
  };

  const progress = job?.data;
  return (
    <Dialog
      title={count !== null ? t("control.bulk.titleDevices", { n: count }) : t("control.bulk.titleSpace")}
      open={open}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{t("common.close")}</Button>
          {!job && (
            <>
              <Button disabled={!ready} onClick={() => void doPreview()}>
                {t("control.scenes.preview")}
              </Button>
              <Button variant="primary" disabled={!ready || !preview} onClick={() => void run()}>
                {t("control.bulk.run")}
              </Button>
            </>
          )}
        </>
      }
    >
      {tooMany && <Alert tone="danger">{t("errors.COMMAND_BULK_LIMIT_EXCEEDED")}</Alert>}
      {!job && (
        <>
          <SelectField
            label={t("control.scenes.capability")}
            value={capability}
            onChange={(e) => {
              setCapability(e.target.value);
              setArgs({});
              setPreview(null);
            }}
          >
            <option value="">{t("control.scenes.chooseCapability")}</option>
            {capabilities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
          {control &&
            writableAttributes(control).map((a) => {
              const range = attributeRange(control, a.name);
              const problem = problems.find((p) => p.attribute === a.name);
              return (
                <div key={a.name} className="flex flex-col gap-1">
                  <span className="text-[12.5px] font-medium text-muted">{t(`control.attr.${a.name}`, { defaultValue: a.name })}</span>
                  <AttributeInput
                    capability={control.name}
                    attribute={a}
                    range={range}
                    value={args[a.name]}
                    disabled={false}
                    onChange={(v) => {
                      setArgs((x) => ({ ...x, [a.name]: v }));
                      setPreview(null);
                    }}
                  />
                  {problem && (
                    <p role="alert" className="text-[12px] text-bad">
                      {t("control.validation.range", { min: range.min ?? "", max: range.max ?? "", unit: range.unit ?? "" })}
                    </p>
                  )}
                </div>
              );
            })}
          {preview && (
            <Table>
              <thead>
                <tr>
                  <th>{t("control.history.col.device")}</th>
                  <th>{t("control.scenes.current")}</th>
                  <th>{t("control.scenes.next")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((d) => (
                  <tr key={d.deviceId}>
                    <td>{d.name ?? d.deviceId}</td>
                    <td className="font-mono">{stateText(d.current)}</td>
                    <td className="font-mono">
                      {d.willChange ? stateText(d.target) : t("control.scenes.noChange")}
                      {(d.warnings ?? []).map((w) => (
                        <span key={w} className="ml-1 text-warn">
                          ⚠ {t(`control.reason.${w}`, { defaultValue: w })}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
      {progress && (
        <div role="status" className="flex flex-col gap-2 text-[13px]">
          <progress className="w-full" max={progress.total || 1} value={progress.succeeded + progress.failed + progress.skipped} aria-label={t("control.bulk.progress")} />
          <span>{t("control.bulk.summary", { done: progress.succeeded, total: progress.total, queued: progress.queued, failed: progress.failed, skipped: progress.skipped })}</span>
          {progress.items.filter((i) => i.status !== "APPLIED" && i.status !== "SUCCEEDED").length > 0 && (
            <ul className="text-[12.5px]">
              {progress.items
                .filter((i) => i.status !== "APPLIED" && i.status !== "SUCCEEDED")
                .map((i) => (
                  <li key={i.deviceId}>
                    {i.deviceId}: {t(`control.status.${i.status}`, { defaultValue: i.status })}
                    {i.reason && ` — ${t(`control.reason.${i.reason}`, { defaultValue: i.reason })}`}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </Dialog>
  );
}
