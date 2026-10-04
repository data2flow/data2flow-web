/**
 * UI-SIM-11 실제 데이터 재생 — 원본 선택(SIM-06.01·06.02): 기간(원본 보관 30일 안, 최대 31일)·소스·기기(다중) → 대상 원본 건수(API-SIM-22 dryRun)
 * → 시각 기준(현재부터/지정)·가속 x1~x60·복제 기기 공간·접미사 → 재생 시작(API-SIM-22 `source.type=RAW`). 시작하면 실행 화면으로 간다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Checkbox, SelectField, TextField } from "~/components/ui";
import { formatNumber } from "~/lib/format";
import type { SimApi } from "../api";
import { rawReplayBody } from "../model/replay";
import type { Problem } from "../model/sim";
import { simErrorText } from "../model/sim-error";
import { useProblemText } from "./common";

const UNAVAILABLE = [404, 405, 501];

/** datetime-local 기본값(브라우저 시각, 분 단위) */
export function localInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RawReplayPanel({
  sources,
  devices,
  spaces,
  canRun,
  api,
  navigate,
  now,
}: {
  sources: { id: string; name: string }[];
  devices: { id: string; name: string; sourceId: string | null }[];
  spaces: { spaceId: string; name: string }[];
  canRun: boolean;
  api: Pick<SimApi, "replay">;
  navigate: (to: string) => void;
  now: number;
}) {
  const { t, i18n } = useTranslation();
  const problemText = useProblemText();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const [from, setFrom] = useState(localInput(now - 86_400_000));
  const [to, setTo] = useState(localInput(now));
  const [basis, setBasis] = useState<"NOW" | "AT">("NOW");
  const [at, setAt] = useState("");
  const [acceleration, setAcceleration] = useState("60");
  const [cloneSpaceId, setCloneSpaceId] = useState(spaces[0]?.spaceId ?? "");
  const [cloneSuffix, setCloneSuffix] = useState(t("sim.replay.defaultSuffix"));
  const [problems, setProblems] = useState<Record<string, Problem>>({});
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const candidates = devices.filter((d) => d.sourceId === sourceId);

  const build = () => {
    const built = rawReplayBody({ sourceId, deviceIds, from, to, basis, at, acceleration: Number(acceleration), cloneSpaceId, cloneSuffix }, now);
    setProblems(built.problems);
    return built.body;
  };
  const fail = (result: { status: number; code: string; message?: string; errors?: { field: string; code: string; message: string }[] }) =>
    setError(UNAVAILABLE.includes(result.status) && !result.code.startsWith("SIM_") ? t("errors.SIM_REPLAY_UNAVAILABLE") : (simErrorText(t, result) ?? null));
  const dryRun = async () => {
    setError(null);
    const body = build();
    if (!body) return;
    const result = await api.replay(body, true);
    if (!result.ok) fail(result);
    else setCount(result.data.total);
  };
  const start = async () => {
    setError(null);
    const body = build();
    if (!body) return;
    const result = await api.replay(body, false);
    if (!result.ok) fail(result);
    else if (result.data.runId) navigate(`/sim/runs/${encodeURIComponent(result.data.runId)}`);
  };

  return (
    <Card title={t("sim.replay.rawTitle")}>
      <div className="grid gap-3 md:grid-cols-3">
        <TextField label={t("sim.replay.from")} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} error={problemText(problems.from)} />
        <TextField label={t("sim.replay.to")} type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} error={problemText(problems.to)} />
        <SelectField
          label={t("sim.replay.source")}
          value={sourceId}
          error={problemText(problems.sourceId)}
          onChange={(e) => {
            setSourceId(e.target.value);
            setDeviceIds([]);
            setCount(null);
          }}
        >
          <option value="">–</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
      </div>
      <fieldset className="mt-3">
        <legend className="text-[12.5px] font-medium text-muted">{t("sim.replay.devices", { n: deviceIds.length })}</legend>
        {candidates.length === 0 ? (
          <p className="text-[12.5px] text-muted">{t("sim.replay.noDevices")}</p>
        ) : (
          <ul className="grid gap-1 sm:grid-cols-2 md:grid-cols-3">
            {candidates.map((d) => (
              <li key={d.id}>
                <Checkbox label={d.name} checked={deviceIds.includes(d.id)} onChange={() => setDeviceIds((ids) => (ids.includes(d.id) ? ids.filter((x) => x !== d.id) : [...ids, d.id]))} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[12px] text-muted">{t("sim.replay.allDevicesHint")}</p>
      </fieldset>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <SelectField label={t("sim.replay.basis")} value={basis} onChange={(e) => setBasis(e.target.value as "NOW" | "AT")}>
          <option value="NOW">{t("sim.replay.basisNow")}</option>
          <option value="AT">{t("sim.replay.basisAt")}</option>
        </SelectField>
        {basis === "AT" && <TextField label={t("sim.replay.at")} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} error={problemText(problems.at)} />}
        <TextField label={t("sim.runOptions.acceleration")} inputMode="numeric" value={acceleration} onChange={(e) => setAcceleration(e.target.value)} error={problemText(problems.acceleration)} />
        <SelectField label={t("sim.replay.cloneSpace")} value={cloneSpaceId} onChange={(e) => setCloneSpaceId(e.target.value)} error={problemText(problems.cloneSpaceId)}>
          <option value="">–</option>
          {spaces.map((s) => (
            <option key={s.spaceId} value={s.spaceId}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <TextField label={t("sim.replay.cloneSuffix")} value={cloneSuffix} maxLength={40} onChange={(e) => setCloneSuffix(e.target.value)} />
      </div>
      {count !== null && <p className="mt-3 text-[13px]">{t("sim.replay.rawCount", { n: formatNumber(count, i18n.language) })}</p>}
      {error && (
        <p role="alert" className="mt-2 text-[12.5px] text-bad">
          {error}
        </p>
      )}
      {canRun && (
        <div className="mt-3 flex justify-end gap-2">
          <Button onClick={dryRun}>{t("sim.replay.dryRun")}</Button>
          <Button variant="primary" onClick={start}>
            {t("sim.replay.start")}
          </Button>
        </div>
      )}
    </Card>
  );
}
