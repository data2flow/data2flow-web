/**
 * 설정 탭(SCR-04.02, API-SCR-22): 스크립트 설정값(`ctx.config`) 이름·유형·값 편집. 저장하면 새 버전 없이 10초 안에 반영되고 감사 로그가 남는다.
 * 비밀값으로 보이는 이름(token·password·secret·*_key)은 거부한다(서버 SCRIPT_CONFIG_SECRET_FORBIDDEN과 같은 규칙).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Card, SelectField, TextField } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import type { ScriptOpsApi } from "./m5-api";
import { MAX_CONFIG_ENTRIES, checkConfig, configRowsOf, type ConfigRow, type ConfigType } from "./model/m5";

export function ScriptConfigTab({
  scriptId,
  config,
  version,
  canWrite,
  api,
}: {
  scriptId: string;
  config: Record<string, unknown> | null | undefined;
  version: number | undefined;
  canWrite: boolean;
  api: Pick<ScriptOpsApi, "saveConfig">;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ConfigRow[]>(() => configRowsOf(config));
  const [baseVersion, setBaseVersion] = useState(version);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (index: number, patch: Partial<ConfigRow>) => setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = async () => {
    const checked = checkConfig(rows);
    setErrors(checked.errors);
    if (checked.tooMany) return setNotice({ tone: "danger", text: t("scripts.config.validation.tooMany", { max: MAX_CONFIG_ENTRIES }) });
    if (!checked.config) return setNotice(null);
    setBusy(true);
    const result = await api.saveConfig(scriptId, { config: checked.config, ...(baseVersion === undefined ? {} : { baseVersion }) });
    setBusy(false);
    if (!result.ok) {
      if (result.status === 409) return setNotice({ tone: "warning", text: t("scripts.config.conflict") });
      return setNotice({ tone: "danger", text: errorText(t, result) ?? "" });
    }
    setBaseVersion(result.data.version);
    setRows(configRowsOf(result.data.config));
    setNotice({ tone: "success", text: t("scripts.config.saved") });
  };

  return (
    <Card title={t("scripts.config.title")}>
      <p className="mb-2 text-[12.5px] text-muted">{t("scripts.config.help")}</p>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {rows.length === 0 && <p className="text-[13px] text-muted">{t("scripts.config.empty")}</p>}
      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li key={index} className="flex flex-wrap items-end gap-2" data-testid={`config-row-${index}`}>
            <TextField label={t("scripts.config.name")} value={row.name} disabled={!canWrite} onChange={(e) => update(index, { name: e.target.value })} error={errors[index] ? t(`scripts.config.validation.${errors[index]}`) : undefined} />
            <SelectField label={t("scripts.config.type")} value={row.type} disabled={!canWrite} onChange={(e) => update(index, { type: e.target.value as ConfigType, value: e.target.value === "boolean" ? "false" : row.value })}>
              {(["string", "number", "boolean"] as const).map((type) => (
                <option key={type} value={type}>
                  {t(`scripts.config.types.${type}`)}
                </option>
              ))}
            </SelectField>
            {row.type === "boolean" ? (
              <SelectField label={t("scripts.config.value")} value={row.value} disabled={!canWrite} onChange={(e) => update(index, { value: e.target.value })}>
                <option value="true">true</option>
                <option value="false">false</option>
              </SelectField>
            ) : (
              <TextField label={t("scripts.config.value")} value={row.value} disabled={!canWrite} inputMode={row.type === "number" ? "decimal" : undefined} onChange={(e) => update(index, { value: e.target.value })} />
            )}
            {canWrite && (
              <Button variant="danger" onClick={() => setRows((list) => list.filter((_, i) => i !== index))}>
                {t("common.remove")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <div className="mt-3 flex gap-2">
          <Button disabled={rows.length >= MAX_CONFIG_ENTRIES} onClick={() => setRows((list) => [...list, { name: "", type: "number", value: "0" }])}>
            {t("scripts.config.add")}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? t("common.processing") : t("common.save")}
          </Button>
        </div>
      )}
    </Card>
  );
}
