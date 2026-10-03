/**
 * UI-SIM-10 장애 주입 대화상자(SIM-05.03, BR-SIM-15): 대상은 가상 센서(여러 대) 또는 가상 게이트웨이만,
 * 종류별 강도 칸(API-SIM-20 표), 시작(지금·N분 뒤, 시뮬레이션 시각), 지속(1분~24시간),
 * 진행 중·예정 장애 목록과 [해제](API-SIM-21). 실제 기기는 고를 수 없고, 서버 거부(400 SIM_TARGET_NOT_VIRTUAL)는 문구로 보인다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Dialog, SelectField, Table, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { SimApi } from "../api";
import { GATEWAY_FAULTS, SENSOR_FAULTS, buildFault, faultSpecs, type Problem } from "../model/sim";
import type { SimFault } from "../model/types";
import { useProblemText } from "./common";

export interface FaultTarget {
  deviceId: string;
  name: string;
  virtual: boolean;
}

export function FaultDialog({
  open,
  onClose,
  runId,
  targets,
  api,
}: {
  open: boolean;
  onClose: () => void;
  runId: string | null;
  targets: FaultTarget[];
  api: Pick<SimApi, "faults" | "injectFault" | "cancelFault">;
}) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const [targetType, setTargetType] = useState<"DEVICE" | "GATEWAY">("DEVICE");
  const [selected, setSelected] = useState<string[]>([]);
  const [gatewayId, setGatewayId] = useState("");
  const [kind, setKind] = useState("STUCK");
  const [params, setParams] = useState<Record<string, string>>({});
  const [startMode, setStartMode] = useState<"now" | "later">("now");
  const [startInMin, setStartInMin] = useState("5");
  const [durationMin, setDurationMin] = useState("30");
  const [problems, setProblems] = useState<Record<string, Problem>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [active, setActive] = useState<SimFault[]>([]);

  const load = useCallback(async () => {
    const result = await api.faults(runId);
    if (result.ok) setActive((result.data.responses ?? []).filter((f) => f.status === "ACTIVE" || f.status === "SCHEDULED"));
  }, [api, runId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const virtualTargets = targets.filter((d) => d.virtual);
  const kinds = Object.keys(targetType === "DEVICE" ? SENSOR_FAULTS : GATEWAY_FAULTS);

  const changeType = (type: "DEVICE" | "GATEWAY") => {
    setTargetType(type);
    setKind(type === "DEVICE" ? "STUCK" : "GATEWAY_DOWN");
    setParams({});
    setProblems({});
  };

  const submit = async () => {
    setError(null);
    setNotice(null);
    const built = buildFault({ runId, targetType, targetIds: targetType === "DEVICE" ? selected : gatewayId.trim() ? [gatewayId.trim()] : [], kind, params, startMode, startInMin, durationMin });
    setProblems(built.problems);
    if (!built.body) return;
    const result = await api.injectFault(built.body);
    if (!result.ok) {
      setError(errorText(t, result) ?? null);
      return;
    }
    setNotice(t("sim.fault.injected", { n: result.data.faultIds?.length ?? 0 }));
    void load();
  };

  const cancel = async (faultId: string) => {
    const result = await api.cancelFault(faultId);
    if (!result.ok) setError(errorText(t, result) ?? null);
    void load();
  };

  return (
    <Dialog
      title={t("sim.fault.title")}
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit}>
            {t("sim.fault.inject")}
          </Button>
        </>
      }
    >
      <SelectField label={t("sim.fault.targetType")} value={targetType} onChange={(e) => changeType(e.target.value as "DEVICE" | "GATEWAY")}>
        <option value="DEVICE">{t("sim.fault.targetDevice")}</option>
        <option value="GATEWAY">{t("sim.fault.targetGateway")}</option>
      </SelectField>
      {targetType === "DEVICE" ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[12.5px] font-medium text-muted">{t("sim.fault.targets")}</legend>
          {virtualTargets.length === 0 && <p className="text-[12.5px] text-muted">{t("sim.fault.noTargets")}</p>}
          {virtualTargets.map((d) => (
            <label key={d.deviceId} className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={selected.includes(d.deviceId)} onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, d.deviceId] : prev.filter((x) => x !== d.deviceId)))} />
              {d.name}
            </label>
          ))}
          {targets.length > virtualTargets.length && <p className="text-[12px] text-muted">{t("sim.fault.realHidden", { n: targets.length - virtualTargets.length })}</p>}
          {problems.targetIds && (
            <p role="alert" className="text-[12px] text-bad">
              {problemText(problems.targetIds)}
            </p>
          )}
        </fieldset>
      ) : (
        <TextField label={t("sim.fault.gatewayId")} value={gatewayId} onChange={(e) => setGatewayId(e.target.value)} error={problemText(problems.targetIds)} />
      )}
      <SelectField
        label={t("sim.fault.kind")}
        value={kind}
        onChange={(e) => {
          setKind(e.target.value);
          setParams({});
        }}
      >
        {kinds.map((k) => (
          <option key={k} value={k}>
            {t(`sim.fault.kinds.${k}`)}
          </option>
        ))}
      </SelectField>
      {faultSpecs(kind).map((spec) => (
        <TextField
          key={`${kind}.${spec.name}`}
          label={`${t(`sim.fault.params.${spec.name}`)} (${spec.min}~${spec.max})`}
          inputMode="decimal"
          value={params[spec.name] ?? ""}
          onChange={(e) => setParams((prev) => ({ ...prev, [spec.name]: e.target.value }))}
          error={problemText(problems[`params.${spec.name}`])}
          hint={spec.optional ? t("sim.fault.optional") : undefined}
        />
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <fieldset className="flex items-center gap-3 text-[13px]">
          <legend className="text-[12.5px] font-medium text-muted">{t("sim.fault.start")}</legend>
          <label className="flex items-center gap-1">
            <input type="radio" name="fault-start" checked={startMode === "now"} onChange={() => setStartMode("now")} />
            {t("sim.fault.now")}
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="fault-start" checked={startMode === "later"} onChange={() => setStartMode("later")} />
            {t("sim.fault.later")}
          </label>
        </fieldset>
        {startMode === "later" && <TextField label={t("sim.fault.startInMin")} value={startInMin} inputMode="numeric" onChange={(e) => setStartInMin(e.target.value)} error={problemText(problems.startInMin)} />}
        <TextField label={t("sim.fault.durationMin")} value={durationMin} inputMode="numeric" onChange={(e) => setDurationMin(e.target.value)} error={problemText(problems.durationMin)} />
      </div>
      {error && (
        <p role="alert" className="text-[12.5px] text-bad">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-[12.5px] text-good">
          {notice}
        </p>
      )}
      <section aria-label={t("sim.fault.activeTitle")}>
        <h3 className="mb-1 text-[12.5px] font-semibold text-muted">{t("sim.fault.activeTitle")}</h3>
        {active.length === 0 ? (
          <p className="text-[12.5px] text-muted">{t("sim.fault.noActive")}</p>
        ) : (
          <Table>
            <tbody>
              {active.map((f) => (
                <tr key={f.faultId}>
                  <td>{targets.find((d) => d.deviceId === f.targetId)?.name ?? f.targetId}</td>
                  <td>{t(`sim.fault.kinds.${f.kind}`, { defaultValue: f.kind })}</td>
                  <td>{f.status === "SCHEDULED" ? t("sim.fault.scheduled") : t("sim.fault.remaining", { n: Math.ceil((f.remainingSec ?? 0) / 60) })}</td>
                  <td>
                    <Button variant="ghost" onClick={() => cancel(f.faultId)}>
                      {t("sim.fault.cancel")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </Dialog>
  );
}
