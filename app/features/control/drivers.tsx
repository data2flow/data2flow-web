/**
 * UI-ACT-09 드라이버 관리(ACT-03.01~06, ACT-07.03, API-ACT-30~32). 권한 DRIVER_MANAGE(ADMIN·INTEGRATOR).
 * - 목록: 이름, 종류, 연결 기기 수, 상태(정상·서킷 열림·오류), 최근 1시간 오류율·평균 응답(API-ACT-32)
 * - 등록·수정: 종류별 연결 정보(LoRaWAN·LG ThinQ·SmartThings…), 인증은 쓰기 전용(응답은 hasSecret만, 화면에 값을 보이지 않는다),
 *   폴링 주기·ACK/적용 타임아웃·재시도(최대 3회)·서킷, [연결 확인](저장 전 /drivers/test, 저장 후 /healthcheck)
 * - 상세: 지원 기능, 서킷 상태·열린 시각, 최근 오류
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, SelectField, Table, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import { controlAdminApi, type ControlAdminApi } from "./admin-api";
import {
  DRIVER_FIELDS,
  DRIVER_TYPES,
  driverBody,
  driverProblems,
  driverToForm,
  driverTone,
  emptyDriverForm,
  type Driver,
  type DriverForm,
  type DriverMetrics,
  type DriverSummary,
  type DriverType,
  type HealthcheckResult,
} from "./model/admin";

export interface DriverRow extends DriverSummary {
  metrics?: DriverMetrics | null;
}

function pct(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "–";
  const value = rate <= 1 ? rate * 100 : rate;
  return `${Math.round(value * 10) / 10}%`;
}

export interface DriverManagerProps {
  initial: DriverRow[];
  failed?: boolean;
  timezone: string;
  lang: string;
  api?: ControlAdminApi;
}

export function DriverManager({ initial, failed, timezone, lang, api = controlAdminApi }: DriverManagerProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<{ driver: Driver | null; form: DriverForm } | null>(null);
  const [detail, setDetail] = useState<{ driver: Driver; metrics: DriverMetrics | null } | null>(null);
  const [check, setCheck] = useState<HealthcheckResult | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const problems = editing ? driverProblems(editing.form, editing.driver?.hasSecret ?? false) : [];
  const set = (patch: Partial<DriverForm>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));
  const err = (key: string, text: string) => (submitted && problems.includes(key) ? text : undefined);

  const open = async (id: string | null) => {
    setNotice(null);
    setCheck(null);
    setSubmitted(false);
    if (!id) return setEditing({ driver: null, form: emptyDriverForm() });
    const result = await api.driver(id);
    if (result.ok) setEditing({ driver: result.data, form: driverToForm(result.data) });
    else setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
  };

  const showDetail = async (id: string) => {
    const [driver, metrics] = await Promise.all([api.driver(id), api.driverMetrics(id, "1h")]);
    if (driver.ok) setDetail({ driver: driver.data, metrics: metrics.ok ? metrics.data : null });
    else setNotice({ tone: "danger", text: errorText(t, driver) ?? "" });
  };

  const changeType = (type: DriverType) => setEditing((e) => (e ? { ...e, form: { ...emptyDriverForm(type), name: e.form.name } } : e));

  const runCheck = async () => {
    if (!editing) return;
    setCheck(null);
    const result = editing.driver ? await api.healthcheck(editing.driver.driverId) : await api.testDriver(driverBody(editing.form));
    if (result.ok) setCheck(result.data);
    else setCheck({ ok: false, error: { kind: result.code, message: result.message || (errorText(t, result) ?? "") } });
  };

  const save = async () => {
    if (!editing) return;
    setSubmitted(true);
    if (problems.length > 0) return;
    const body = driverBody(editing.form);
    const result = editing.driver ? await api.updateDriver(editing.driver.driverId, { ...body, baseVersion: editing.driver.version }) : await api.createDriver(body);
    if (!result.ok) {
      setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
      return;
    }
    const d = result.data;
    const row: DriverRow = {
      driverId: d.driverId,
      name: d.name,
      type: d.type,
      status: d.status,
      deviceCount: rows.find((r) => r.driverId === d.driverId)?.deviceCount ?? 0,
      updatedAt: d.updatedAt,
      metrics: rows.find((r) => r.driverId === d.driverId)?.metrics,
    };
    setRows((list) => (list.some((r) => r.driverId === row.driverId) ? list.map((r) => (r.driverId === row.driverId ? row : r)) : [row, ...list]));
    setEditing(null);
    setNotice({ tone: "success", text: t("control.drivers.saved") });
  };

  const remove = async (row: DriverRow) => {
    if (!window.confirm(t("control.drivers.deleteConfirm", { name: row.name }))) return;
    const result = await api.deleteDriver(row.driverId);
    if (result.ok) setRows((list) => list.filter((r) => r.driverId !== row.driverId));
    else setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
  };

  const form = editing?.form;
  return (
    <div className="flex flex-col gap-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card
        title={t("control.drivers.title")}
        actions={
          <Button variant="primary" onClick={() => void open(null)}>
            {t("control.drivers.new")}
          </Button>
        }
      >
        {failed && <Alert tone="warning">{t("control.common.loadFailed")}</Alert>}
        {rows.length === 0 && !failed ? (
          <EmptyState title={t("control.drivers.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("control.drivers.name")}</th>
                <th>{t("control.drivers.type")}</th>
                <th>{t("control.drivers.devices")}</th>
                <th>{t("control.drivers.status")}</th>
                <th>{t("control.drivers.errorRate")}</th>
                <th>{t("control.drivers.avgMs")}</th>
                <th>{t("control.history.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.driverId}>
                  <td>
                    <button type="button" className="text-accent hover:underline" onClick={() => void showDetail(row.driverId)}>
                      {row.name}
                    </button>
                  </td>
                  <td>{t(`control.drivers.types.${row.type}`, { defaultValue: row.type })}</td>
                  <td className="font-mono">{row.deviceCount ?? 0}</td>
                  <td>
                    <Badge tone={driverTone(row.status)}>{t(`control.drivers.statuses.${row.status}`, { defaultValue: row.status })}</Badge>
                    {row.metrics?.circuit?.state === "OPEN" && row.metrics.circuit.openedAt && (
                      <span className="ml-1 text-[12px] text-warn">{t("control.drivers.openedAt", { at: formatDateTime(row.metrics.circuit.openedAt, timezone, lang, true) })}</span>
                    )}
                  </td>
                  <td className="font-mono">{pct(row.metrics?.errorRate)}</td>
                  <td className="font-mono">{row.metrics?.avgMs != null ? `${Math.round(row.metrics.avgMs)}ms` : "–"}</td>
                  <td className="flex gap-1">
                    <Button variant="ghost" onClick={() => void open(row.driverId)}>
                      {t("common.edit")}
                    </Button>
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

      {detail && (
        <Card title={t("control.drivers.detail", { name: detail.driver.name })} actions={<Button onClick={() => setDetail(null)}>{t("common.close")}</Button>}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-muted">{t("control.drivers.capabilities")}</dt>
            <dd className="font-mono">{(detail.driver.capabilities ?? []).join(", ") || "–"}</dd>
            <dt className="text-muted">{t("control.drivers.circuit")}</dt>
            <dd>
              {t(`control.drivers.circuitStates.${detail.metrics?.circuit?.state ?? "CLOSED"}`, { defaultValue: detail.metrics?.circuit?.state ?? "CLOSED" })}
              {detail.metrics?.circuit?.openedAt && ` · ${formatDateTime(detail.metrics.circuit.openedAt, timezone, lang, true)}`}
            </dd>
            <dt className="text-muted">{t("control.drivers.window1h")}</dt>
            <dd className="font-mono">
              {detail.metrics
                ? t("control.drivers.metricsLine", {
                    requests: detail.metrics.requests ?? 0,
                    errors: detail.metrics.errors ?? 0,
                    rate: pct(detail.metrics.errorRate),
                    avg: Math.round(detail.metrics.avgMs ?? 0),
                    p95: Math.round(detail.metrics.p95Ms ?? 0),
                  })
                : t("control.drivers.noMetrics")}
            </dd>
            <dt className="text-muted">{t("control.drivers.secret")}</dt>
            <dd>{detail.driver.hasSecret ? t("control.drivers.secretSet") : t("control.drivers.secretNone")}</dd>
          </dl>
          {(detail.metrics?.recentErrors ?? []).length > 0 && (
            <>
              <h3 className="mb-1 mt-3 text-[13px] font-semibold">{t("control.drivers.recentErrors")}</h3>
              <ul className="text-[12.5px]">
                {detail.metrics!.recentErrors!.map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    <span className="font-mono">{formatDateTime(e.at, timezone, lang, true)}</span> · {e.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {editing && form && (
        <Card title={editing.driver ? t("control.drivers.edit") : t("control.drivers.new")} actions={<Button onClick={() => setEditing(null)}>{t("common.close")}</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t("control.drivers.name")} value={form.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} error={err("name", t("control.drivers.nameRequired"))} />
            <SelectField label={t("control.drivers.type")} value={form.type} disabled={Boolean(editing.driver)} onChange={(e) => changeType(e.target.value as DriverType)}>
              {DRIVER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`control.drivers.types.${type}`)}
                </option>
              ))}
            </SelectField>
            {DRIVER_FIELDS[form.type].config.map((f) =>
              f.type === "boolean" ? (
                <Checkbox
                  key={f.key}
                  label={t(`control.drivers.fields.${f.key}`)}
                  checked={Boolean(form.config[f.key])}
                  onChange={(e) => set({ config: { ...form.config, [f.key]: e.target.checked } })}
                />
              ) : (
                <TextField
                  key={f.key}
                  label={t(`control.drivers.fields.${f.key}`)}
                  type={f.type === "number" ? "number" : "text"}
                  value={String(form.config[f.key] ?? "")}
                  onChange={(e) => set({ config: { ...form.config, [f.key]: e.target.value } })}
                  error={err(`config.${f.key}`, t("control.drivers.fieldInvalid"))}
                />
              ),
            )}
            {DRIVER_FIELDS[form.type].secret.map((key) => (
              <TextField
                key={key}
                label={t(`control.drivers.fields.${key}`)}
                type="password"
                autoComplete="new-password"
                value={form.secret[key] ?? ""}
                placeholder={editing.driver?.hasSecret ? t("control.drivers.secretKeep") : ""}
                onChange={(e) => set({ secret: { ...form.secret, [key]: e.target.value } })}
                error={err("secret", t("control.drivers.secretRequired"))}
              />
            ))}
            <TextField
              label={t("control.drivers.pollingSec")}
              type="number"
              value={form.pollingSec}
              hint={t("control.drivers.pollingHint")}
              onChange={(e) => set({ pollingSec: e.target.value })}
              error={err("pollingSec", t("control.drivers.fieldInvalid"))}
            />
            <TextField
              label={t("control.drivers.ackTimeoutSec")}
              type="number"
              value={form.ackTimeoutSec}
              onChange={(e) => set({ ackTimeoutSec: e.target.value })}
              error={err("ackTimeoutSec", t("control.drivers.fieldInvalid"))}
            />
            <TextField
              label={t("control.drivers.applyTimeoutSec")}
              type="number"
              value={form.applyTimeoutSec}
              onChange={(e) => set({ applyTimeoutSec: e.target.value })}
              error={err("applyTimeoutSec", t("control.drivers.fieldInvalid"))}
            />
            <TextField
              label={t("control.drivers.maxAttempts")}
              type="number"
              min={0}
              max={3}
              value={form.maxAttempts}
              hint={t("control.drivers.retryHint")}
              onChange={(e) => set({ maxAttempts: e.target.value })}
              error={err("maxAttempts", t("control.drivers.retryInvalid"))}
            />
          </div>
          <p className="mt-2 text-[12.5px] text-muted">{t("control.drivers.circuitHint")}</p>
          {form.type === "LORAWAN" && <p className="mt-1 text-[12.5px] text-muted">{t("control.drivers.lorawanHint")}</p>}
          {check && (
            <div className="mt-3">
              <Alert tone={check.ok ? "success" : "danger"}>
                {check.ok
                  ? t("control.drivers.checkOk", { ms: check.latencyMs ?? 0, caps: (check.capabilities ?? []).join(", ") || "–" })
                  : t("control.drivers.checkFailed", { message: check.error?.message ?? check.error?.kind ?? "" })}
              </Alert>
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button onClick={() => void runCheck()}>{t("control.drivers.check")}</Button>
            <Button variant="primary" onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
