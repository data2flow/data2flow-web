/**
 * UI-SIM-08 시나리오 타임라인 편집기(SIM-04.01, SIM-05.03): 머리(이름·대상 공간·시작 시각·길이·시드·달력·외기 일주기),
 * 트랙(재실·문/창문·장비 조작·장애)에 이벤트를 놓고 끌어 옮기기·가장자리로 길이 조정(1분 격자, 키보드 ←/→ 5분),
 * 선택한 이벤트 속성, 기대 결과, [저장](API-SIM-12, baseVersion), [실행] → 실행 옵션 → API-SIM-14 → 실행 패널.
 */
import { useReducer, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, Checkbox, Dialog, SelectField, TextArea, TextField, cx } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { simErrorText } from "../model/sim-error";
import type { SimApi } from "../api";
import { EXPECTATION_KINDS, TRACKS, axisTicks, checkScenario, mapServerProblems, scenarioBody, scenarioReducer, toIso, type EditorEvent, type ScenarioState } from "../model/scenario";
import { ACCELERATION_CHOICES, SENSOR_FAULTS, checkAcceleration, runBody, type Problem, type RunOptions } from "../model/sim";
import type { Track } from "../model/types";
import { useProblemText } from "./common";

const KEY_STEP_SEC = 300;

export interface ScenarioEditorProps {
  initial: ScenarioState;
  spaces: { spaceId: string; name: string }[];
  devices: { deviceId: string; name: string }[];
  canEdit: boolean;
  canRun: boolean;
  api: Pick<SimApi, "createScenario" | "saveScenario" | "startRun">;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

function minutes(sec: number | null): string {
  return sec === null ? "" : String(Math.round(sec / 60));
}

function localInput(iso: string): string {
  return Number.isNaN(Date.parse(iso)) ? "" : new Date(iso).toISOString().slice(0, 16);
}

function JsonField({ label, value, onChange, disabled }: { label: string; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => JSON.stringify(value));
  const [bad, setBad] = useState(false);
  return (
    <TextArea
      label={label}
      rows={2}
      value={text}
      disabled={disabled}
      error={bad ? t("sim.validation.json") : undefined}
      onChange={(e) => {
        setText(e.target.value);
        try {
          const parsed = JSON.parse(e.target.value) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object");
          setBad(false);
          onChange(parsed as Record<string, unknown>);
        } catch {
          setBad(true);
        }
      }}
    />
  );
}

export function ScenarioEditor({ initial, spaces, devices, canEdit, canRun, api, navigate }: ScenarioEditorProps) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const [state, dispatch] = useReducer(scenarioReducer, initial);
  const [problems, setProblems] = useState<Record<string, Problem>>({});
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const drag = useRef<{ id: string; mode: "move" | "start" | "end"; x: number; width: number } | null>(null);
  const selected = state.events.find((e) => e.id === state.selectedId) ?? null;
  const pct = (sec: number) => `${Math.min(100, Math.max(0, (sec / state.durationSec) * 100))}%`;

