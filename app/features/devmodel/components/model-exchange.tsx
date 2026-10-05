/**
 * UI-DEV-08 모델 [가져오기]·[내보내기(data2flow/DTDL)](DEV-03.04, API-DEV-44·45).
 * - 내보내기: 정의 JSON(측정 항목·기능·속성 스키마·스크립트 코드)을 받아 파일로 저장한다
 * - 가져오기: 파일 선택 → [미리 보기](dryRun: 만들 측정 항목, 매핑 못한 DTDL 요소, 스크립트) → [가져오기](201) → 새 모델 화면
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Checkbox, Dialog, SelectField, Table } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { browserDownload, type DevModelApi, type Downloader } from "../api";
import { modelFileName, type ImportResult, type ModelExportFormat } from "../model/types";

export const IMPORT_MAX_BYTES = 1024 * 1024;

export function ModelExportButtons({ modelId, code, api, download = browserDownload }: { modelId: string; code: string; api: DevModelApi; download?: Downloader }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const run = async (format: ModelExportFormat) => {
    setError(null);
    const result = await api.exportModel(modelId, format);
    if (!result.ok) {
      setError(errorText(t, result) ?? null);
      return;
    }
    download(modelFileName(code, format), JSON.stringify(result.data, null, 2), "application/json");
  };
  return (
    <>
      <Button onClick={() => void run("data2flow")}>{t("devmodel.models.exportData2flow")}</Button>
      <Button onClick={() => void run("dtdl")}>{t("devmodel.models.exportDtdl")}</Button>
      {error && (
        <span role="alert" className="text-[12.5px] text-bad-ink">
          {error}
        </span>
      )}
    </>
  );
}

export function ModelImportDialog({ open, onClose, api, onImported }: { open: boolean; onClose: () => void; api: DevModelApi; onImported: (code: string) => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<"" | "data2flow" | "dtdl">("");
  const [createMissing, setCreateMissing] = useState(true);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setPreview(null);
    setError(null);
  };
  const send = async (dryRun: boolean) => {
    if (!file) {
      setError(t("devmodel.models.fileRequired"));
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      setError(t("devmodel.models.fileTooLarge"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api.importModel({ file, format, createMissingMetrics: createMissing, dryRun });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(t, result) ?? null);
      return;
    }
    if (dryRun) setPreview(result.data);
    else if (result.data.model) onImported(result.data.model.code);
  };

  return (
    <Dialog
      title={t("devmodel.models.importTitle")}
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => void send(true)} disabled={busy || !file}>
            {t("devmodel.models.preview")}
          </Button>
          <Button variant="primary" onClick={() => void send(false)} disabled={busy || !preview}>
            {t("devmodel.models.import")}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
        {t("devmodel.models.file")}
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            reset();
          }}
        />
      </label>
      <SelectField
        label={t("devmodel.models.format")}
        value={format}
        onChange={(e) => {
          setFormat(e.target.value as typeof format);
          reset();
        }}
      >
        <option value="">{t("devmodel.models.formatAuto")}</option>
        <option value="data2flow">data2flow</option>
        <option value="dtdl">DTDL</option>
      </SelectField>
      <Checkbox
        label={t("devmodel.models.createMissing")}
        checked={createMissing}
        onChange={(e) => {
          setCreateMissing(e.target.checked);
          reset();
        }}
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {preview && (
        <section aria-label={t("devmodel.models.previewTitle")} className="flex flex-col gap-2 text-[13px]">
          <p>{t("devmodel.models.previewFormat", { format: preview.format })}</p>
          <p>
            {t("devmodel.models.createdMetrics", { n: preview.createdMetrics.length })} {preview.createdMetrics.map((m) => <code key={m} className="mr-1 font-mono">{m}</code>)}
          </p>
          {preview.scripts.length > 0 && <p>{t("devmodel.models.scripts", { names: preview.scripts.map((s) => `${s.name} (${s.kind})`).join(", ") })}</p>}
          {preview.unmapped.length > 0 ? (
            <Table>
              <caption className="text-left text-[12.5px] text-fair-ink">{t("devmodel.models.unmapped", { n: preview.unmapped.length })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("devmodel.models.path")}</th>
                  <th scope="col">{t("devmodel.models.type")}</th>
                  <th scope="col">{t("devmodel.models.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.unmapped.map((u) => (
                  <tr key={u.path}>
                    <td className="font-mono">{u.path}</td>
                    <td>{u.type}</td>
                    <td>{u.reason}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-good-ink">{t("devmodel.models.allMapped")}</p>
          )}
        </section>
      )}
    </Dialog>
  );
}
