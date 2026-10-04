/**
 * Webhook 수신 소스를 만든 직후 1회 표시(DSC-01.03, TC-DSC-023): 수신 URL(`https://data2flow-hook.java21.net/…`)과 서버가 만든
 * HMAC 서명 비밀값. 비밀값은 이 화면에서만 보이고, 다시 열면 끝 4자리 지문만 보인다. 서명 방법과 curl 예시를 함께 보여 준다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, ButtonLink, Card } from "~/components/ui";

export function curlExample(url: string): string {
  return [
    "TS=$(date +%s)",
    `BODY='{"deviceId":"sensor-01","temperature":22.5}'`,
    'SIG=$(printf "%s.%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$HMAC_KEY" -hex | cut -d" " -f2)',
    `curl -X POST '${url}' -H "Content-Type: application/json" -H "X-D2F-Timestamp: $TS" -H "X-D2F-Signature: $SIG" -H "X-D2F-Request-Id: $(uuidgen)" -d "$BODY"`,
  ].join("\n");
}

export function WebhookCreated({ sourceId, webhookUrl, secret }: { sourceId: string; webhookUrl: string | null; secret: { kind: string; value: string } | null }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(null);
    }
  }
  return (
    <Card title={t("sources.webhook.createdTitle")}>
      <div className="flex flex-col gap-3 text-[13px]">
        <Alert tone="warning">{t("sources.webhook.once")}</Alert>
        <div>
          <p className="text-[12px] text-muted">{t("sources.webhook.url")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all font-mono">{webhookUrl ?? "–"}</code>
            {webhookUrl && (
              <Button variant="ghost" onClick={() => copy("url", webhookUrl)}>
                {copied === "url" ? t("sources.webhook.copied") : t("sources.webhook.copyUrl")}
              </Button>
            )}
          </div>
        </div>
        {secret && (
          <div>
            <p className="text-[12px] text-muted">{t("sources.webhook.secret")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all font-mono" data-testid="issued-secret">
                {secret.value}
              </code>
              <Button variant="ghost" onClick={() => copy("secret", secret.value)}>
                {copied === "secret" ? t("sources.webhook.copied") : t("sources.webhook.copySecret")}
              </Button>
            </div>
          </div>
        )}
        <p className="text-[12px] text-muted">{t("sources.webhook.signing")}</p>
        {webhookUrl && <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[12px]">{curlExample(webhookUrl)}</pre>}
        <div>
          <ButtonLink to={`/sources/${encodeURIComponent(sourceId)}?tab=settings`} variant="primary">
            {t("sources.webhook.toDetail")}
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}
