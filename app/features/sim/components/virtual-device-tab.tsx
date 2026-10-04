/**
 * UI-SIM-03 가상 기기 상세 탭(`/devices/{id}?tab=virtual`, SIM-09.02): 개요(유형·프로필·보고 모드·장비 현재 상태),
 * 가상 특성(UI-SIM-04 공통 폼, 편집 층 = 기기), 출력(보고 주기 5~86,400초·지터 0~50%·payload 형식·시드),
 * 장비 응답(반응 지연·ack 지연·실패 확률 0~100%). 저장 API-SIM-09 PATCH(바꾼 항목만) 뒤 다시 조회한다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, SelectField, TextField } from "~/components/ui";
import { simErrorText } from "../model/sim-error";
import type { SimApi } from "../api";
import { actuatorSummary } from "../model/run";
import { buildDeviceOutput, type Problem } from "../model/sim";
import type { VirtualDeviceConfig } from "../model/types";
import { VirtualBadge, useProblemText } from "./common";
import { PropertyForm } from "./property-form";

export function VirtualDeviceTab({ deviceId, initial, failed, canManage, api }: { deviceId: string; initial: VirtualDeviceConfig | null; failed?: boolean; canManage: boolean; api: Pick<SimApi, "device" | "patchDevice"> }) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const [config, setConfig] = useState(initial);
  const [version, setVersion] = useState(0);
  const actuator = Boolean(config?.response || config?.actuatorState);
  const [output, setOutput] = useState(() => ({
    reportIntervalSec: String(initial?.reportIntervalSec ?? 60),
    jitterPct: String(initial?.jitterPct ?? 10),
    payloadFormat: initial?.payloadFormat ?? "CHIRPSTACK_V4",
    seed: initial?.seed === null || initial?.seed === undefined ? "" : String(initial.seed),
    reactionDelaySec: String(initial?.response?.reactionDelaySec ?? 0),
    ackDelayMs: String(initial?.response?.ackDelayMs ?? 0),
    failurePct: String(initial?.response?.failurePct ?? 0),
  }));
  const [problems, setProblems] = useState<Record<string, Problem>>({});
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  if (!config) return <Alert tone="danger">{failed ? t("sim.device.loadFailed") : t("sim.device.notVirtual")}</Alert>;

  const reload = async () => {
    const fresh = await api.device(deviceId);
    if (fresh.ok) {
      setConfig(fresh.data);
      setVersion((v) => v + 1);
    }
  };

  const saveOverrides = async (overrides: Record<string, unknown>) => {
    const result = await api.patchDevice(deviceId, { overrides });
    if (!result.ok) return { ok: false, message: simErrorText(t, result) };
    await reload();
    return { ok: true };
  };

  const saveOutput = async () => {
    setNotice(null);
    const built = buildDeviceOutput(output, actuator);
    setProblems(built.problems);
    if (!built.body) return;
    const result = await api.patchDevice(deviceId, built.body);
    if (!result.ok) setNotice({ tone: "danger", text: simErrorText(t, result) ?? "" });
    else {
      setNotice({ tone: "success", text: t("sim.property.saved") });
      await reload();
    }
  };

  const field = (name: keyof typeof output, label: string) => (
    <TextField label={label} name={name} inputMode="numeric" value={output[name]} disabled={!canManage} onChange={(e) => setOutput({ ...output, [name]: e.target.value })} error={problemText(problems[name])} />
  );

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            {t("sim.device.overview")} <VirtualBadge />
          </span>
        }
      >
        <dl className="grid grid-cols-2 gap-2 text-[13px] md:grid-cols-4">
          <dt className="text-muted">{t("sim.device.reportMode")}</dt>
          <dd>{t(`sim.catalog.${config.reportMode}`)}</dd>
          <dt className="text-muted">{t("sim.device.battery")}</dt>
          <dd>{config.battery === null || config.battery === undefined ? "–" : `${config.battery}%`}</dd>
          {config.actuatorState && (
            <>
              <dt className="text-muted">{t("sim.device.actuatorState")}</dt>
              <dd className="col-span-3 font-mono">{actuatorSummary(config.actuatorState)}</dd>
            </>
          )}
        </dl>
      </Card>
      <Card title={t("sim.device.properties")}>
        <PropertyForm key={version} rows={config.properties} layer="DEVICE" canEdit={canManage} onSave={saveOverrides} />
      </Card>
      <Card title={t("sim.device.output")}>
        <div className="grid gap-3 md:grid-cols-4">
          {field("reportIntervalSec", t("sim.device.reportIntervalSec"))}
          {field("jitterPct", t("sim.device.jitterPct"))}
          <SelectField label={t("sim.device.payloadFormat")} value={output.payloadFormat} disabled={!canManage} onChange={(e) => setOutput({ ...output, payloadFormat: e.target.value as VirtualDeviceConfig["payloadFormat"] })}>
            {["CHIRPSTACK_V4", "GENERIC_JSON", "SINGLE_VALUE"].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </SelectField>
          {field("seed", t("sim.device.seed"))}
        </div>
        {actuator && (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {field("reactionDelaySec", t("sim.device.reactionDelaySec"))}
            {field("ackDelayMs", t("sim.device.ackDelayMs"))}
            {field("failurePct", t("sim.device.failurePct"))}
          </div>
        )}
        {notice && (
          <div className="mt-3">
            <Alert tone={notice.tone}>{notice.text}</Alert>
          </div>
        )}
        {canManage && (
          <div className="mt-3 flex justify-end">
            <Button variant="primary" onClick={saveOutput}>
              {t("common.save")}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
