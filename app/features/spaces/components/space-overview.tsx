/**
 * 공간 보기 개요(UI-DSH-02): 쾌적도 배지와 원인, 기기 카드(현재값 2~4개, 상태, 마지막 수신, 배터리, 신호)를
 * `space:{id}` 실시간 구독으로 갱신, 하위 공간 카드.
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { LiveBanner, LiveDot, useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { Badge, Card, EmptyState, StatusDot, Term } from "~/components/ui";
import { liveUrl } from "~/lib/event-stream";
import { formatNumber, formatRelative } from "~/lib/format";
import { comfortTone, causeText, type ComfortCause } from "../../home/model/home";
import { applyDeviceUpdate, type DeviceUpdate, type OverviewDevice } from "../model/live-devices";

export function ComfortBadge({ state }: { state?: string | null }) {
  const { t } = useTranslation();
  const value = state ?? "UNKNOWN";
  const { tone, icon } = comfortTone(value);
  return (
    <Badge tone={tone}>
      <Term term="comfort">
        <span aria-hidden>{icon} </span>
        {t(`status.comfort.${value}`, { defaultValue: value })}
      </Term>
    </Badge>
  );
}

export function ComfortCauses({ causes }: { causes?: ComfortCause[] }) {
  if (!causes?.length) return null;
  return <span className="font-mono text-[12.5px]">{causes.map(causeText).join(" · ")}</span>;
}

const CONNECTION_TONE: Record<string, "good" | "bad" | "warn" | "muted"> = { ONLINE: "good", OFFLINE: "bad", UNKNOWN: "warn" };

export function DeviceCards({ spaceId, devices: initial, now, lang, streamOptions }: { spaceId: string; devices: OverviewDevice[]; now: number; lang: string; streamOptions?: UseLiveStreamOptions }) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState(initial);
  const onEvent = useCallback((event: { data: unknown }) => setDevices((current) => applyDeviceUpdate(current, event.data as DeviceUpdate)), []);
  const status = useLiveStream(devices.length ? liveUrl([`space:${spaceId}`]) : null, ["device-update"], onEvent, streamOptions);
  if (devices.length === 0) {
    return <EmptyState title={t("spaces.overview.noDevices")} action={<Link className="text-accent underline" to="/devices/pending">{t("spaces.overview.placeDevices")}</Link>} />;
  }
  return (
    <div className="flex flex-col gap-2">
      <LiveBanner status={status} />
      <div className="flex justify-end">
        <LiveDot status={status} />
      </div>
      <ul className="grid gap-3 md:grid-cols-3">
        {devices.map((d) => (
          <li key={d.id}>
            <Card>
              <div className="flex items-center justify-between gap-2">
                <Link to={`/devices/${d.id}`} className="font-semibold text-accent hover:underline">
                  {d.name}
                </Link>
                <StatusDot tone={CONNECTION_TONE[d.connection ?? "UNKNOWN"] ?? "muted"} label={t(`status.connectivity.${d.connection ?? "UNKNOWN"}`, { defaultValue: d.connection ?? "" })} />
              </div>
              <p className="text-[12px] text-muted">{d.modelName ?? "–"}</p>
              <dl className="mt-2 grid grid-cols-2 gap-1">
                {(d.metrics ?? []).slice(0, 4).map((m) => (
                  <div key={m.key}>
                    <dt className="text-[11px] text-muted">{m.key}</dt>
                    <dd className="font-mono text-[15px]" data-metric={`${d.id}.${m.key}`}>
                      {formatNumber(m.value, lang, { unit: m.unit })}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[12px] text-muted">
                {t("spaces.overview.lastSeen", { at: formatRelative(d.lastSeenAt, now, lang) })}
                {d.battery !== null && d.battery !== undefined ? ` · ${t("spaces.overview.battery", { n: d.battery })}` : ""}
                {d.rssi !== null && d.rssi !== undefined ? ` · ${d.rssi}dBm` : ""}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChildSpaces({ children }: { children: { id: string; name: string; type: string }[] }) {
  const { t } = useTranslation();
  if (children.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted">{t("spaces.overview.children")}</h3>
      <ul className="flex flex-wrap gap-2">
        {children.map((c) => (
          <li key={c.id}>
            <Link to={`/spaces/${c.id}`} className="inline-flex rounded-md border border-line px-2 py-1 text-[13px] hover:bg-bg">
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
