/**
 * 카탈로그 커넥터 설정 폼(UI-DSC-08, DSC-09.01·09.05·09.06·09.08·09.11·09.12, DSC-01.03 Webhook 수신).
 * 탭: 기본 · (커넥터 스키마 `x-ui.tabs`) · 인증(방식별 비밀값, DSC-09.05 매트릭스) · TLS · 디코더(토픽 템플릿) · 정책.
 * 스키마로 브라우저에서 먼저 검사하고(오류 탭에 빨간 점), 서버 오류 `errors[{field}]`는 해당 필드 아래에 보인다.
 * 오른쪽은 단계별 연결 테스트 패널(UI-DSC-09). 폴링형 커넥터는 "구독" 대신 "첫 폴링" 단계(TC-DSC-301).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";
import { SpaceSelect } from "~/components/space-picker";
import { Alert, Badge, Button, Card, Checkbox, CsrfField, SelectField, TextField, cx } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { SpaceNode } from "~/lib/spaces";
import { isLossy, type Connector } from "../model/catalog";
import { authMethodOf, blocksDraft, connectorTestBody, decoderChoices, isPolling, validateConnectorForm, type ConnectorFormValues } from "../model/connector-source";
import { mappingFromConfig, validateMapping } from "../model/mapping";
import { authChoices, authField, authMatrixRows, conditionsOf, isVisible, schemaTabs, secretKindsFor, serverErrorsToPaths, setPath, tlsFrom, type ConnectorSchema } from "../model/schema-form";
import { DEFAULT_MAPPING, TEST_TIMEOUT_RANGE, TEST_TIMEOUT_SEC, clampTestTimeout } from "../model/source";
import { ConnectionTestPanel } from "./connection-test-panel";
import { MappingEditor } from "./mapping-editor";
import { SchemaField, SecretInput } from "./schema-fields";
import type { Option } from "./source-form";
import { TlsSettingsBlock, type StoredSecret } from "./tls-settings";
import { TopicTemplateHelper } from "./topic-template";
import { useConnectionTest } from "./use-connection-test";

export interface ConnectorSourceFormProps {
  schema: ConnectorSchema;
  connector: Connector;
  initial: ConnectorFormValues;
  mode: "create" | "edit";
  readOnly?: boolean;
  storedSecrets?: StoredSecret[];
  models: Option[];
  spaces: SpaceNode[];
  scripts: Option[];
  idempotencyKey?: string;
  baseVersion?: number;
  testPath: string;
  serverError?: { code: string; message?: string } | null;
  serverFieldErrors?: { field: string; code: string; message: string }[];
  cloned?: boolean;
}

const FIXED_BEFORE = ["basic"];
const FIXED_AFTER = ["auth", "tls", "decoder", "policy"];

export function ConnectorSourceForm({ schema, connector, initial, mode, readOnly = false, storedSecrets = [], models, spaces, scripts, idempotencyKey, baseVersion, testPath, serverError, serverFieldErrors, cloned }: ConnectorSourceFormProps) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [values, setValues] = useState<ConnectorFormValues>(initial);
  const [touched, setTouched] = useState(false);
  const [tab, setTab] = useState("basic");
  const [timeoutSec, setTimeoutSec] = useState(TEST_TIMEOUT_SEC);
  const test = useConnectionTest(testPath);
  const supported = connector.authMethods ?? [];
  const configured = storedSecrets.filter((s) => s.configured).map((s) => s.kind);
  const errors = validateConnectorForm(schema, supported, values, { editing: mode === "edit", configuredSecrets: configured });
  const mappingInvalid = values.decoderKey === "generic-json" && validateMapping(mappingFromConfig(values.decoderConfig || DEFAULT_MAPPING)).length > 0;
  if (mappingInvalid) errors.decoderConfig = "mapping";
  for (const [path, code] of Object.entries(serverErrorsToPaths(serverFieldErrors))) {
    const key = path in (schema.jsonSchema.properties ?? {}) || path.includes(".") || path.includes("[") ? `connection.${path}` : path;
    if (!(key in errors)) errors[key] = code;
  }
  const showErrors = touched || mode === "edit" || (serverFieldErrors?.length ?? 0) > 0;
  const tabs = schemaTabs(schema);
  const conditions = conditionsOf(schema);
  const { methods, stored } = authChoices(schema, supported);
  const method = authMethodOf(schema, supported, values);
  const authPath = authField(schema);
  const kinds = secretKindsFor(schema, method);
  // Webhook 수신은 서버가 HMAC 비밀값을 만들고(DSC-01.03) TLS는 플랫폼 443이 맡는다: 인증·TLS 탭 없음
  const inbound = values.type === "WEBHOOK";
  const showAuth = !inbound && (stored || methods.some((m) => m !== "NONE"));
  const allTabs = [...FIXED_BEFORE, ...tabs.map((x) => x.name), ...FIXED_AFTER.filter((x) => (x !== "auth" || showAuth) && (x !== "tls" || !inbound))];
  const props = schema.jsonSchema.properties ?? {};
  const saving = navigation.state === "submitting";
  const polling = isPolling(schema.key);
  const hasTlsObject = "tls" in props;

  const setConnection = (path: string, value: unknown) => {
    setTouched(true);
    setValues((v) => ({ ...v, connection: setPath(v.connection, path, value) }));
  };
  const set = <K extends keyof ConnectorFormValues>(key: K, value: ConnectorFormValues[K]) => {
    setTouched(true);
    setValues((v) => ({ ...v, [key]: value }));
  };
  const setSecret = (kind: string, value: string) => set("secrets", { ...values.secrets, [kind]: value });
  const fieldsOfTab = (name: string): string[] => {
    if (name === "basic") return ["code", "name"];
    if (name === "auth") return ["connection.auth", ...Object.keys(errors).filter((k) => k.startsWith("secret."))];
    if (name === "tls") return ["connection.tls", "connection.tlsInsecure"];
    if (name === "decoder") return ["decoderKey", "decodeScriptId", "decoderConfig"];
    if (name === "policy") return ["autoregLimitPerHour", "noDataAlarmAfterSec"];
    return (tabs.find((x) => x.name === name)?.fields ?? []).map((f) => `connection.${f}`);
  };
  const tabHasError = (name: string) => Object.keys(errors).some((k) => fieldsOfTab(name).some((f) => k === f || k.startsWith(`${f}.`) || k.startsWith(`${f}[`)));
  const err = (key: string) => (showErrors && errors[key] ? (serverFieldErrors?.find((f) => f.field === key)?.message || t(`sources.validation.${errors[key]}`, { defaultValue: t(`sources.schema.error.${errors[key]}`, { defaultValue: errors[key] }) })) : undefined);
  const serverMessages = Object.fromEntries((serverFieldErrors ?? []).filter((f) => f.message).map((f) => [f.field.replace(/^connection\./, ""), f.message]));
  const connectionErrors = Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith("connection.")).map(([k, v]) => [k.slice("connection.".length), v]));
  const activateBlocked = Object.keys(errors).length > 0;
  const draftBlocked = blocksDraft(errors);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Form method="post" className="flex flex-col gap-3" onSubmit={() => setTouched(true)}>
        <CsrfField />
        <input type="hidden" name="payload" value={JSON.stringify(values)} />
        {idempotencyKey && <input type="hidden" name="idempotencyKey" value={idempotencyKey} />}
        {baseVersion !== undefined && <input type="hidden" name="baseVersion" value={baseVersion} />}
        {readOnly && <Alert tone="info">{t("sources.form.readOnly")}</Alert>}
        {cloned && <Alert tone="warning">{t("sources.clone.reenterSecrets")}</Alert>}
        {serverError && <Alert tone="danger">{serverError.code === "VERSION_CONFLICT" ? t("sources.form.conflict") : errorText(t, serverError)}</Alert>}
        <nav className="flex flex-wrap gap-1 border-b border-line" aria-label={t("sources.form.tabs")}>
          {allTabs.map((key) => (
            <button key={key} type="button" aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)} className={cx("-mb-px border-b-2 px-3 py-2 text-[13px]", tab === key ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-text")}>
              {t(`sources.form.tab.${key}`, { defaultValue: t(`sources.schema.tab.${key}`, { defaultValue: key }) })}
              {showErrors && tabHasError(key) && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-bad align-middle" aria-label={t("sources.form.tabError")} />}
            </button>
          ))}
        </nav>
        <fieldset disabled={readOnly} className="flex flex-col gap-3">
          <section hidden={tab !== "basic"} className="grid gap-3 md:grid-cols-2">
            <TextField label={t("sources.form.type")} value={`${connector.name}${schema.version ? ` · v${schema.version}` : ""}`} readOnly />
            <TextField label={t("sources.form.code")} value={values.code} readOnly={mode === "edit"} hint={t("sources.form.codeHint")} error={err("code")} onChange={(e) => set("code", e.target.value)} />
            <TextField label={t("sources.form.name")} value={values.name} error={err("name")} onChange={(e) => set("name", e.target.value)} />
            <Checkbox label={t("sources.form.isDev")} checked={values.isDev} onChange={(e) => set("isDev", e.target.checked)} />
            <div className="col-span-full flex flex-wrap gap-2 text-[12.5px]">
              <span>{t("sources.schema.ackMode", { mode: t(`sources.schema.ack.${connector.ackMode ?? "AUTO"}`, { defaultValue: connector.ackMode ?? "–" }) })}</span>
              <span>· {t("sources.schema.scaling", { scaling: connector.scaling ?? "–" })}</span>
              {isLossy(connector) && <Badge tone="warning">{t("sources.form.lossPossible")}</Badge>}
            </div>
            {inbound && <p className="col-span-full text-[12.5px] text-muted">{t("sources.webhook.urlAfterSave")}</p>}
          </section>

          {tabs.map((tb) => (
            <section key={tb.name} hidden={tab !== tb.name} className="grid gap-3 md:grid-cols-2">
              {tb.fields
                .filter((f) => isVisible(f, values.connection, conditions))
                .map((f) => (
                  <SchemaField key={f} name={f} path={f} schema={props[f]} required={(schema.jsonSchema.required ?? []).includes(f)} root={values.connection} errors={connectionErrors} showErrors={showErrors} readOnly={readOnly} onChange={setConnection} serverMessages={serverMessages} />
                ))}
            </section>
          ))}

          {showAuth && (
            <section hidden={tab !== "auth"} className="flex flex-col gap-3">
              <fieldset className="flex flex-wrap gap-3" aria-label={t("sources.form.auth")}>
                <legend className="mb-1 w-full text-[12.5px] font-semibold">{t("sources.form.auth")}</legend>
                {methods.map((m) => (
                  <label key={m} className="flex items-center gap-1 text-[13px]">
                    <input type="radio" name="authMethodChoice" value={m} checked={method === m} onChange={() => (authPath ? setConnection(authPath.path, m) : set("authMethod", m))} />
                    {t(`sources.auth.${m}`, { defaultValue: m })}
                  </label>
                ))}
              </fieldset>
              {!stored && <p className="text-[12px] text-muted">{t("sources.schema.authNotStored")}</p>}
              {authPath && Object.keys(authPath.fields).length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {Object.entries(authPath.fields).map(([f, sub]) => (
                    <SchemaField key={f} name={f} path={`auth.${f}`} schema={sub} root={values.connection} errors={connectionErrors} showErrors={showErrors} readOnly={readOnly} onChange={setConnection} serverMessages={serverMessages} />
                  ))}
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                {[...kinds.required, ...kinds.optional.filter((k) => k !== "CA_CERT")].map((kind) => {
                  const s = storedSecrets.find((x) => x.kind === kind);
                  return <SecretInput key={kind} kind={kind} required={kinds.required.includes(kind)} value={values.secrets[kind] ?? ""} configured={s?.configured} fingerprint={s?.fingerprint} expiresAt={s?.certificateExpiresAt} error={err(`secret.${kind}`)} readOnly={readOnly} onChange={(v) => setSecret(kind, v)} />;
                })}
              </div>
              {kinds.required.length > 0 && mode === "create" && <p className="text-[12px] text-muted">{t("sources.schema.secretForActivate")}</p>}
              <AuthMatrix schema={schema} supported={supported} current={method} />
            </section>
          )}

          <section hidden={tab !== "tls" || inbound}>
            {!hasTlsObject && <p className="mb-2 text-[12px] text-muted">{t("sources.tls.connectorScope")}</p>}
            <TlsSettingsBlock
              tls={tlsFrom(values.connection.tls)}
              onTls={(next) => setConnection("tls", next)}
              verifyOff={values.connection.tlsInsecure === true}
              onVerifyOff={"tlsInsecure" in props ? (off) => setConnection("tlsInsecure", off) : undefined}
              isDev={values.isDev}
              secrets={values.secrets}
              onSecret={setSecret}
              clientCert={false}
              stored={storedSecrets}
              showTlsObject={hasTlsObject}
              readOnly={readOnly}
              showErrors={showErrors}
            />
          </section>

          <section hidden={tab !== "decoder"} className="flex flex-col gap-3">
            <SelectField label={t("sources.form.decoder")} value={values.decoderKey} error={err("decoderKey")} onChange={(e) => set("decoderKey", e.target.value)}>
              {decoderChoices(values.connectorKey, values.decoderKey).map((d) => (
                <option key={d} value={d}>
                  {t(`sources.decoder.${d}`, { defaultValue: d })}
                </option>
              ))}
            </SelectField>
            {values.decoderKey === "generic-json" && <MappingEditor value={values.decoderConfig || DEFAULT_MAPPING} readOnly={readOnly} onChange={(config) => set("decoderConfig", config)} />}
            {values.decoderKey === "script" && (
              <SelectField label={t("sources.form.script")} value={values.decodeScriptId} error={err("decodeScriptId")} onChange={(e) => set("decodeScriptId", e.target.value)}>
                <option value="">{t("sources.form.chooseScript")}</option>
                {scripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
            )}
            <TopicTemplateHelper decoderKey={values.decoderKey} decoderConfig={values.decoderConfig} readOnly={readOnly} onApply={(config) => set("decoderConfig", config)} />
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
            <TextField label={t("sources.form.autoregLimit")} type="number" value={values.autoregLimitPerHour} error={err("autoregLimitPerHour")} onChange={(e) => set("autoregLimitPerHour", e.target.value)} />
            <TextField label={t("sources.form.noDataAlarm")} type="number" value={values.noDataAlarmAfterSec} error={err("noDataAlarmAfterSec")} onChange={(e) => set("noDataAlarmAfterSec", e.target.value)} />
          </section>
        </fieldset>
        {!readOnly && (
          <Card>
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => test.start(connectorTestBody(schema, supported, values), timeoutSec)} disabled={test.testing}>
                {t("sources.form.test")}
              </Button>
              {mode === "create" ? (
                <>
                  <Button type="submit" name="intent" value="draft" disabled={test.testing || saving || draftBlocked}>
                    {t("sources.form.saveDraft")}
                  </Button>
                  <Button type="submit" name="intent" value="activate" variant="primary" disabled={test.testing || saving || activateBlocked}>
                    {t("sources.form.saveActivate")}
                  </Button>
                </>
              ) : (
                <Button type="submit" name="intent" value="save" variant="primary" disabled={test.testing || saving || draftBlocked}>
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
          {!readOnly && <TextField label={t("sources.test.timeout")} type="number" min={TEST_TIMEOUT_RANGE.min} max={TEST_TIMEOUT_RANGE.max} value={String(timeoutSec)} onChange={(e) => setTimeoutSec(clampTestTimeout(Number(e.target.value)))} />}
          <ConnectionTestPanel result={test.result} testing={test.testing} error={test.error} timedOut={test.timedOut} onRetry={readOnly ? undefined : () => test.start(connectorTestBody(schema, supported, values), timeoutSec)} timeoutSec={timeoutSec} polling={polling} />
        </div>
      </aside>
    </div>
  );
}

/** 인증 방식 매트릭스(DSC-09.05): 지원 방식마다 필수·선택 비밀값 */
export function AuthMatrix({ schema, supported, current }: { schema: ConnectorSchema; supported: string[]; current?: string }) {
  const { t } = useTranslation();
  const rows = authMatrixRows(schema, supported);
  const kind = (k: string) => t(`sources.secretKind.${k}`, { defaultValue: k });
  return (
    <table className="text-[12.5px]" aria-label={t("sources.schema.matrix")}>
      <thead>
        <tr className="text-left text-muted">
          <th className="pr-3 font-normal">{t("sources.form.auth")}</th>
          <th className="pr-3 font-normal">{t("sources.schema.required")}</th>
          <th className="font-normal">{t("sources.schema.optional")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.method} className={cx(r.method === current && "font-semibold")}>
            <td className="pr-3">{t(`sources.auth.${r.method}`, { defaultValue: r.method })}</td>
            <td className="pr-3">{r.required.map(kind).join(", ") || "–"}</td>
            <td>{r.optional.map(kind).join(", ") || "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
