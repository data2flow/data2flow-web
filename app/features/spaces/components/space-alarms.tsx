/**
 * 공간 보기 알람 탭(UI-DSH-02, DSH-02.01): 공간 하위 열린 알람 목록(API-RUL-10)을 `alarms` 토픽(API-DSH-20)으로 갱신하고,
 * 기기 카드의 열린 알람 배지를 그린다. 알람 처리(확인·해제)는 알람 상세(UI-RUL-05)에서 한다.
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { LiveBanner, useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { Badge, Card, EmptyState, Table } from "~/components/ui";
import { liveUrl } from "~/lib/event-stream";
import { formatDateTime } from "~/lib/format";
import { applyAlarmEvent, severityTone, sortAlarms, type AlarmEvent, type SpaceAlarm } from "../model/space-alarms";

export function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useTranslation();
  const { tone, icon } = severityTone(severity);
  return (
    <Badge tone={tone}>
      <span aria-hidden>{icon} </span>
      {t(`spaces.alarms.severity.${severity}`, { defaultValue: severity })}
    </Badge>
  );
}

/** 기기 카드의 열린 알람 배지(수 + 가장 높은 심각도) */
export function DeviceAlarmBadge({ count, worst }: { count: number; worst: string }) {
  const { t } = useTranslation();
  const { tone, icon } = severityTone(worst);
  return (
    <Badge tone={tone}>
      <span aria-hidden>{icon} </span>
      {t("spaces.alarms.openN", { n: count })}
    </Badge>
  );
}

export function SpaceAlarms({
  initial,
  spaceIds,
  failed,
  timezone,
  lang,
  streamOptions,
  now = () => new Date().toISOString(),
}: {
  initial: SpaceAlarm[];
  spaceIds: string[];
  failed?: boolean;
  timezone: string;
  lang: string;
  streamOptions?: UseLiveStreamOptions;
  now?: () => string;
}) {
  const { t } = useTranslation();
  const [alarms, setAlarms] = useState(() => sortAlarms(initial));
  const scope = useMemo(() => new Set(spaceIds), [spaceIds]);
  const onEvent = useCallback((event: { data: unknown }) => setAlarms((current) => applyAlarmEvent(current, event.data as AlarmEvent, scope, now())), [scope, now]);
  const status = useLiveStream(failed ? null : liveUrl(["alarms"]), ["alarm"], onEvent, streamOptions);
  if (failed) return <EmptyState title={t("spaces.alarms.failed")} />;
  return (
    <div className="flex flex-col gap-2">
      <LiveBanner status={status} />
      <Card actions={<Link className="text-[12.5px] text-accent" to={`/alarms?spaceId=${encodeURIComponent(spaceIds[0] ?? "")}`}>{t("spaces.alarms.openList")}</Link>}>
        {alarms.length === 0 ? (
          <p className="text-[13px] text-muted">{t("spaces.alarms.empty")}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">{t("spaces.alarms.severityCol")}</th>
                <th scope="col">{t("spaces.alarms.title")}</th>
                <th scope="col">{t("spaces.alarms.device")}</th>
                <th scope="col">{t("spaces.alarms.status")}</th>
                <th scope="col">{t("spaces.alarms.raisedAt")}</th>
              </tr>
            </thead>
            <tbody>
              {alarms.map((a) => (
                <tr key={a.id} data-alarm={a.id}>
                  <td>
                    <SeverityBadge severity={a.severity} />
                  </td>
                  <td>
                    <Link to={`/alarms/${encodeURIComponent(a.id)}`} className="text-accent hover:underline">
                      {a.title}
                    </Link>
                    {a.flapping && <span className="ml-1 text-[12px] text-warn">{t("spaces.alarms.flapping")}</span>}
                  </td>
                  <td>{a.device ? <Link to={`/devices/${encodeURIComponent(a.device.id)}`} className="hover:underline">{a.device.name ?? a.device.id}</Link> : "–"}</td>
                  <td>{t(`spaces.alarms.state.${a.status}`, { defaultValue: a.status })}</td>
                  <td className="font-mono text-[12px]">{formatDateTime(a.lastRaisedAt ?? a.raisedAt ?? undefined, timezone, lang)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
