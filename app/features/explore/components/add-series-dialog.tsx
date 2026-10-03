/**
 * [+ 시계열 추가] 선택기(UI-TSD-01): 기기(이름·외부 ID 검색, API-DEV-11) 또는 공간(API-DEV-01).
 * 측정 항목은 대상이 가진 것만 보인다: 기기는 최근값 항목(API-DEV-23 `latest[]`), 공간은 검증된 측정 항목(API-DEV-50).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Button, Dialog, SelectField, TextField } from "~/components/ui";
import { bffJson, type BffJsonResult } from "~/lib/bff-client";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import type { SeriesSpec } from "../model/state";

export type FetchJson = <T>(path: string) => Promise<BffJsonResult<T>>;

interface DeviceRow {
  id: string;
  name: string;
  externalId?: string;
}
interface DeviceDetail {
  id: string;
  name: string;
  latest?: { metricKey: string; displayName?: string; unit?: string }[];
}
interface MetricRow {
  key: string;
  displayName?: string;
  unit?: string | null;
}

const defaultFetch: FetchJson = (path) => bffJson(path);

export function AddSeriesDialog({ open, onClose, onAdd, spaces, fetchJson = defaultFetch, error }: { open: boolean; onClose: () => void; onAdd: (spec: SeriesSpec) => void; spaces: SpaceNode[]; fetchJson?: FetchJson; error?: string }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<"device" | "space">("device");
  const [q, setQ] = useState("");
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [metric, setMetric] = useState("");
  const [failed, setFailed] = useState(false);

  const reset = (next: "device" | "space") => {
    setKind(next);
    setTarget(null);
    setMetrics([]);
    setMetric("");
    setFailed(false);
  };

  const search = async () => {
    const result = await fetchJson<{ responses: DeviceRow[] }>(`/bff/api/core/devices?${new URLSearchParams({ q, size: "20" })}`);
    setFailed(!result.ok);
    setDevices(result.ok ? (result.data.responses ?? []) : []);
  };

  const chooseDevice = async (device: DeviceRow) => {
    setTarget({ id: String(device.id), name: device.name });
    const result = await fetchJson<DeviceDetail>(`/bff/api/core/devices/${encodeURIComponent(device.id)}`);
    setFailed(!result.ok);
    const list = result.ok ? (result.data.latest ?? []).map((l) => ({ key: l.metricKey, displayName: l.displayName, unit: l.unit })) : [];
    setMetrics(list);
    setMetric(list[0]?.key ?? "");
  };

  const chooseSpace = async (id: string) => {
    const space = flattenSpaces(spaces).find((s) => s.id === id);
    setTarget(space ? { id, name: space.path.join(" › ") } : null);
    if (!space) return;
    const result = await fetchJson<{ responses: MetricRow[] }>("/bff/api/core/metrics?status=VERIFIED&size=100");
    setFailed(!result.ok);
    const list = result.ok ? (result.data.responses ?? []) : [];
    setMetrics(list);
    setMetric(list[0]?.key ?? "");
  };

  const add = () => {
    if (!target || !metric) return;
    const chosen = metrics.find((m) => m.key === metric);
    const name = kind === "space" ? target.name.split(" › ").pop() : target.name;
    onAdd({ kind, id: target.id, metric, label: `${name} ${chosen?.displayName ?? metric}`, ...(chosen?.unit ? { unit: chosen.unit } : {}), ...(kind === "space" ? { agg: "avg" } : {}) });
  };

  return (
    <Dialog
      title={t("explore.add.title")}
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!target || !metric} onClick={add}>
            {t("common.add")}
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {failed && <Alert tone="danger">{t("errors.UNKNOWN")}</Alert>}
      <div role="radiogroup" aria-label={t("explore.add.kind")} className="flex gap-3 text-[13px]">
        {(["device", "space"] as const).map((k) => (
          <label key={k} className="flex items-center gap-1">
            <input type="radio" name="kind" checked={kind === k} onChange={() => reset(k)} />
            {t(`explore.add.${k}`)}
          </label>
        ))}
      </div>
      {kind === "device" ? (
        <>
          <div className="flex items-end gap-2">
            <TextField className="flex-1" label={t("explore.add.search")} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
            <Button onClick={() => void search()}>{t("common.search")}</Button>
          </div>
          {devices && devices.length === 0 && <p className="text-[12.5px] text-muted">{t("explore.add.noDevices")}</p>}
          {devices && devices.length > 0 && (
            <ul className="max-h-40 overflow-y-auto rounded-md border border-line">
              {devices.map((d) => (
                <li key={d.id}>
                  <button type="button" aria-pressed={target?.id === String(d.id)} onClick={() => void chooseDevice(d)} className="w-full px-2 py-1 text-left text-[13px] hover:bg-bg aria-pressed:bg-accent-soft">
                    {d.name} <span className="font-mono text-[11.5px] text-muted">{d.externalId}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <SpaceSelect spaces={spaces} label={t("explore.add.space")} value={target?.id ?? ""} onChange={(e) => void chooseSpace(e.target.value)} />
      )}
      {target && (
        <SelectField label={t("explore.add.metric")} value={metric} onChange={(e) => setMetric(e.target.value)}>
          {metrics.length === 0 && <option value="">{t("explore.add.noMetrics")}</option>}
          {metrics.map((m) => (
            <option key={m.key} value={m.key}>
              {m.displayName && m.displayName !== m.key ? `${m.displayName} (${m.key})` : m.key}
            </option>
          ))}
        </SelectField>
      )}
    </Dialog>
  );
}
