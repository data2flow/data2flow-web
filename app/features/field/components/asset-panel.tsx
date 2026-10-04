/**
 * 기기 상세 [자산] 탭(UI-DEV-06 관계·자산, UI-DEV-13 자산 정보, DEV-08.01, API-DEV-96)과 QR 라벨(UI-DEV-17, DEV-09.04, API-DEV-24).
 * - 자산 정보: 시리얼·구매일·설치일·보증 만료일·공급처·설치 업체, 사진(이미지 ≤20MB). 저장·사진 추가·삭제는 DEV_ADMIN
 * - QR: 기기 QR(`{웹}/d/{qrToken}`) 미리 보기, 재발급(이전 라벨은 404, DEV_PLACE), 라벨 PDF 인쇄(A4 3×8)
 */
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert, Button, Card, Dialog, TextField } from "~/components/ui";
import { fieldApi, type FieldApi } from "../api";
import type { QrInfo } from "../model/commissioning";
import { assetBody, browserUrl, checkAssetInput, checkAttachment, idFromUrl, warrantyDaysLeft, type AssetInfo, type AssetInput } from "../model/work-orders";
import { PhotoPicker } from "./common";

const toInput = (a: AssetInfo | null): AssetInput => ({
  serialNo: a?.serialNo ?? "",
  purchasedOn: a?.purchasedOn ?? "",
  installedOn: a?.installedOn ?? "",
  warrantyUntil: a?.warrantyUntil ?? "",
  supplier: a?.supplier ?? "",
  installer: a?.installer ?? "",
});

