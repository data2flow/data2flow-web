/**
 * UI-RUL-11 메신저 계정 연결(RUL-05.02): [연결하기] → 일회용 코드와 봇 딥링크(10분 유효, 남은 시간 표시) → 봇에서 `/start {코드}`.
 * 연결은 텔레그램 쪽에서 끝나므로 [연결 확인]으로 상태를 다시 읽는다. [연결 해제]는 API-RUL-30 DELETE.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Badge, Button } from "~/components/ui";
import { errorText } from "~/lib/error-text";
import { formatDateTime } from "~/lib/format";
import type { LinkStart, MessengerLink as Link, NotifyApi } from "../api";
import { formatCountdown, safeDeepLink, secondsLeft } from "../model/prefs";

export interface MessengerLinkProps {
  channel: string;
  /** 연결 상태. undefined면 확인하지 못함 */
  initial: Link | null | undefined;
  api: Pick<NotifyApi, "startLink" | "unlink" | "links">;
  timezone: string;
  now?: () => number;
}

export function MessengerLinkPanel({ channel, initial, api, timezone, now = Date.now }: MessengerLinkProps) {
  const { t, i18n } = useTranslation();
  const [link, setLink] = useState<Link | null | undefined>(initial);
  const [pending, setPending] = useState<LinkStart | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<{ code: string; message?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) return;
    setLeft(secondsLeft(pending.expiresAt, now()));
    const timer = setInterval(() => {
      const remaining = secondsLeft(pending.expiresAt, now());
      setLeft(remaining);
      if (remaining <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [pending, now]);

  const start = async () => {
    setError(null);
    setNotice(null);
    const result = await api.startLink(channel);
    if (result.ok) setPending(result.data);
    else setError({ code: result.code, message: result.message });
  };

  const refresh = async () => {
    const result = await api.links();
    if (!result.ok) return;
    const found = (result.data?.links ?? []).find((l) => l.channel === channel) ?? null;
    setLink(found);
    if (found) setPending(null);
  };

  const unlink = async () => {
    if (!window.confirm(t("notify.messenger.unlinkConfirm"))) return;
    setError(null);
    const result = await api.unlink(channel);
    if (result.ok) {
      setLink(null);
      setNotice(t("notify.messenger.unlinked"));
    } else setError({ code: result.code, message: result.message });
  };

  const deepLink = safeDeepLink(pending?.deepLink);
  return (
    <div className="flex flex-col gap-3" data-testid="messenger-link">
      <p className="text-[13px] text-muted">{t("notify.messenger.intro")}</p>
      <div className="flex items-center gap-2 text-[13px]">
        <strong>{t(`notify.channel.${channel}`, { defaultValue: channel })}</strong>
        {link === undefined ? <Badge tone="warning">{t("notify.messenger.unknown")}</Badge> : link ? <Badge tone="success">{t("notify.messenger.linked")}</Badge> : <Badge tone="neutral">{t("notify.messenger.notLinked")}</Badge>}
        {link?.linkedAt && <span className="text-muted">{t("notify.messenger.linkedAt", { at: formatDateTime(link.linkedAt, timezone, i18n.language) })}</span>}
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="danger">{errorText(t, error)}</Alert>}
      {pending &&
        (left > 0 ? (
          <div className="rounded-md border border-line p-3 text-[13px]">
            <p>{t("notify.messenger.steps", { code: pending.code })}</p>
            <p className="my-2">
              {t("notify.messenger.code")}: <code className="font-mono text-[15px] font-semibold">{pending.code}</code> · <span className="text-muted">{t("notify.messenger.expiresIn", { time: formatCountdown(left) })}</span>
            </p>
            <div className="flex gap-2">
              {deepLink && (
                <a href={deepLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-md border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-white">
                  {t("notify.messenger.openBot")}
                </a>
              )}
              <Button onClick={() => void refresh()}>{t("notify.messenger.checkStatus")}</Button>
            </div>
          </div>
        ) : (
          <Alert tone="warning">{t("notify.messenger.expired")}</Alert>
        ))}
      <div className="flex gap-2">
        {link ? (
          <Button variant="danger" onClick={() => void unlink()}>
            {t("notify.messenger.unlink")}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void start()}>
            {pending && left <= 0 ? t("notify.messenger.renew") : pending ? t("notify.messenger.relink") : t("notify.messenger.link")}
          </Button>
        )}
      </div>
    </div>
  );
}
