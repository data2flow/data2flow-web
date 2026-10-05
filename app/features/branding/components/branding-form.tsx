/**
 * UI-DSH-13 브랜딩 설정 폼(DSH-13.01): 로고 2종·파비콘·로그인 배경 올리기, 주 색상(색 선택 + HEX)과 흰 배경 대비,
 * 로그인 문구·메일 발신 이름·서명·공개 화면 테마, 미리 보기(웹 헤더·로그인·메일). 대비 4.5:1 미만이면 [그래도 저장]을 눌러야 저장된다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toBffUrl } from "~/features/dashboards/components/widget-body";
import { Alert, Button, Card, SelectField, TextArea, TextField } from "~/components/ui";
import { bffFetch, bffJson } from "~/lib/bff-client";
import { AA_TEXT, formatRatio } from "~/lib/color";
import { LOGIN_MESSAGE_MAX, PUBLIC_THEMES, SENDER_NAME_MAX, SIGNATURE_MAX, brandingBody, checkAsset, contrastCheck, formOf, validateBranding, type AssetKind, type Branding, type BrandingForm as Form } from "../model/branding";

export interface BrandingApi {
  save: (body: Record<string, unknown>) => Promise<{ ok: true; data: Branding } | { ok: false; status: number; code: string; message: string }>;
  upload: (kind: AssetKind, file: File) => Promise<{ ok: true; data: { assetId: string; url: string } } | { ok: false; code: string; message: string }>;
}

export const defaultBrandingApi: BrandingApi = {
  save: (body) => bffJson<Branding>("/bff/api/core/branding", { method: "PUT", body }),
  async upload(kind, file) {
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", file);
    try {
      const response = await bffFetch("/bff/api/core/branding/assets", { method: "POST", body: form });
      const json = (await response.json().catch(() => null)) as { header?: { resultCode?: string; resultMessage?: string }; response?: { assetId: string; url: string } } | null;
      if (response.ok && json?.response) return { ok: true, data: json.response };
      return { ok: false, code: json?.header?.resultCode ?? "UNKNOWN", message: json?.header?.resultMessage ?? "" };
    } catch {
      return { ok: false, code: "SERVICE_UNAVAILABLE", message: "" };
    }
  },
};

const ASSETS: { kind: AssetKind; field: keyof Form; urlKey: keyof Branding; accept: string }[] = [
  { kind: "LOGO_LIGHT", field: "logoLightAssetId", urlKey: "logoLightUrl", accept: "image/png,image/svg+xml" },
  { kind: "LOGO_DARK", field: "logoDarkAssetId", urlKey: "logoDarkUrl", accept: "image/png,image/svg+xml" },
  { kind: "FAVICON", field: "faviconAssetId", urlKey: "faviconUrl", accept: "image/x-icon,image/png" },
  { kind: "LOGIN_BACKGROUND", field: "loginBackgroundAssetId", urlKey: "loginBackgroundUrl", accept: "image/png,image/jpeg" },
];

export function BrandingForm({ initial, api = defaultBrandingApi }: { initial: Branding | null; api?: BrandingApi }) {
  const { t } = useTranslation();
  const [branding, setBranding] = useState<Branding | null>(initial);
  const [form, setForm] = useState<Form>(formOf(initial));
  const [urls, setUrls] = useState<Partial<Record<AssetKind, string>>>({});
  const [needsAck, setNeedsAck] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [preview, setPreview] = useState<"web" | "login" | "mail">("web");
  const contrast = contrastCheck(form.primaryColor);
  const errors = validateBranding(form);
  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setNeedsAck(false);
  };

  const upload = async (kind: AssetKind, field: keyof Form, file: File) => {
    setMessage(null);
    const text = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg") ? await file.text() : undefined;
    const check = checkAsset(kind, file, text);
    if (!check.ok) {
      setMessage({ tone: "danger", text: t(`branding.assetErrors.${check.reason}`) });
      return;
    }
    const r = await api.upload(kind, file);
    if (!r.ok) {
      setMessage({ tone: "danger", text: r.message || t(`branding.assetErrors.${r.code}`, { defaultValue: r.code }) });
      return;
    }
    setForm((f) => ({ ...f, [field]: r.data.assetId }));
    setUrls((u) => ({ ...u, [kind]: r.data.url }));
  };

  const save = async (acked: boolean) => {
    setMessage(null);
    if (Object.keys(errors).length) return;
    if (contrast.low && !acked) {
      setNeedsAck(true);
      return;
    }
    const r = await api.save(brandingBody(form, branding?.version ?? 0, acked));
    if (r.ok) {
      setBranding(r.data);
      setNeedsAck(false);
      setMessage({ tone: "success", text: t("branding.saved") });
    } else setMessage({ tone: "danger", text: r.status === 409 ? t("branding.conflict") : r.message || r.code });
  };

  const urlOf = (kind: AssetKind, key: keyof Branding) => toBffUrl(urls[kind] ?? (branding?.[key] as string | null | undefined) ?? null);
  const logo = urlOf("LOGO_LIGHT", "logoLightUrl");
  const color = contrast.ratio !== null ? form.primaryColor : "#206BC4";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t("branding.settings")}>
        <div className="flex flex-col gap-3">
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          {ASSETS.map(({ kind, field, urlKey, accept }) => {
            const url = urlOf(kind, urlKey);
            return (
              <div key={kind} className="flex items-center gap-3 text-[13px]">
                <label className="flex-1">
                  <span className="block font-medium">{t(`branding.assets.${kind}`)}</span>
                  <input
                    type="file"
                    accept={accept}
                    aria-label={t(`branding.assets.${kind}`)}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(kind, field, file);
                    }}
                  />
                </label>
                {url && <img src={url} alt="" className="h-8 max-w-24 rounded border border-line object-contain" />}
              </div>
            );
          })}
          <div className="flex items-end gap-2">
            <input type="color" aria-label={t("branding.colorPicker")} value={contrast.ratio !== null ? form.primaryColor : "#206bc4"} onChange={(e) => set({ primaryColor: e.target.value.toUpperCase() })} className="h-9 w-12" />
            <TextField label={t("branding.primaryColor")} value={form.primaryColor} maxLength={7} onChange={(e) => set({ primaryColor: e.target.value })} error={errors.primaryColor ? t("branding.errors.COLOR") : undefined} />
          </div>
          {contrast.label && (
            <p className={contrast.low ? "text-[13px] text-fair-ink" : "text-[13px] text-good-ink"} role="status">
              {contrast.low ? `! ${t("branding.lowContrast", { ratio: contrast.label, min: formatRatio(AA_TEXT) })}` : `✔ ${t("branding.contrastOk", { ratio: contrast.label })}`}
            </p>
          )}
          <TextField label={t("branding.appName")} value={form.appName} maxLength={50} onChange={(e) => set({ appName: e.target.value })} />
          <TextField label={t("branding.loginMessage", { max: LOGIN_MESSAGE_MAX })} value={form.loginMessage} onChange={(e) => set({ loginMessage: e.target.value })} error={errors.loginMessage ? t("branding.errors.LOGIN_MESSAGE", { max: LOGIN_MESSAGE_MAX }) : undefined} />
          <TextField label={t("branding.mailSenderName", { max: SENDER_NAME_MAX })} value={form.mailSenderName} onChange={(e) => set({ mailSenderName: e.target.value })} error={errors.mailSenderName ? t("branding.errors.SENDER_NAME", { max: SENDER_NAME_MAX }) : undefined} />
          <TextArea label={t("branding.mailSignature", { max: SIGNATURE_MAX })} value={form.mailSignature} onChange={(e) => set({ mailSignature: e.target.value })} error={errors.mailSignature ? t("branding.errors.SIGNATURE", { max: SIGNATURE_MAX }) : undefined} />
          <SelectField label={t("branding.publicTheme")} value={form.publicTheme} onChange={(e) => set({ publicTheme: e.target.value })}>
            {PUBLIC_THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {t(`branding.themes.${theme}`)}
              </option>
            ))}
          </SelectField>
          {needsAck && (
            <Alert tone="warning">
              <p>{t("branding.lowContrast", { ratio: contrast.label, min: formatRatio(AA_TEXT) })}</p>
              <Button variant="danger" onClick={() => void save(true)}>
                {t("branding.saveAnyway")}
              </Button>
            </Alert>
          )}
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => void save(false)}>
              {t("branding.save")}
            </Button>
          </div>
        </div>
      </Card>
      <Card title={t("branding.preview")}>
        <div className="mb-2 flex gap-1" role="tablist">
          {(["web", "login", "mail"] as const).map((key) => (
            <button key={key} type="button" role="tab" aria-selected={preview === key} className={preview === key ? "rounded border border-accent px-2 py-1 text-[12px] text-accent" : "rounded border border-line px-2 py-1 text-[12px]"} onClick={() => setPreview(key)}>
              {t(`branding.previews.${key}`)}
            </button>
          ))}
        </div>
        <div data-testid="branding-preview" className="rounded-md border border-line p-3 text-[13px]" style={{ "--d2f-accent": color } as React.CSSProperties}>
          {preview === "web" && (
            <div className="flex items-center gap-3 border-b-2 pb-2" style={{ borderColor: color }}>
              {logo ? <img src={logo} alt="" className="h-6" /> : <strong>{form.appName || "data2flow"}</strong>}
              <span style={{ color }} className="font-semibold">
                {t("nav.home")}
              </span>
              <span className="text-muted">{t("nav.spaces")}</span>
            </div>
          )}
          {preview === "login" && (
            <div className="flex flex-col items-center gap-2 py-4">
              {logo && <img src={logo} alt="" className="h-8" />}
              <p>{form.loginMessage || t("branding.noLoginMessage")}</p>
              <span className="rounded px-3 py-1 text-white" style={{ background: color }}>
                {t("branding.loginButton")}
              </span>
            </div>
          )}
          {preview === "mail" && (
            <div>
              <p className="text-muted">
                {t("branding.from")}: {form.mailSenderName || "data2flow"}
              </p>
              <p className="mt-2">…</p>
              <p className="mt-2 whitespace-pre-wrap border-t border-line pt-2 text-muted">{form.mailSignature}</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