export interface AssetPanelProps {
  deviceId: string;
  deviceName: string;
  canEdit: boolean;
  canPlace: boolean;
  api?: FieldApi;
  now?: () => number;
  /** 파일 내려받기(테스트에서 바꾼다) */
  save?: (blob: Blob, fileName: string) => void;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AssetPanel({ deviceId, deviceName, canEdit, canPlace, api = fieldApi, now = Date.now, save = saveBlob }: AssetPanelProps) {
  const { t } = useTranslation();
  const [asset, setAsset] = useState<AssetInfo | null>(null);
  const [input, setInput] = useState<AssetInput>(toInput(null));
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const result = await api.asset(deviceId);
    setLoading(false);
    setLoadFailed(!result.ok);
    if (result.ok) {
      setAsset(result.data);
      setInput(toInput(result.data));
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const set = (key: keyof AssetInput) => (e: { target: { value: string } }) => setInput((v) => ({ ...v, [key]: e.target.value }));
  const err = (key: string) => (errors[key] ? t(`field.validation.${key}.${errors[key]}`) : undefined);
  const fail = (code: string) => setMessage({ tone: "danger", text: t(`errors.${code}`, { defaultValue: t("errors.UNKNOWN") }) });

  const submit = async () => {
    const found = checkAssetInput(input);
    setErrors(found);
    if (Object.keys(found).length) return;
    const result = await api.saveAsset(deviceId, assetBody(input));
    if (result.ok) {
      setAsset(result.data);
      setMessage({ tone: "success", text: t("common.saved") });
    } else fail(result.code);
  };

  const addPhotos = async (files: File[]) => {
    for (const file of files) {
      const invalid = checkAttachment(file);
      if (invalid || !file.type.startsWith("image/")) {
        setMessage({ tone: "danger", text: t(`field.attachments.invalid.${invalid ?? "type"}`) });
        return;
      }
      const result = await api.addAssetPhoto(deviceId, file, file.name);
      if (result.ok) setAsset(result.data);
      else return fail(result.code);
    }
  };

  const removePhoto = async (url: string) => {
    const id = idFromUrl(url, "photos");
    if (!id) return;
    const result = await api.deleteAssetPhoto(deviceId, id);
    if (result.ok) setAsset((a) => (a ? { ...a, photoUrls: a.photoUrls.filter((u) => u !== url) } : a));
    else fail(result.code);
  };

  if (loading && !asset) return <Card title={t("field.asset.title")}><p className="text-[13px] text-muted">{t("common.loading")}</p></Card>;
  const days = warrantyDaysLeft(asset?.warrantyUntil, now());
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card title={t("field.asset.title")}>
        {loadFailed && (
          <Alert tone="warning">
            {t("field.loadFailed")}{" "}
            <button type="button" className="underline" onClick={() => void load()}>
              {t("common.retry")}
            </button>
          </Alert>
        )}
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {days !== null && days <= 30 && <Alert tone={days < 0 ? "danger" : "warning"}>{days < 0 ? t("field.asset.warrantyExpired") : t("field.asset.warrantySoon", { days })}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t("field.asset.serialNo")} value={input.serialNo} disabled={!canEdit} error={err("serialNo")} onChange={set("serialNo")} />
          <TextField label={t("field.asset.supplier")} value={input.supplier} disabled={!canEdit} error={err("supplier")} onChange={set("supplier")} />
          <TextField type="date" label={t("field.asset.purchasedOn")} value={input.purchasedOn} disabled={!canEdit} onChange={set("purchasedOn")} />
          <TextField type="date" label={t("field.asset.installedOn")} value={input.installedOn} disabled={!canEdit} error={err("installedOn")} onChange={set("installedOn")} />
          <TextField type="date" label={t("field.asset.warrantyUntil")} value={input.warrantyUntil} disabled={!canEdit} error={err("warrantyUntil")} onChange={set("warrantyUntil")} />
          <TextField label={t("field.asset.installer")} value={input.installer} disabled={!canEdit} error={err("installer")} onChange={set("installer")} />
        </div>
        <h3 className="mt-4 mb-2 text-[13px] font-semibold">{t("field.asset.photos", { count: asset?.photoUrls.length ?? 0 })}</h3>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {(asset?.photoUrls ?? []).map((url, i) => (
            <li key={url} className="flex flex-col gap-1">
              <img src={browserUrl(url) ?? undefined} alt={t("field.asset.photoAlt", { n: i + 1 })} className="aspect-square w-full rounded border border-line object-cover" />
              {canEdit && (
                <button type="button" className="text-left text-[12px] text-bad" aria-label={t("field.asset.removePhoto", { n: i + 1 })} onClick={() => void removePhoto(url)}>
                  {t("common.delete")}
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="mt-3 flex justify-between gap-2">
            <PhotoPicker label={t("field.asset.addPhoto")} multiple onFiles={(files) => void addPhotos(files)} />
            <Button variant="primary" onClick={() => void submit()}>
              {t("common.save")}
            </Button>
          </div>
        )}
        <p className="mt-3 text-[12.5px]">
          <Link className="text-accent hover:underline" to={`/work-orders?view=all&deviceId=${encodeURIComponent(deviceId)}`}>
            {t("field.asset.workOrders")}
          </Link>
        </p>
      </Card>
      <QrCard deviceId={deviceId} deviceName={deviceName} canPlace={canPlace} api={api} save={save} />
    </div>
  );
}

/** QR 미리 보기·재발급·라벨 인쇄(DEV-09.04) */
export function QrCard({ deviceId, deviceName, canPlace, api = fieldApi, save = saveBlob }: { deviceId: string; deviceName: string; canPlace: boolean; api?: FieldApi; save?: (blob: Blob, fileName: string) => void }) {
  const { t } = useTranslation();
  const [qr, setQr] = useState<QrInfo | null>(null);
  const [svg, setSvg] = useState<string>("");
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void api.qr(deviceId).then((result) => {
      if (alive && result.ok) setQr(result.data);
    });
    return () => {
      alive = false;
    };
  }, [api, deviceId]);
  useEffect(() => {
    if (!qr) return;
    let alive = true;
    void QRCode.toString(qr.url, { type: "svg", margin: 1, width: 160 }).then((s) => alive && setSvg(s));
    return () => {
      alive = false;
    };
  }, [qr]);
  const reissue = async () => {
    setConfirm(false);
    const result = await api.reissueQr(deviceId);
    if (result.ok) {
      setQr(result.data);
      setMessage({ tone: "success", text: t("field.qr.reissued") });
    } else setMessage({ tone: "danger", text: t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }) });
  };
  const print = async () => {
    const result = await api.qrLabels([deviceId], "A4_3x8");
    if (result.ok) save(result.blob, result.fileName);
    else setMessage({ tone: "danger", text: t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }) });
  };
  return (
    <Card title={t("field.qr.title")}>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {qr ? (
        <figure className="flex flex-col items-center gap-2">
          {/* qrcode 라이브러리가 만든 SVG(외부 입력 아님) */}
          <div role="img" aria-label={t("field.qr.alt", { name: deviceName })} dangerouslySetInnerHTML={{ __html: svg }} />
          <figcaption className="break-all text-center font-mono text-[11.5px] text-muted">{qr.url}</figcaption>
        </figure>
      ) : (
        <p className="text-[13px] text-muted">{t("common.loading")}</p>
      )}
      {canPlace && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => void print()}>{t("field.qr.print")}</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            {t("field.qr.reissue")}
          </Button>
        </div>
      )}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("field.qr.reissue")}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={() => void reissue()}>
              {t("field.qr.reissue")}
            </Button>
          </>
        }
      >
        <p className="text-[13px]">{t("field.qr.reissueWarning")}</p>
      </Dialog>
    </Card>
  );
}
