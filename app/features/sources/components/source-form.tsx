/**
 * 소스 설정 폼(UI-DSC-08 커넥터 설정 폼 = UI-DSC-02 소스 만들기·편집, DSC-01.01·01.02·01.04·01.06·01.07, DSC-09.04).
 * 탭: 기본 · 연결 · 인증 · 구독 · 디코더 · 정책. 오류가 있는 탭에 빨간 점(TC-DSC-234). 오른쪽에 연결 테스트 패널(UI-DSC-09).
 * 저장은 폼 POST(`payload` JSON, CSRF), 연결 테스트는 브라우저에서 BFF로(API-DSC-57). 테스트 결과는 저장 본문에 영향이 없다(TC-DSC-093).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Badge, Button, Card, Checkbox, CsrfField, SelectField, TextField, cx } from "~/components/ui";
import { bffJson } from "~/lib/bff-client";
import { errorText } from "~/lib/error-text";
import type { SpaceNode } from "~/lib/spaces";
import { validateMapping, mappingFromConfig } from "../model/mapping";
import { AUTH_METHODS, DECODERS, DEFAULT_MAPPING, MAX_TOPICS, TEST_TIMEOUT_RANGE, TEST_TIMEOUT_SEC, clampTestTimeout, clientIdPreview, sharedTopic, testBody, validateForm, type FieldErrors, type SourceFormValues, type TestResult } from "../model/source";
import { ConnectionTestPanel } from "./connection-test-panel";
import { MappingEditor } from "./mapping-editor";

export interface Option {
  id: string;
  name: string;
  code?: string;
}

export interface SourceFormProps {
  initial: SourceFormValues;
  mode: "create" | "edit";
  readOnly?: boolean;
  secretConfigured?: boolean;
  secretFingerprint?: string | null;
  models: Option[];
  spaces: SpaceNode[];
  scripts: Option[];
  idempotencyKey?: string;
  baseVersion?: number;
  /** 연결 테스트 경로(새 소스 `/bff/api/core/sources/test`, 기존 `/bff/api/core/sources/{id}/test`) */
  testPath: string;
  serverError?: { code: string; message?: string } | null;
  serverFieldErrors?: { field: string; code: string; message: string }[];
  env?: string;
  /** 소스당 토픽 한도(API-DSC-71 maxTopicsPerSource) */
  maxTopics?: number;
}

type TabKey = "basic" | "connection" | "auth" | "subscription" | "decoder" | "policy";

const TAB_FIELDS: Record<TabKey, string[]> = {
  basic: ["code", "name"],
  connection: ["url", "clientIdBase", "keepaliveSec", "sessionExpirySec", "tlsInsecure"],
  auth: ["secretValue", "username", "headerName"],
  subscription: ["topics"],
  decoder: ["decodeScriptId", "decoderConfig"],
  policy: ["autoregLimitPerHour", "noDataAlarmAfterSec"],
};

function tabsFor(type: string): TabKey[] {
  if (type === "MQTT_SUBSCRIBE") return ["basic", "connection", "auth", "subscription", "decoder", "policy"];
  return ["basic", "connection", "decoder", "policy"];
}

