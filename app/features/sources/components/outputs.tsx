/**
 * 출력 연결 화면 부품(UI-DSC-05, DSC-04.01): 목록(이름·유형·대상·필터 요약·분당 전송·실패·지연·사용), 편집 폼(유형, 대상 URL·토픽 템플릿·헤더,
 * 인증 비밀값, 필터 작성기(그룹·공간·기기·측정 항목·최소 품질), 형식(표준/템플릿 + 변수 목록), 배치), [테스트](샘플 기기 렌더링 결과·대상 응답),
 * 상세(1분 지표 차트, 실패 보관함 [다시 보내기]). 토픽 템플릿에 허용 밖 변수가 있으면 렌더 오류를 보이고 저장할 수 없다(TC-DSC-130).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link, useNavigation } from "react-router";
import { TimeseriesChart } from "~/components/charts/timeseries-chart";
import { Alert, Badge, Button, Card, Checkbox, CsrfField, EmptyState, SelectField, Table, TextArea, TextField } from "~/components/ui";
import { bffJson } from "~/lib/bff-client";
import { errorText } from "~/lib/error-text";
import type { ChartSeries } from "~/lib/chart-model";
import { OUTPUT_TYPES, SECRET_KINDS_BY_TYPE, TEMPLATE_VARS, TOPIC_VARS, checkTopicTemplate, filterSummary, outputBody, renderTopic, statTotals, unknownTemplateVars, validateOutput, type OutputConnection, type OutputFormValues, type OutputStat, type OutputTestResult, type OutputType } from "../model/output";
import { SecretInput } from "./schema-fields";

export function OutputList({ outputs, stats, canAdmin }: { outputs: OutputConnection[]; stats: Record<string, OutputStat[]>; canAdmin: boolean }) {
  const { t } = useTranslation();
  if (outputs.length === 0) {
    return <EmptyState title={t("sources.outputs.empty")} body={t("sources.outputs.emptyBody")} action={canAdmin && <Link to="/outputs/new" className="text-accent hover:underline">{t("sources.outputs.new")}</Link>} />;
  }
  return (
    <Table>
      <thead>
        <tr>
          <th scope="col">{t("sources.outputs.name")}</th>
          <th scope="col">{t("sources.outputs.type")}</th>
          <th scope="col">{t("sources.outputs.target")}</th>
          <th scope="col">{t("sources.outputs.filter")}</th>
          <th scope="col">{t("sources.outputs.perMin")}</th>
          <th scope="col">{t("sources.outputs.failed")}</th>
          <th scope="col">{t("sources.outputs.lag")}</th>
          <th scope="col">{t("sources.outputs.enabled")}</th>
        </tr>
      </thead>
      <tbody>
        {outputs.map((o) => {
          const total = statTotals(stats[o.id] ?? []);
          return (
            <tr key={o.id}>
              <td>
                <Link to={`/outputs/${encodeURIComponent(o.id)}`} className="font-medium text-accent hover:underline">
                  {o.name}
                </Link>
              </td>
              <td>{t(`sources.outputs.types.${o.type}`)}</td>
              <td className="break-all font-mono text-[12px]">{String(o.target?.url ?? "–")}</td>
              <td className="text-[12.5px]">
                <FilterText filter={o.filter} />
              </td>
              <td className="font-mono">{total.perMin}</td>
              <td className="font-mono">{total.failed > 0 ? <Badge tone="danger">{total.failed}</Badge> : 0}</td>
              <td className="font-mono">{total.lagMs === null ? "–" : `${total.lagMs}ms`}</td>
              <td>{o.enabled ? <Badge tone="success">{t("sources.outputs.on")}</Badge> : <Badge tone="neutral">{t("sources.outputs.off")}</Badge>}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function FilterText({ filter }: { filter: OutputConnection["filter"] }) {
  const { t } = useTranslation();
  const f = filterSummary(filter);
  const parts = [
    f.devices ? t("sources.outputs.filterDevices", { n: f.devices }) : null,
    f.groups ? t("sources.outputs.filterGroups", { n: f.groups }) : null,
    f.spaces ? t("sources.outputs.filterSpaces", { n: f.spaces }) : null,
    f.metrics.length ? f.metrics.join(", ") : null,
    f.qualityMin !== null ? t("sources.outputs.filterQuality", { n: f.qualityMin }) : null,
  ].filter(Boolean);
  return <>{parts.length ? parts.join(" · ") : t("sources.outputs.filterAll")}</>;
}

export function OutputForm({ initial, mode, readOnly, configuredKinds = [], baseVersion, outputId, devices, serverError, serverFieldErrors, idempotencyKey }: { initial: OutputFormValues; mode: "create" | "edit"; readOnly?: boolean; idempotencyKey?: string; configuredKinds?: string[]; baseVersion?: number; outputId?: string; devices: { id: string; name: string }[]; serverError?: { code: string; message?: string } | null; serverFieldErrors?: { field: string; code: string; message: string }[] }) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [v, setV] = useState<OutputFormValues>(initial);
  const [sampleDeviceId, setSampleDeviceId] = useState(devices[0]?.id ?? "");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<OutputTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const errors = validateOutput(v);
  const set = <K extends keyof OutputFormValues>(key: K, value: OutputFormValues[K]) => setV((x) => ({ ...x, [key]: value }));
  const msg = (key: string) => {
    const code = errors[key];
    if (code) return t(`sources.outputs.error.${code}`, { vars: TOPIC_VARS.map((x) => `{${x}}`).join(", ") });
    const server = serverFieldErrors?.find((f) => f.field === key || f.field === `target.${key}` || f.field === `filter.${key}`);
    return server ? t(`sources.outputs.error.${server.code}`, { defaultValue: server.message || server.code, vars: TOPIC_VARS.map((x) => `{${x}}`).join(", ") }) : undefined;
  };
  const topic = checkTopicTemplate(v.topicTemplate);
  const sample = devices.find((d) => d.id === sampleDeviceId);
  const unknownBody = v.format === "TEMPLATE" ? unknownTemplateVars(v.template) : [];

  async function runTest() {
    setTesting(true);
    setTest(null);
    setTestError(null);
    const response = await bffJson<OutputTestResult>("/bff/api/core/output-connections/test", { method: "POST", body: { ...outputBody(v), sampleDeviceId, ...(outputId ? { outputConnectionId: outputId } : {}) } });
    setTesting(false);
    if (response.ok) setTest(response.data);
    else setTestError(errorText(t, response) ?? null);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Form method="post" className="flex flex-col gap-3">
        <CsrfField />
        <input type="hidden" name="payload" value={JSON.stringify(v)} />
        {baseVersion !== undefined && <input type="hidden" name="baseVersion" value={baseVersion} />}
        {idempotencyKey && <input type="hidden" name="idempotencyKey" value={idempotencyKey} />}
        {serverError && <Alert tone="danger">{serverError.code === "VERSION_CONFLICT" ? t("sources.form.conflict") : errorText(t, serverError)}</Alert>}
        <fieldset disabled={readOnly} className="flex flex-col gap-3">
          <Card title={t("sources.outputs.basic")}>
            <div className="grid gap-3 md:grid-cols-2">
              <TextField label={t("sources.outputs.name")} value={v.name} error={msg("name")} onChange={(e) => set("name", e.target.value)} />
              <SelectField label={t("sources.outputs.type")} value={v.type} disabled={mode === "edit"} onChange={(e) => set("type", e.target.value as OutputType)}>
                {OUTPUT_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`sources.outputs.types.${x}`)}
                  </option>
                ))}
              </SelectField>
              <TextField label={t("sources.outputs.url")} value={v.url} placeholder={v.type === "MQTT_PUBLISH" ? "mqtts://broker.example.com:8883" : "https://example.com/hook"} error={msg("url")} onChange={(e) => set("url", e.target.value)} />
              <Checkbox label={t("sources.outputs.enabled")} checked={v.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            </div>
          </Card>
          {v.type === "MQTT_PUBLISH" ? (
            <Card title={t("sources.outputs.mqtt")}>
              <div className="grid gap-3 md:grid-cols-2">
                <TextField label={t("sources.outputs.topicTemplate")} value={v.topicTemplate} error={msg("topicTemplate")} hint={t("sources.outputs.topicVars", { vars: TOPIC_VARS.map((x) => `{${x}}`).join(" ") })} onChange={(e) => set("topicTemplate", e.target.value)} />
                <SelectField label="QoS" value={String(v.qos)} onChange={(e) => set("qos", Number(e.target.value))}>
                  <option value="0">QoS 0</option>
                  <option value="1">QoS 1</option>
                </SelectField>
                <Checkbox label={t("sources.outputs.retain")} checked={v.retain} onChange={(e) => set("retain", e.target.checked)} />
                <TextField label={t("sources.form.username")} value={v.username} autoComplete="off" onChange={(e) => set("username", e.target.value)} />
                {topic.ok && sample && <p className="col-span-full font-mono text-[12px] text-muted">{t("sources.outputs.topicPreview", { topic: renderTopic(v.topicTemplate, { deviceId: sample.id, deviceName: sample.name, spaceCode: "room-301", metric: "temperature" }) })}</p>}
                {!topic.ok && topic.unknown.length > 0 && (
                  <p role="alert" className="col-span-full text-[12.5px] text-bad">
                    {t("sources.outputs.renderError", { vars: topic.unknown.map((x) => `{${x}}`).join(", ") })}
                  </p>
                )}
              </div>
            </Card>
          ) : (
            <Card title={t("sources.outputs.webhook")}>
              <div className="grid gap-3 md:grid-cols-2">
                <SelectField label={t("sources.outputs.method")} value={v.method} onChange={(e) => set("method", e.target.value as "POST" | "PUT")}>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                </SelectField>
                <TextField label={t("sources.outputs.authHeaderName")} value={v.authHeaderName} onChange={(e) => set("authHeaderName", e.target.value)} />
                <TextField label={t("sources.outputs.batchSize")} type="number" value={v.batchSize} error={msg("batchSize")} onChange={(e) => set("batchSize", e.target.value)} />
                <TextField label={t("sources.outputs.batchWaitMs")} type="number" value={v.batchWaitMs} error={msg("batchWaitMs")} onChange={(e) => set("batchWaitMs", e.target.value)} />
                <div className="col-span-full flex flex-col gap-2">
                  <p className="text-[12.5px] font-semibold">{t("sources.outputs.headers")}</p>
                  {v.headers.map((h, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                      <TextField label={t("sources.outputs.headerName", { n: i + 1 })} value={h.name} error={msg(`headers${i}`)} onChange={(e) => set("headers", v.headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                      <TextField label={t("sources.outputs.headerValue", { n: i + 1 })} value={h.value} onChange={(e) => set("headers", v.headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                      <Button variant="ghost" onClick={() => set("headers", v.headers.filter((_, j) => j !== i))}>
                        {t("common.remove")}
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button onClick={() => set("headers", [...v.headers, { name: "", value: "" }])}>{t("sources.outputs.addHeader")}</Button>
                  </div>
                </div>
              </div>
            </Card>
          )}
          <Card title={t("sources.outputs.secrets")}>
            <div className="grid gap-3 md:grid-cols-2">
              {SECRET_KINDS_BY_TYPE[v.type].map((kind) => (
                <SecretInput key={kind} kind={kind} value={v.secrets[kind] ?? ""} configured={configuredKinds.includes(kind)} readOnly={readOnly} onChange={(value) => set("secrets", { ...v.secrets, [kind]: value })} />
              ))}
            </div>
          </Card>
          <Card title={t("sources.outputs.filter")}>
            <div className="grid gap-3 md:grid-cols-2">
              <TextField label={t("sources.outputs.groupIds")} value={v.groupIds} hint={t("sources.outputs.idsHint")} onChange={(e) => set("groupIds", e.target.value)} />
              <TextField label={t("sources.outputs.spaceIds")} value={v.spaceIds} hint={t("sources.outputs.idsHint")} onChange={(e) => set("spaceIds", e.target.value)} />
              <TextField label={t("sources.outputs.deviceIds")} value={v.deviceIds} hint={t("sources.outputs.idsHint")} onChange={(e) => set("deviceIds", e.target.value)} />
              <TextField label={t("sources.outputs.metrics")} value={v.metrics} placeholder="co2, temperature" onChange={(e) => set("metrics", e.target.value)} />
              <SelectField label={t("sources.outputs.qualityMin")} value={v.qualityMin} error={msg("qualityMin")} onChange={(e) => set("qualityMin", e.target.value)}>
                <option value="">{t("sources.outputs.qualityAny")}</option>
                <option value="0">0 · {t("sources.outputs.quality0")}</option>
                <option value="1">1 · {t("sources.outputs.quality1")}</option>
                <option value="2">2 · {t("sources.outputs.quality2")}</option>
              </SelectField>
            </div>
          </Card>
          <Card title={t("sources.outputs.format")}>
            <div className="flex flex-col gap-3">
              <SelectField label={t("sources.outputs.format")} value={v.format} onChange={(e) => set("format", e.target.value as "CANONICAL" | "TEMPLATE")}>
                <option value="CANONICAL">{t("sources.outputs.formats.CANONICAL")}</option>
                <option value="TEMPLATE">{t("sources.outputs.formats.TEMPLATE")}</option>
              </SelectField>
              {v.format === "TEMPLATE" && (
                <>
                  <TextArea label={t("sources.outputs.template")} value={v.template} error={msg("template")} spellCheck={false} onChange={(e) => set("template", e.target.value)} />
                  <p className="text-[12px] text-muted">{t("sources.outputs.templateVars", { vars: TEMPLATE_VARS.map((x) => `{{${x}}}`).join(" ") })}</p>
                  {unknownBody.length > 0 && <p className="text-[12px] text-warn">{t("sources.outputs.unknownBodyVars", { vars: unknownBody.join(", ") })}</p>}
                </>
              )}
            </div>
          </Card>
        </fieldset>
        {!readOnly && (
          <div className="flex justify-end">
            <Button type="submit" name="intent" value="save" variant="primary" disabled={Object.keys(errors).length > 0 || navigation.state === "submitting"}>
              {t("common.save")}
            </Button>
          </div>
        )}
      </Form>
      <aside className="flex flex-col gap-2">
        <Card title={t("sources.outputs.test")}>
          <div className="flex flex-col gap-2">
            <SelectField label={t("sources.outputs.sampleDevice")} value={sampleDeviceId} onChange={(e) => setSampleDeviceId(e.target.value)}>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectField>
            {!readOnly && (
              <Button onClick={runTest} disabled={testing || !sampleDeviceId || Object.keys(errors).length > 0}>
                {t("sources.outputs.runTest")}
              </Button>
            )}
            {testing && <p role="status" className="text-[12.5px] text-muted">{t("sources.outputs.testing")}</p>}
            {testError && <Alert tone="danger">{testError}</Alert>}
            {test && (
              <div className="flex flex-col gap-2 text-[12.5px]">
                {test.ok ? <Alert tone="success">{t("sources.outputs.testOk")}</Alert> : <Alert tone="danger">{t("sources.outputs.testFailed", { kind: t(`sources.outputs.failure.${test.failureKind ?? "UNKNOWN"}`, { defaultValue: test.failureKind ?? "–" }) })}</Alert>}
                <p className="font-semibold">{t("sources.outputs.rendered")}</p>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-bg p-1 font-mono">{typeof test.rendered === "string" ? test.rendered : JSON.stringify(test.rendered, null, 2)}</pre>
                {test.response && (
                  <>
                    <p className="font-semibold">{t("sources.outputs.response", { status: test.response.status ?? "–" })}</p>
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-bg p-1 font-mono">{test.response.bodyPreview ?? ""}</pre>
                  </>
                )}
              </div>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}

/** 상세: 1분 지표 차트와 실패 보관함 다시 보내기(API-DSC-31·33) */
export function OutputStats({ stats, timezone, canAdmin, replayed }: { stats: OutputStat[]; timezone: string; canAdmin: boolean; replayed?: number | null }) {
  const { t } = useTranslation();
  const series: ChartSeries[] = (["sent", "failed", "retried"] as const).map((key) => ({ key, label: t(`sources.outputs.stat.${key}`), unit: t("sources.stats.unit"), points: stats.map((s) => [s.t, s[key], null]) }));
  const total = statTotals(stats);
  return (
    <Card title={t("sources.outputs.stats")}>
      <p className="mb-2 text-[12.5px]">{t("sources.outputs.statLine", { sent: total.sent, failed: total.failed, retried: total.retried, lag: total.lagMs ?? "–" })}</p>
      <TimeseriesChart series={series} timezone={timezone} title={t("sources.outputs.stats")} />
      {canAdmin && (
        <Form method="post" className="mt-3 flex flex-wrap items-end gap-2">
          <CsrfField />
          <input type="hidden" name="timezone" value={timezone} />
          <TextField label={t("sources.outputs.replayFrom")} name="from" type="datetime-local" />
          <TextField label={t("sources.outputs.replayTo")} name="to" type="datetime-local" />
          <Button type="submit" name="intent" value="replay">
            {t("sources.outputs.replay")}
          </Button>
        </Form>
      )}
      {replayed !== null && replayed !== undefined && <Alert tone="success">{t("sources.outputs.replayed", { n: replayed })}</Alert>}
    </Card>
  );
}
