/**
 * 플랫폼 브로커 자격증명(UI-DSC-06, DSC-03.02, DSC-03.05, ADR-029·031). 기기 상세 `?tab=credentials`에 넣는다.
 * - 목록(API-DSC-21), 발급(API-DSC-20: 비밀번호·서명 키는 한 번만 보여 주고 닫으면 다시 볼 수 없음), 폐기(API-DSC-22)
 * - 발급·폐기 버튼은 SRC_ADMIN(INTEGRATOR 이상)만. 그 밖에는 접속 정보만(TC-DSC-112)
 * 접속 주소는 기존 공용 브로커 `wss://iot-data.java21.net/mqtt`(API-DSC-23). 인증서 방식은 없다(ADR-029).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Table, TextField } from "~/components/ui";
import { bffJson, clientIdempotencyKey } from "~/lib/bff-client";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";

export interface Credential {
  id: string;
  type: string;
  username: string;
  status: "ACTIVE" | "REVOKED" | string;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
}

export interface BrokerInfo {
  wssUrl: string;
  auth?: string;
  signing?: string;
  topicRules?: string[];
}

export interface IssuedCredential {
  credentialId: string;
  username: string;
  password: string;
  signingKey?: string;
}

/** 접속 예시 명령(발급 결과 화면) */
export function publishExample(broker: BrokerInfo | null, issued: IssuedCredential, topic: string): string {
  const url = broker?.wssUrl ?? "wss://iot-data.java21.net/mqtt";
  return `mosquitto_pub -L ${url} -u ${issued.username} -P '${issued.password}' -t '${topic}' -m '{"temperature":22.4}'`;
}

export function DeviceCredentialsPanel({ deviceId, externalId, canAdmin, timezone, lang = "ko" }: { deviceId: string; externalId: string; canAdmin: boolean; timezone: string; lang?: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Credential[] | null>(null);
  const [broker, setBroker] = useState<BrokerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [issued, setIssued] = useState<IssuedCredential | null>(null);
  const [revoking, setRevoking] = useState<Credential | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/bff/api/core/devices/${encodeURIComponent(deviceId)}/credentials`;
  const topic = broker?.topicRules?.[0]?.replace("{deviceKey}", externalId) ?? `devices/${externalId}/telemetry`;

  const load = useCallback(async () => {
    const [list, info] = await Promise.all([bffJson<Credential[] | { responses: Credential[] }>(base), bffJson<BrokerInfo>("/bff/api/core/platform-broker")]);
    if (list.ok) setItems(Array.isArray(list.data) ? list.data : (list.data?.responses ?? []));
    else setError(errorText(t, list) ?? null);
    if (info.ok) setBroker(info.data);
  }, [base, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function issue() {
    setBusy(true);
    const body: Record<string, unknown> = { type: "PASSWORD" };
    if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString();
    const result = await bffJson<IssuedCredential>(base, { method: "POST", body, idempotencyKey: clientIdempotencyKey() });
    setBusy(false);
    setIssueOpen(false);
    if (result.ok) {
      setIssued(result.data);
      await load();
    } else setError(errorText(t, result) ?? null);
  }

  async function revoke(item: Credential) {
    setBusy(true);
    const result = await bffJson(`${base}/${encodeURIComponent(item.id)}/revoke`, { method: "POST", body: {} });
    setBusy(false);
    setRevoking(null);
    if (result.ok) await load();
    else setError(errorText(t, result) ?? null);
  }

  return (
    <Card
      title={t("sources.credentials.title")}
      actions={
        canAdmin && (
          <Button variant="primary" onClick={() => setIssueOpen(true)}>
            {t("sources.credentials.issue")}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px]">
          {t("sources.credentials.endpoint")}: <span className="font-mono">{broker?.wssUrl ?? "wss://iot-data.java21.net/mqtt"}</span> · {t("sources.credentials.topic")}: <span className="font-mono">{topic}</span>
        </p>
        {error && <Alert tone="danger">{error}</Alert>}
        {issued && (
          <Alert tone="warning">
            <p className="font-semibold">{t("sources.credentials.onceTitle")}</p>
            <p>
              {t("sources.credentials.username")}: <span className="font-mono">{issued.username}</span>
            </p>
            <p>
              {t("sources.credentials.password")}: <span className="font-mono">{issued.password}</span>
            </p>
            {issued.signingKey && (
              <p>
                {t("sources.credentials.signingKey")}: <span className="font-mono">{issued.signingKey}</span>
              </p>
            )}
            <pre className="mt-1 whitespace-pre-wrap font-mono text-[12px]">{publishExample(broker, issued, topic)}</pre>
            <Button className="mt-2" onClick={() => setIssued(null)}>
              {t("sources.credentials.closeOnce")}
            </Button>
          </Alert>
        )}
        {items === null ? (
          <p className="text-[13px] text-muted">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          <EmptyState title={t("sources.credentials.empty")} body={canAdmin ? t("sources.credentials.emptyBody") : t("sources.credentials.askAdmin")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">{t("sources.credentials.type")}</th>
                <th scope="col">{t("sources.credentials.username")}</th>
                <th scope="col">{t("sources.credentials.status")}</th>
                <th scope="col">{t("sources.credentials.expiresAt")}</th>
                <th scope="col">{t("sources.credentials.lastUsedAt")}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>{c.type}</td>
                  <td className="font-mono">{c.username}</td>
                  <td>
                    <Badge tone={c.status === "ACTIVE" ? "success" : "neutral"}>{t(`sources.credentials.state.${c.status}`, { defaultValue: c.status })}</Badge>
                  </td>
                  <td>{c.expiresAt ? formatDateTime(c.expiresAt, timezone, lang) : t("sources.credentials.noExpiry")}</td>
                  <td>{formatDateTime(c.lastUsedAt, timezone, lang)}</td>
                  <td>
                    {canAdmin && c.status === "ACTIVE" && (
                      <Button variant="danger" onClick={() => setRevoking(c)}>
                        {t("sources.credentials.revoke")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
      <Dialog
        title={t("sources.credentials.issueTitle")}
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        footer={
          <Button variant="primary" onClick={issue} disabled={busy}>
            {t("sources.credentials.issue")}
          </Button>
        }
      >
        <p className="text-[13px]">{t("sources.credentials.issueBody")}</p>
        <TextField label={t("sources.credentials.expiresAtOptional")} type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
      </Dialog>
      <Dialog
        title={t("sources.credentials.revokeTitle")}
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        footer={
          <Button variant="danger" onClick={() => revoking && revoke(revoking)} disabled={busy}>
            {t("sources.credentials.revoke")}
          </Button>
        }
      >
        <p className="text-[13px]">{t("sources.credentials.revokeBody", { username: revoking?.username ?? "" })}</p>
      </Dialog>
    </Card>
  );
}
