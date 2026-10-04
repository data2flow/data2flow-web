/**
 * TLS 설정 묶음(UI-DSC-08 TLS 탭, DSC-09.06, BR-DSC-29): 검증 여부(운영 소스는 끌 수 없음), CA 묶음(PEM), 클라이언트 인증서·키(mTLS),
 * SNI, 최소 버전(1.2·1.3), 인증서 고정(SHA-256 최대 5개). CA·인증서·키는 비밀값(쓰기 전용)이고 저장 뒤에는 지문·만료일만 보인다.
 */
import { useTranslation } from "react-i18next";
import { Alert, Button, Checkbox, SelectField, TextField } from "~/components/ui";
import { pemCount, validateTls, type TlsSettings } from "../model/schema-form";
import { SecretInput } from "./schema-fields";

export interface StoredSecret {
  kind: string;
  configured: boolean;
  fingerprint?: string | null;
  certificateExpiresAt?: string | null;
}

export function TlsSettingsBlock({
  tls,
  onTls,
  verifyOff,
  onVerifyOff,
  isDev,
  secrets,
  onSecret,
  clientCert,
  stored = [],
  showTlsObject = true,
  readOnly,
  showErrors,
}: {
  tls: TlsSettings;
  onTls: (next: TlsSettings) => void;
  verifyOff: boolean;
  onVerifyOff?: (off: boolean) => void;
  isDev: boolean;
  secrets: Record<string, string>;
  onSecret: (kind: string, value: string) => void;
  /** mTLS면 클라이언트 인증서·키 칸 */
  clientCert: boolean;
  stored?: StoredSecret[];
  /** connection.tls(SNI·최소 버전·고정)를 저장할 수 있는 소스인가(MQTT 구독, 스키마에 tls가 있는 커넥터) */
  showTlsObject?: boolean;
  readOnly?: boolean;
  showErrors?: boolean;
}) {
  const { t } = useTranslation();
  const errors = validateTls(tls);
  const find = (kind: string) => stored.find((s) => s.kind === kind);
  const soon = stored.filter((s) => s.certificateExpiresAt && Date.parse(s.certificateExpiresAt) - Date.now() < 30 * 86_400_000);
  const ca = secrets.CA_CERT ?? "";
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {soon.map((s) => (
        <div key={s.kind} className="col-span-full">
          <Alert tone="warning">{t("sources.tls.expiringSoon", { kind: t(`sources.secretKind.${s.kind}`, { defaultValue: s.kind }), at: s.certificateExpiresAt?.slice(0, 10) })}</Alert>
        </div>
      ))}
      {onVerifyOff && (
        <div className="col-span-full flex flex-col gap-1">
          <Checkbox label={t("sources.tls.verify")} checked={!verifyOff} disabled={readOnly} onChange={(e) => onVerifyOff(!e.target.checked)} error={verifyOff && !isDev ? t("sources.validation.tlsDevOnly") : undefined} />
          {verifyOff && <Alert tone="warning">{t("sources.form.tlsInsecureWarn")}</Alert>}
        </div>
      )}
      {showTlsObject && (
        <>
          <SelectField label={t("sources.tls.minVersion")} value={tls.minVersion} disabled={readOnly} onChange={(e) => onTls({ ...tls, minVersion: e.target.value as TlsSettings["minVersion"] })}>
            <option value="">{t("sources.tls.minDefault")}</option>
            <option value="1.2">TLS 1.2</option>
            <option value="1.3">TLS 1.3</option>
          </SelectField>
          <TextField label={t("sources.tls.sni")} value={tls.sni} hint={t("sources.tls.sniHint")} readOnly={readOnly} error={showErrors && errors.sni ? t("sources.tls.error.sni") : undefined} onChange={(e) => onTls({ ...tls, sni: e.target.value })} />
          <fieldset className="col-span-full flex flex-col gap-2 rounded-md border border-line p-3">
            <legend className="px-1 text-[12.5px] font-semibold">{t("sources.tls.pins")}</legend>
            <p className="text-[12px] text-muted">{t("sources.tls.pinsHint")}</p>
            {tls.pinnedSha256.map((pin, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <TextField label={t("sources.tls.pinN", { n: i + 1 })} value={pin} readOnly={readOnly} error={showErrors && errors[`pinnedSha256[${i}]`] ? t("sources.tls.error.pin") : undefined} onChange={(e) => onTls({ ...tls, pinnedSha256: tls.pinnedSha256.map((p, j) => (j === i ? e.target.value : p)) })} />
                </div>
                {!readOnly && (
                  <Button variant="ghost" onClick={() => onTls({ ...tls, pinnedSha256: tls.pinnedSha256.filter((_, j) => j !== i) })}>
                    {t("common.remove")}
                  </Button>
                )}
              </div>
            ))}
            {!readOnly && (
              <div>
                <Button onClick={() => onTls({ ...tls, pinnedSha256: [...tls.pinnedSha256, ""] })} disabled={tls.pinnedSha256.length >= 5}>
                  {t("sources.tls.addPin")}
                </Button>
              </div>
            )}
          </fieldset>
        </>
      )}
      <SecretInput kind="CA_CERT" value={ca} configured={find("CA_CERT")?.configured} fingerprint={find("CA_CERT")?.fingerprint} expiresAt={find("CA_CERT")?.certificateExpiresAt} readOnly={readOnly} error={ca.trim() && pemCount(ca) === 0 ? t("sources.tls.error.pem") : undefined} onChange={(v) => onSecret("CA_CERT", v)} />
      {ca.trim() && pemCount(ca) > 0 && <p className="col-span-full text-[12px] text-muted">{t("sources.tls.caCount", { n: pemCount(ca) })}</p>}
      {clientCert && (
        <>
          <SecretInput kind="CLIENT_CERT" required value={secrets.CLIENT_CERT ?? ""} configured={find("CLIENT_CERT")?.configured} fingerprint={find("CLIENT_CERT")?.fingerprint} expiresAt={find("CLIENT_CERT")?.certificateExpiresAt} readOnly={readOnly} onChange={(v) => onSecret("CLIENT_CERT", v)} />
          <SecretInput kind="CLIENT_KEY" required value={secrets.CLIENT_KEY ?? ""} configured={find("CLIENT_KEY")?.configured} fingerprint={find("CLIENT_KEY")?.fingerprint} readOnly={readOnly} onChange={(v) => onSecret("CLIENT_KEY", v)} />
        </>
      )}
    </div>
  );
}
