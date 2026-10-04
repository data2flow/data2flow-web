/**
 * 공유 링크 관리(DSH-06.03, API-DSH-10): 만료 1~90일로 만들기(주소는 이때 한 번만 보임), 목록(상태·만료·마지막 사용), 폐기.
 * 폐기한 링크는 60초 안에 막힌다(core 캐시 TTL ≤ 60초, TC-DSH-067).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button, Dialog, Table, TextField } from "~/components/ui";
import { formatDateTime } from "~/lib/format";
import { dashboardsApi } from "../api";
import { SHARE_MAX_DAYS, SHARE_MIN_DAYS, shareDaysValid, shareLinkStatus } from "../model/transfer";
import type { ShareLink } from "../model/types";

export function ShareLinksDialog({ dashboardId, open, onClose, timezone, now = () => Date.now(), api = dashboardsApi }: { dashboardId: string; open: boolean; onClose: () => void; timezone: string; now?: () => number; api?: Pick<typeof dashboardsApi, "shareLinks" | "createShareLink" | "revokeShareLink"> }) {
  const { t, i18n } = useTranslation();
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [days, setDays] = useState("7");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void api.shareLinks(dashboardId).then((r) => {
      if (alive && r.ok) setLinks(r.data ?? []);
      if (alive && !r.ok) setError(t("dashboards.share.loadFailed"));
    });
    return () => {
      alive = false;
    };
  }, [open, dashboardId, api, t]);

  const create = async () => {
    const n = Number(days);
    if (!shareDaysValid(n)) {
      setError(t("dashboards.share.daysInvalid", { min: SHARE_MIN_DAYS, max: SHARE_MAX_DAYS }));
      return;
    }
    setError(null);
    const r = await api.createShareLink(dashboardId, n);
    if (!r.ok) {
      setError(r.message || t("dashboards.share.createFailed"));
      return;
    }
    setCreated(r.data.url);
    setCopied(false);
    setLinks((list) => [{ id: r.data.id, expiresAt: r.data.expiresAt, revokedAt: null, lastUsedAt: null, createdAt: new Date(now()).toISOString() }, ...list]);
  };

  const revoke = async (id: string) => {
    const r = await api.revokeShareLink(dashboardId, id);
    if (r.ok) setLinks((list) => list.map((l) => (l.id === id ? { ...l, revokedAt: new Date(now()).toISOString() } : l)));
    else setError(r.message || t("dashboards.share.revokeFailed"));
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("dashboards.share.title")}>
      <p className="text-[13px] text-muted">{t("dashboards.share.help")}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex items-end gap-2">
        <TextField label={t("dashboards.share.days", { min: SHARE_MIN_DAYS, max: SHARE_MAX_DAYS })} type="number" min={SHARE_MIN_DAYS} max={SHARE_MAX_DAYS} value={days} onChange={(e) => setDays(e.target.value)} />
        <Button variant="primary" onClick={() => void create()}>
          {t("dashboards.share.create")}
        </Button>
      </div>
      {created && (
        <Alert tone="success">
          <p>{t("dashboards.share.once")}</p>
          <p className="break-all font-mono" data-testid="share-url">
            {created}
          </p>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(created);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? t("dashboards.table.copied") : t("dashboards.share.copy")}
          </Button>
        </Alert>
      )}
      <Table>
        <thead>
          <tr>
            <th scope="col">{t("dashboards.share.status")}</th>
            <th scope="col">{t("dashboards.share.expiresAt")}</th>
            <th scope="col">{t("dashboards.share.lastUsedAt")}</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {links.map((link) => {
            const status = shareLinkStatus(link, now());
            return (
              <tr key={link.id}>
                <td>
                  <Badge tone={status === "ACTIVE" ? "success" : "neutral"}>
                    {status === "ACTIVE" ? "✔" : "–"} {t(`dashboards.share.statuses.${status}`)}
                  </Badge>
                </td>
                <td>{formatDateTime(link.expiresAt, timezone, i18n.language)}</td>
                <td>{link.lastUsedAt ? formatDateTime(link.lastUsedAt, timezone, i18n.language) : "–"}</td>
                <td>
                  {status === "ACTIVE" && (
                    <Button variant="danger" onClick={() => void revoke(link.id)}>
                      {t("dashboards.share.revoke")}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
          {links.length === 0 && (
            <tr>
              <td colSpan={4} className="text-muted">
                {t("dashboards.share.empty")}
              </td>
            </tr>
          )}
        </tbody>
      </Table>
    </Dialog>
  );
}