  const save = async () => {
    const found = checkScenario(state);
    setProblems(found);
    setNotice(null);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    const body = scenarioBody(state);
    const result = state.scenarioId ? await api.saveScenario(state.scenarioId, body) : await api.createScenario(body);
    setSaving(false);
    if (!result.ok) {
      if (result.code === "SIM_SCENARIO_INVALID" && result.errors?.length) dispatch({ type: "serverProblems", problems: mapServerProblems(state, result.errors) });
      setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
      return;
    }
    const created = !state.scenarioId;
    dispatch({ type: "saved", scenarioId: result.data.scenarioId, version: result.data.version });
    setNotice({ tone: "success", text: t("sim.scenario.saved") });
    if (created) navigate(`/sim/scenarios/${encodeURIComponent(result.data.scenarioId)}/edit`, { replace: true });
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>, id: string, mode: "move" | "start" | "end") => {
    if (!canEdit) return;
    event.stopPropagation();
    const track = (event.currentTarget.closest("[data-track]") as HTMLElement | null)?.getBoundingClientRect().width ?? 0;
    drag.current = { id, mode, x: event.clientX, width: track };
    dispatch({ type: "select", id });
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    drag.current = null;
    if (!current || current.width <= 0) return;
    const deltaPx = event.clientX - current.x;
    if (deltaPx !== 0) dispatch({ type: "drag", id: current.id, mode: current.mode, deltaPx, pxPerSec: current.width / state.durationSec });
  };
  const onKey = (event: KeyboardEvent<HTMLElement>, e: EditorEvent) => {
    if (!canEdit) return;
    const step = event.key === "ArrowRight" ? KEY_STEP_SEC : event.key === "ArrowLeft" ? -KEY_STEP_SEC : 0;
    if (step === 0) {
      if (event.key === "Delete") dispatch({ type: "remove", id: e.id });
      return;
    }
    event.preventDefault();
    dispatch({ type: "drag", id: e.id, mode: event.shiftKey ? "end" : "move", deltaPx: step, pxPerSec: 1 });
  };

  const eventLabel = (e: EditorEvent) => {
    if (e.track === "OCCUPANCY") return t("sim.scenario.occupancyLabel", { n: Number(e.params.count) || 0 });
    if (e.track === "OPENING") return t(`sim.scenario.opening.${String(e.params.opening ?? "WINDOW")}`);
    if (e.track === "ACTUATOR") return `${String(e.params.capability ?? "")}.${String(e.params.command ?? "")}`;
    return t(`sim.fault.kinds.${String(e.params.kind ?? "STUCK")}`, { defaultValue: String(e.params.kind ?? "") });
  };