export function SourceForm({ initial, mode, readOnly = false, secretConfigured, secretFingerprint, models, spaces, scripts, idempotencyKey, baseVersion, testPath, serverError, serverFieldErrors, env = "prod", maxTopics = MAX_TOPICS }: SourceFormProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [values, setValues] = useState<SourceFormValues>(initial);
  const [tab, setTab] = useState<TabKey>("basic");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [timeoutSec, setTimeoutSec] = useState(TEST_TIMEOUT_SEC);
  const mappingError = useMemo(() => (values.decoderKey === "generic-json" && validateMapping(mappingFromConfig(values.decoderConfig || DEFAULT_MAPPING)).length > 0 ? "mapping" : null), [values.decoderKey, values.decoderConfig]);
  const errors: FieldErrors = validateForm(values, { editing: mode === "edit", secretConfigured, mappingError, maxTopics });
  for (const fe of serverFieldErrors ?? []) if (!(fe.field in errors)) (errors as Record<string, string>)[fe.field] = "server";
  const hasErrors = Object.keys(errors).length > 0;
  const tabs = tabsFor(values.type);
  const set = <K extends keyof SourceFormValues>(key: K, value: SourceFormValues[K]) => {
    setTouched(true);
    setValues((v) => ({ ...v, [key]: value }));
  };
  const show = (key: string) => (touched || mode === "edit" ? errorMessage(key) : undefined);
  const errorMessage = (key: string) => {
    const code = (errors as Record<string, string>)[key];
    if (!code) return undefined;
    if (code === "server") return serverFieldErrors?.find((f) => f.field === key)?.message;
    return t(`sources.validation.${code}`);
  };
  const tabHasError = (key: TabKey) => Object.keys(errors).some((field) => TAB_FIELDS[key].includes(field) || (key === "subscription" && field.startsWith("topic")));
  const mqtt5 = values.protocolVersion === "5.0";
  const saving = navigation.state === "submitting";

  async function runTest() {
    setTesting(true);
    setTestError(null);
    setResult(null);
    // 제한 시간은 쿼리 timeoutSec(기본 15초, 5~30초, API-DSC-57)
    const response = await bffJson<TestResult>(`${testPath}?timeoutSec=${clampTestTimeout(timeoutSec)}`, { method: "POST", body: testBody(values) });
    setTesting(false);
    if (response.ok) setResult({ ok: response.data?.ok, stage: response.data?.stage, steps: response.data?.steps ?? [], preview: response.data?.preview ?? [], lossPossible: response.data?.lossPossible });
    else setTestError(errorText(t, response) ?? null);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Form method="post" className="flex flex-col gap-3" onSubmit={() => setTouched(true)}>
        <CsrfField />
        <input type="hidden" name="payload" value={JSON.stringify(values)} />
        {idempotencyKey && <input type="hidden" name="idempotencyKey" value={idempotencyKey} />}
        {baseVersion !== undefined && <input type="hidden" name="baseVersion" value={baseVersion} />}
        {readOnly && <Alert tone="info">{t("sources.form.readOnly")}</Alert>}
        {serverError && <Alert tone="danger">{serverError.code === "VERSION_CONFLICT" ? t("sources.form.conflict") : errorText(t, serverError)}</Alert>}
        <nav className="flex flex-wrap gap-1 border-b border-line" aria-label={t("sources.form.tabs")}>
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              aria-current={tab === key ? "page" : undefined}
              onClick={() => setTab(key)}
              className={cx("-mb-px border-b-2 px-3 py-2 text-[13px]", tab === key ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-text")}
            >
              {t(`sources.form.tab.${key}`)}
              {tabHasError(key) && (touched || mode === "edit") && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-bad align-middle" aria-label={t("sources.form.tabError")} />
              )}
            </button>
          ))}
        </nav>
        <fieldset disabled={readOnly} className="flex flex-col gap-3">
          <section hidden={tab !== "basic"} className="grid gap-3 md:grid-cols-2">
            <TextField label={t("sources.form.type")} value={t(`sources.type.${values.type}`, { defaultValue: values.type })} readOnly />
            <TextField label={t("sources.form.code")} value={values.code} readOnly={mode === "edit"} hint={t("sources.form.codeHint")} error={show("code")} onChange={(e) => set("code", e.target.value)} />
            <TextField label={t("sources.form.name")} value={values.name} error={show("name")} onChange={(e) => set("name", e.target.value)} />
          </section>

          <section hidden={tab !== "connection"} className="grid gap-3 md:grid-cols-2">
            {values.type === "MQTT_SUBSCRIBE" && (
              <>
                <TextField label={t("sources.form.url")} value={values.url} placeholder="wss://iot-data.java21.net:443/mqtt" error={show("url")} onChange={(e) => set("url", e.target.value)} />
                <SelectField label={t("sources.form.protocolVersion")} value={values.protocolVersion} onChange={(e) => set("protocolVersion", e.target.value as "3.1.1" | "5.0")}>
                  <option value="5.0">MQTT 5.0</option>
                  <option value="3.1.1">MQTT 3.1.1</option>
                </SelectField>
                <TextField
                  label={t("sources.form.clientIdBase")}
                  value={values.clientIdBase}
                  error={show("clientIdBase")}
                  hint={t("sources.form.clientIdPreview", { ids: clientIdPreview(values.clientIdBase, values.code, env).join(", ") })}
                  onChange={(e) => set("clientIdBase", e.target.value)}
                />
                <TextField label={t("sources.form.keepalive")} type="number" value={values.keepaliveSec} error={show("keepaliveSec")} onChange={(e) => set("keepaliveSec", e.target.value)} />
                <Checkbox label={t("sources.form.persistentSession")} checked={!values.cleanStart} onChange={(e) => set("cleanStart", !e.target.checked)} />
                <TextField label={t("sources.form.sessionExpiry")} type="number" value={values.sessionExpirySec} disabled={!mqtt5} hint={!mqtt5 ? t("sources.form.mqtt5Only") : undefined} error={mqtt5 ? show("sessionExpirySec") : undefined} onChange={(e) => set("sessionExpirySec", e.target.value)} />
                <TextField label={t("sources.form.receiveMaximum")} type="number" value={values.receiveMaximum} disabled={!mqtt5} hint={!mqtt5 ? t("sources.form.mqtt5Only") : undefined} onChange={(e) => set("receiveMaximum", e.target.value)} />
                <Checkbox label={t("sources.form.isDev")} checked={values.isDev} onChange={(e) => set("isDev", e.target.checked)} />
                <Checkbox label={t("sources.form.tlsInsecure")} checked={values.tlsInsecure} error={show("tlsInsecure")} onChange={(e) => set("tlsInsecure", e.target.checked)} />
                {values.tlsInsecure && <Alert tone="warning">{t("sources.form.tlsInsecureWarn")}</Alert>}
              </>
            )}
            {values.type === "PLATFORM_BROKER" && (
              <>
                <TextField label={t("sources.form.deviceKeyPattern")} value={values.deviceKeyPattern} onChange={(e) => set("deviceKeyPattern", e.target.value)} />
                <p className="text-[12.5px] text-muted">{t("sources.form.platformEndpoint")}</p>
              </>
            )}
            {values.type === "SIMULATION" && <TextField label={t("sources.form.scenarioId")} value={values.scenarioId} hint={t("sources.form.scenarioHint")} onChange={(e) => set("scenarioId", e.target.value)} />}
          </section>

          {values.type === "MQTT_SUBSCRIBE" && (
            <section hidden={tab !== "auth"} className="grid gap-3 md:grid-cols-2">
              <SelectField label={t("sources.form.auth")} value={values.auth} onChange={(e) => set("auth", e.target.value)}>
                {AUTH_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`sources.auth.${m}`)}
                  </option>
                ))}
              </SelectField>
              {values.auth === "HEADER" && <TextField label={t("sources.form.headerName")} value={values.headerName} error={show("headerName")} onChange={(e) => set("headerName", e.target.value)} />}
              {values.auth === "USERPASS" && <TextField label={t("sources.form.username")} value={values.username} error={show("username")} onChange={(e) => set("username", e.target.value)} autoComplete="off" />}
              {values.auth !== "NONE" && (
                <TextField
                  label={t(`sources.form.secret.${values.auth}`)}
                  type="password"
                  autoComplete="new-password"
                  value={values.secretValue}
                  placeholder={secretConfigured ? (secretFingerprint ?? "••••") : ""}
                  hint={secretConfigured ? t("sources.form.secretKeep") : t("sources.form.secretWriteOnly")}
                  error={show("secretValue")}
                  onChange={(e) => set("secretValue", e.target.value)}
                />
              )}
            </section>
          )}

          {values.type === "MQTT_SUBSCRIBE" && (
            <section hidden={tab !== "subscription"} className="flex flex-col gap-2">
              <TextField label={t("sources.form.sharedGroup")} value={values.sharedGroup} hint={t("sources.form.sharedGroupHint")} onChange={(e) => set("sharedGroup", e.target.value)} />
              {values.topics.map((row, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_100px_auto] items-end gap-2">
                  <TextField
                    label={t("sources.form.topicN", { n: i + 1 })}
                    value={row.topic}
                    error={show(`topic${i}`)}
                    hint={values.sharedGroup.trim() && row.topic ? t("sources.form.actualTopic", { topic: sharedTopic(row.topic, values.sharedGroup) }) : undefined}
                    onChange={(e) => set("topics", values.topics.map((r, j) => (j === i ? { ...r, topic: e.target.value } : r)))}
                  />
                  <SelectField label={t("sources.form.qosN", { n: i + 1 })} value={String(row.qos)} onChange={(e) => set("topics", values.topics.map((r, j) => (j === i ? { ...r, qos: Number(e.target.value) } : r)))}>
                    {[0, 1, 2].map((q) => (
                      <option key={q} value={q}>
                        QoS {q}
                      </option>
                    ))}
                  </SelectField>
                  <div className="flex items-center gap-2 pb-1">
                    {row.qos === 0 && <Badge tone="warning">{t("sources.form.lossPossible")}</Badge>}
                    <Button variant="ghost" onClick={() => set("topics", values.topics.filter((_, j) => j !== i))}>
                      {t("common.remove")}
                    </Button>
                  </div>
                </div>
              ))}
              {show("topics") && <p className="text-[12px] text-bad">{show("topics")}</p>}
              <div>
                <Button onClick={() => set("topics", [...values.topics, { topic: "", qos: 1 }])} disabled={values.topics.length >= maxTopics}>
                  {t("sources.form.addTopic")}
                </Button>
                <span className="ml-2 text-[12px] text-muted">{t("sources.limits.topics", { n: values.topics.length, max: maxTopics })}</span>
                {values.topics.length >= maxTopics && <span className="ml-2 text-[12px] text-muted">{t("sources.validation.topicLimit", { max: maxTopics })}</span>}
              </div>
            </section>
          )}

          <section hidden={tab !== "decoder"} className="flex flex-col gap-3">
            <SelectField label={t("sources.form.decoder")} value={values.decoderKey} onChange={(e) => set("decoderKey", e.target.value)}>
              {DECODERS.map((d) => (
                <option key={d} value={d}>
                  {t(`sources.decoder.${d}`)}
                </option>
              ))}
            </SelectField>
            {values.decoderKey === "generic-json" && <MappingEditor value={values.decoderConfig || DEFAULT_MAPPING} readOnly={readOnly} onChange={(config) => set("decoderConfig", config)} />}
            {values.decoderKey === "script" && (
              <SelectField label={t("sources.form.script")} value={values.decodeScriptId} error={show("decodeScriptId")} onChange={(e) => set("decodeScriptId", e.target.value)}>
                <option value="">{t("sources.form.chooseScript")}</option>
                {scripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
            )}
            <p className="text-[12px] text-muted">{t("sources.form.decoderChangeHint")}</p>
          </section>

          <section hidden={tab !== "policy"} className="grid gap-3 md:grid-cols-2">
            <SelectField label={t("sources.form.unknownDevicePolicy")} value={values.unknownDevicePolicy} onChange={(e) => set("unknownDevicePolicy", e.target.value)}>
              <option value="AUTO_REGISTER">{t("sources.policy.AUTO_REGISTER")}</option>
              <option value="REJECT">{t("sources.policy.REJECT")}</option>
            </SelectField>
            <SelectField label={t("sources.form.defaultModel")} value={values.defaultModelId} onChange={(e) => set("defaultModelId", e.target.value)}>
              <option value="">{t("sources.form.noDefault")}</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code ? `${m.code} · ${m.name}` : m.name}
                </option>
              ))}
            </SelectField>
            <SpaceSelect spaces={spaces} label={t("sources.form.defaultSpace")} emptyLabel={t("sources.form.noDefault")} value={values.defaultSpaceId} onChange={(e) => set("defaultSpaceId", e.target.value)} />
            <TextField label={t("sources.form.autoregLimit")} type="number" value={values.autoregLimitPerHour} error={show("autoregLimitPerHour")} onChange={(e) => set("autoregLimitPerHour", e.target.value)} />
            <TextField label={t("sources.form.noDataAlarm")} type="number" value={values.noDataAlarmAfterSec} error={show("noDataAlarmAfterSec")} onChange={(e) => set("noDataAlarmAfterSec", e.target.value)} />
          </section>
        </fieldset>
        {!readOnly && (
          <Card>
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={runTest} disabled={testing}>
                {t("sources.form.test")}
              </Button>
              {mode === "create" ? (
                <>
                  <Button type="submit" name="intent" value="draft" disabled={testing || saving || hasErrors}>
                    {t("sources.form.saveDraft")}
                  </Button>
                  <Button type="submit" name="intent" value="activate" variant="primary" disabled={testing || saving || hasErrors}>
                    {t("sources.form.saveActivate")}
                  </Button>
                </>
              ) : (
                <Button type="submit" name="intent" value="save" variant="primary" disabled={testing || saving || hasErrors}>
                  {t("common.save")}
                </Button>
              )}
            </div>
            {mode === "edit" && <p className="mt-2 text-right text-[12px] text-muted">{t("sources.form.reconnectHint")}</p>}
          </Card>
        )}
      </Form>
      <aside>
        <div className="flex flex-col gap-2">
          {!readOnly && (
            <TextField
              label={t("sources.test.timeout")}
              type="number"
              min={TEST_TIMEOUT_RANGE.min}
              max={TEST_TIMEOUT_RANGE.max}
              value={String(timeoutSec)}
              onChange={(e) => setTimeoutSec(clampTestTimeout(Number(e.target.value)))}
            />
          )}
          <ConnectionTestPanel result={result} testing={testing} error={testError} onRetry={readOnly ? undefined : runTest} timeoutSec={timeoutSec} />
        </div>
      </aside>
    </div>
  );
}