  return (
    <div className="flex flex-col gap-4" onPointerUp={onPointerUp}>
      <Card
        title={t("sim.scenario.header")}
        actions={
          <>
            {state.dirty && <span className="text-[12px] text-warn">{t("sim.scenario.unsaved")}</span>}
            {canEdit && (
              <Button variant="primary" onClick={save} disabled={saving}>
                {t("common.save")}
              </Button>
            )}
            {canRun && (
              <Button onClick={() => setRunOpen(true)} disabled={!state.scenarioId || state.dirty} title={state.dirty ? t("sim.scenario.saveFirst") : undefined}>
                {t("sim.scenario.run")}
              </Button>
            )}
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <TextField label={t("sim.scenario.name")} value={state.name} disabled={!canEdit} maxLength={80} onChange={(e) => dispatch({ type: "meta", patch: { name: e.target.value } })} error={problemText(problems.name)} />
          <TextField
            label={t("sim.scenario.simStartAt")}
            type="datetime-local"
            value={localInput(state.simStartAt)}
            disabled={!canEdit}
            onChange={(e) => dispatch({ type: "meta", patch: { simStartAt: e.target.value ? new Date(`${e.target.value}:00Z`).toISOString().replace(/\.000Z$/, "Z") : "" } })}
            error={problemText(problems.simStartAt)}
          />
          <TextField
            label={t("sim.scenario.durationHours")}
            inputMode="decimal"
            value={String(state.durationSec / 3600)}
            disabled={!canEdit}
            onChange={(e) => dispatch({ type: "meta", patch: { durationSec: Math.round(Number(e.target.value) * 3600) } })}
            error={problemText(problems.durationSec)}
          />
          <TextField label={t("sim.scenario.seed")} inputMode="numeric" value={state.seed === null ? "" : String(state.seed)} disabled={!canEdit} hint={t("sim.scenario.seedHint")} onChange={(e) => dispatch({ type: "meta", patch: { seed: e.target.value === "" ? null : Number(e.target.value) } })} />
          <TextField label={t("sim.scenario.outdoorMax")} inputMode="decimal" value={String(state.outdoor.max)} disabled={!canEdit} onChange={(e) => dispatch({ type: "meta", patch: { outdoor: { ...state.outdoor, max: Number(e.target.value) } } })} />
          <TextField label={t("sim.scenario.outdoorMin")} inputMode="decimal" value={String(state.outdoor.min)} disabled={!canEdit} onChange={(e) => dispatch({ type: "meta", patch: { outdoor: { ...state.outdoor, min: Number(e.target.value) } } })} />
          <TextField label={t("sim.scenario.peakHour")} inputMode="numeric" value={String(state.outdoor.peakHour)} disabled={!canEdit} onChange={(e) => dispatch({ type: "meta", patch: { outdoor: { ...state.outdoor, peakHour: Number(e.target.value) } } })} />
          <div className="self-end">
            <Checkbox label={t("sim.scenario.useCalendar")} checked={state.useCalendar} disabled={!canEdit} onChange={(e) => dispatch({ type: "meta", patch: { useCalendar: e.target.checked } })} />
          </div>
        </div>
        <fieldset className="mt-3 flex flex-wrap gap-3">
          <legend className="text-[12.5px] font-medium text-muted">{t("sim.scenario.spaces")}</legend>
          {spaces.map((s) => (
            <label key={s.spaceId} className="flex items-center gap-1 text-[13px]">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={state.spaceIds.includes(s.spaceId)}
                onChange={(e) => dispatch({ type: "meta", patch: { spaceIds: e.target.checked ? [...state.spaceIds, s.spaceId] : state.spaceIds.filter((x) => x !== s.spaceId) } })}
              />
              {s.name}
            </label>
          ))}
          {problems.spaceIds && (
            <p role="alert" className="text-[12px] text-bad">
              {problemText(problems.spaceIds)}
            </p>
          )}
        </fieldset>
        {notice && (
          <div className="mt-3">
            <Alert tone={notice.tone}>{notice.text}</Alert>
          </div>
        )}
      </Card>

      <Card title={t("sim.scenario.timeline")}>
        <div className="relative ml-28 h-5 text-[11px] text-muted" aria-hidden>
          {axisTicks(state.durationSec).map((sec) => (
            <span key={sec} className="absolute -translate-x-1/2" style={{ left: pct(sec) }}>
              {`+${sec / 3600}h`}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          {TRACKS.map((track: Track) => (
            <div key={track} className="flex items-center gap-2">
              <div className="flex w-26 shrink-0 items-center justify-between text-[12.5px]">
                <span>{t(`sim.scenario.track.${track}`)}</span>
                {canEdit && (
                  <button type="button" className="rounded border border-line px-1 text-[11px]" aria-label={t("sim.scenario.addEvent", { track: t(`sim.scenario.track.${track}`) })} onClick={() => dispatch({ type: "add", track, atSec: 0 })}>
                    +
                  </button>
                )}
              </div>
              <div data-track={track} role="list" aria-label={t(`sim.scenario.track.${track}`)} className="relative h-8 flex-1 rounded border border-line bg-bg">
                {state.events
                  .filter((e) => e.track === track)
                  .map((e) => {
                    const problem = problems[`events.${e.id}`] ?? (state.serverProblems[`events.${e.id}`] ? { key: "server" } : undefined);
                    const width = e.untilSec === null ? "8px" : `calc(${pct(e.untilSec - e.atSec)})`;
                    return (
                      <div
                        key={e.id}
                        role="listitem"
                        tabIndex={0}
                        aria-label={`${eventLabel(e)} +${minutes(e.atSec)}m${e.untilSec !== null ? `~+${minutes(e.untilSec)}m` : ""}`}
                        aria-selected={e.id === state.selectedId}
                        aria-invalid={problem ? true : undefined}
                        onClick={() => dispatch({ type: "select", id: e.id })}
                        onKeyDown={(ev) => onKey(ev, e)}
                        onPointerDown={(ev) => onPointerDown(ev, e.id, "move")}
                        className={cx(
                          "absolute top-1 flex h-6 cursor-grab items-center overflow-hidden rounded border px-1 text-[11px]",
                          problem ? "border-bad bg-bad-soft text-bad" : "border-accent/40 bg-accent-soft text-accent",
                          e.id === state.selectedId && "ring-2 ring-accent",
                        )}
                        style={{ left: pct(e.atSec), width }}
                      >
                        {e.untilSec !== null && <span className="absolute left-0 h-full w-1 cursor-ew-resize" onPointerDown={(ev) => onPointerDown(ev, e.id, "start")} aria-hidden />}
                        <span className="truncate">{eventLabel(e)}</span>
                        {e.untilSec !== null && <span className="absolute right-0 h-full w-1 cursor-ew-resize" onPointerDown={(ev) => onPointerDown(ev, e.id, "end")} aria-hidden />}
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-muted">{t("sim.scenario.dragHint")}</p>
      </Card>

      {selected && (
        <Card
          title={t("sim.scenario.selected", { label: eventLabel(selected) })}
          actions={
            canEdit && (
              <Button variant="danger" onClick={() => dispatch({ type: "remove", id: selected.id })}>
                {t("common.delete")}
              </Button>
            )
          }
        >
          <EventPanel key={selected.id} event={selected} state={state} spaces={spaces} devices={devices} canEdit={canEdit} dispatch={dispatch} problem={problemText(problems[`events.${selected.id}`]) ?? state.serverProblems[`events.${selected.id}`]} />
        </Card>
      )}

      <Card
        title={t("sim.scenario.expectations")}
        actions={
          canEdit && (
            <div className="flex gap-1">
              {EXPECTATION_KINDS.map((kind) => (
                <Button key={kind} variant="ghost" onClick={() => dispatch({ type: "addExpectation", kind })}>
                  {`+ ${t(`sim.expectation.${kind}`)}`}
                </Button>
              ))}
            </div>
          )
        }
      >
        {state.expectations.length === 0 ? (
          <p className="text-[12.5px] text-muted">{t("sim.scenario.noExpectations")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {state.expectations.map((x) => {
              const usesDevice = x.kind === "DEVICE_STATE_REACHED" || x.kind === "CONTROL_COUNT_MAX";
              const error = problemText(problems[`expectations.${x.id}`]) ?? state.serverProblems[`expectations.${x.id}`];
              return (
                <li key={x.id} className="grid gap-2 rounded border border-line p-2 md:grid-cols-4" aria-label={t(`sim.expectation.${x.kind}`)}>
                  <span className="self-center text-[13px] font-semibold">{t(`sim.expectation.${x.kind}`)}</span>
                  {usesDevice ? (
                    <SelectField label={t("sim.scenario.targetDevice")} value={String(x.target.deviceId ?? "")} disabled={!canEdit} onChange={(e) => dispatch({ type: "updateExpectation", id: x.id, patch: { target: { deviceId: e.target.value } } })}>
                      <option value="">–</option>
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.name}
                        </option>
                      ))}
                    </SelectField>
                  ) : (
                    <SelectField label={t("sim.scenario.targetSpace")} value={String(x.target.spaceId ?? "")} disabled={!canEdit} onChange={(e) => dispatch({ type: "updateExpectation", id: x.id, patch: { target: { ...x.target, spaceId: e.target.value } } })}>
                      <option value="">–</option>
                      {spaces.map((s) => (
                        <option key={s.spaceId} value={s.spaceId}>
                          {s.name}
                        </option>
                      ))}
                    </SelectField>
                  )}
                  <JsonField label={t("sim.scenario.condition")} value={x.condition} disabled={!canEdit} onChange={(condition) => dispatch({ type: "updateExpectation", id: x.id, patch: { condition } })} />
                  <TextField
                    label={t("sim.scenario.deadlineMin")}
                    inputMode="numeric"
                    value={minutes(x.deadlineSec)}
                    disabled={!canEdit}
                    error={error}
                    onChange={(e) => dispatch({ type: "updateExpectation", id: x.id, patch: { deadlineSec: e.target.value === "" ? null : Math.round(Number(e.target.value) * 60) } })}
                  />
                  {canEdit && (
                    <Button variant="ghost" onClick={() => dispatch({ type: "removeExpectation", id: x.id })}>
                      {t("common.delete")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[11.5px] text-muted">{t("sim.scenario.deviceHint", { names: devices.slice(0, 3).map((d) => d.name).join(", ") || "–" })}</p>
      </Card>

      {runOpen && state.scenarioId && <RunOptionsDialog scenarioId={state.scenarioId} api={api} navigate={navigate} onClose={() => setRunOpen(false)} />}
    </div>
  );
}

function EventPanel({
  event,
  state,
  spaces,
  devices,
  canEdit,
  dispatch,
  problem,
}: {
  event: EditorEvent;
  state: ScenarioState;
  spaces: { spaceId: string; name: string }[];
  devices: { deviceId: string; name: string }[];
  canEdit: boolean;
  dispatch: (a: Parameters<typeof scenarioReducer>[1]) => void;
  problem?: string;
}) {
  const { t } = useTranslation();
  const update = (patch: Partial<Pick<EditorEvent, "atSec" | "untilSec" | "target" | "params">>) => dispatch({ type: "update", id: event.id, patch });
  const usesSpace = event.track === "OCCUPANCY" || event.track === "OPENING";
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <TextField
        label={t("sim.scenario.atMin")}
        inputMode="numeric"
        value={String(Math.round(event.atSec / 60))}
        disabled={!canEdit}
        onChange={(e) => update({ atSec: Math.round(Number(e.target.value) * 60) })}
        hint={toIso(state.simStartAt, event.atSec)}
        error={problem}
      />
      {event.untilSec !== null && <TextField label={t("sim.scenario.untilMin")} inputMode="numeric" value={String(Math.round(event.untilSec / 60))} disabled={!canEdit} onChange={(e) => update({ untilSec: Math.round(Number(e.target.value) * 60) })} />}
      {usesSpace ? (
        <SelectField label={t("sim.scenario.targetSpace")} value={String(event.target.spaceId ?? "")} disabled={!canEdit} onChange={(e) => update({ target: { spaceId: e.target.value } })}>
          <option value="">–</option>
          {spaces.map((s) => (
            <option key={s.spaceId} value={s.spaceId}>
              {s.name}
            </option>
          ))}
        </SelectField>
      ) : (
        <SelectField label={t("sim.scenario.targetDevice")} value={String(event.target.deviceId ?? "")} disabled={!canEdit} onChange={(e) => update({ target: { deviceId: e.target.value } })}>
          <option value="">–</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.name}
            </option>
          ))}
        </SelectField>
      )}
      {event.track === "OCCUPANCY" && <TextField label={t("sim.scenario.count")} inputMode="numeric" value={String(event.params.count ?? "")} disabled={!canEdit} onChange={(e) => update({ params: { ...event.params, count: Number(e.target.value) } })} />}
      {event.track === "OPENING" && (
        <>
          <SelectField label={t("sim.scenario.openingKind")} value={String(event.params.opening ?? "WINDOW")} disabled={!canEdit} onChange={(e) => update({ params: { ...event.params, opening: e.target.value } })}>
            <option value="WINDOW">{t("sim.scenario.opening.WINDOW")}</option>
            <option value="DOOR">{t("sim.scenario.opening.DOOR")}</option>
          </SelectField>
          <Checkbox label={t("sim.scenario.open")} checked={event.params.open !== false} disabled={!canEdit} onChange={(e) => update({ params: { ...event.params, open: e.target.checked } })} />
        </>
      )}
      {event.track === "ACTUATOR" && (
        <>
          <TextField label={t("sim.scenario.capability")} value={String(event.params.capability ?? "")} disabled={!canEdit} onChange={(e) => update({ params: { ...event.params, capability: e.target.value } })} />
          <TextField label={t("sim.scenario.command")} value={String(event.params.command ?? "")} disabled={!canEdit} onChange={(e) => update({ params: { ...event.params, command: e.target.value } })} />
          <JsonField label={t("sim.scenario.args")} value={(event.params.args as Record<string, unknown>) ?? {}} disabled={!canEdit} onChange={(args) => update({ params: { ...event.params, args } })} />
        </>
      )}
      {event.track === "FAULT" && (
        <>
          <SelectField label={t("sim.fault.kind")} value={String(event.params.kind ?? "STUCK")} disabled={!canEdit} onChange={(e) => update({ params: { ...event.params, kind: e.target.value } })}>
            {Object.keys(SENSOR_FAULTS).map((k) => (
              <option key={k} value={k}>
                {t(`sim.fault.kinds.${k}`)}
              </option>
            ))}
          </SelectField>
          <JsonField label={t("sim.scenario.faultParams")} value={(event.params.params as Record<string, unknown>) ?? {}} disabled={!canEdit} onChange={(params) => update({ params: { ...event.params, params } })} />
        </>
      )}
    </div>
  );
}

export function RunOptionsDialog({ scenarioId, api, navigate, onClose, defaultAcceleration = 30 }: { scenarioId: string; api: Pick<SimApi, "startRun">; navigate: (to: string) => void; onClose: () => void; defaultAcceleration?: number }) {
  const { t } = useTranslation();
  const problemText = useProblemText();
  const [acceleration, setAcceleration] = useState(String(defaultAcceleration));
  const [timestampPolicy, setTimestampPolicy] = useState<RunOptions["timestampPolicy"]>("SIMULATED");
  const [notificationPolicy, setNotificationPolicy] = useState<RunOptions["notificationPolicy"]>("PREFIX");
  const [seed, setSeed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const accelProblem = checkAcceleration(Number(acceleration));
  const start = async () => {
    if (accelProblem) return;
    setBusy(true);
    const result = await api.startRun(runBody(scenarioId, { acceleration: Number(acceleration), timestampPolicy, notificationPolicy, seed: seed === "" ? null : Number(seed) }));
    setBusy(false);
    if (!result.ok) {
      setError(simErrorText(t, result) ?? null);
      return;
    }
    navigate(`/sim/runs/${encodeURIComponent(result.data.runId)}`);
  };
  return (
    <Dialog
      title={t("sim.runOptions.title")}
      open
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={start} disabled={busy || Boolean(accelProblem)}>
            {t("sim.runOptions.start")}
          </Button>
        </>
      }
    >
      <TextField label={t("sim.runOptions.acceleration")} inputMode="numeric" value={acceleration} onChange={(e) => setAcceleration(e.target.value)} error={problemText(accelProblem)} hint={ACCELERATION_CHOICES.map((n) => `x${n}`).join(" · ")} />
      <SelectField label={t("sim.runOptions.timestampPolicy")} value={timestampPolicy} onChange={(e) => setTimestampPolicy(e.target.value as RunOptions["timestampPolicy"])}>
        <option value="SIMULATED">{t("sim.runOptions.SIMULATED")}</option>
        <option value="WALL_CLOCK">{t("sim.runOptions.WALL_CLOCK")}</option>
      </SelectField>
      <SelectField label={t("sim.runOptions.notificationPolicy")} value={notificationPolicy} onChange={(e) => setNotificationPolicy(e.target.value as RunOptions["notificationPolicy"])}>
        <option value="PREFIX">{t("sim.runOptions.PREFIX")}</option>
        <option value="SUPPRESS">{t("sim.runOptions.SUPPRESS")}</option>
      </SelectField>
      <TextField label={t("sim.scenario.seed")} inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} hint={t("sim.scenario.seedHint")} />
      {error && (
        <p role="alert" className="text-[12.5px] text-bad">
          {error}
        </p>
      )}
    </Dialog>
  );
}
