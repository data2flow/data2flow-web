/**
 * 평면도(UI-DEV-03 편집, UI-DSH-02 보기): 이미지 위 마커(현재값 라벨), 편집 모드에서 배치 안 된 기기를 고르고
 * 이미지를 눌러 비율 좌표(0~1)로 놓는다. 저장은 마커 전체 교체(API-DEV-10).
 * 끌어 놓기 대신 "고르고 누르기"로 배치한다(키보드로도 쓸 수 있게).
 */
import { useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Button, Card, CsrfField, EmptyState, cx } from "~/components/ui";
import { checkFloorplanFile, ratioFromClick, browserImageUrl } from "../model/space-forms";
import type { FormResult } from "./space-manage";

export interface FloorplanMarker {
  deviceId: string;
  deviceName?: string;
  x: number;
  y: number;
  metrics?: { key: string; value: number | null; unit?: string | null }[];
  state?: string;
}

export interface FloorplanView {
  imageUrl?: string | null;
  width?: number;
  height?: number;
  markers?: FloorplanMarker[];
}

export function FloorplanUpload({ result }: { result?: FormResult }) {
  const { t } = useTranslation();
  const [invalid, setInvalid] = useState(false);
  const failed = result?.intent === "floorplan" && !result.ok;
  return (
    <Form method="post" encType="multipart/form-data" className="flex flex-wrap items-end gap-2">
      <CsrfField />
      <input type="hidden" name="intent" value="floorplan" />
      <label className="flex flex-col gap-1 text-[12.5px] text-muted">
        {t("spaces.floorplan.file")}
        <input
          type="file"
          name="file"
          accept="image/png,image/jpeg,image/svg+xml"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setInvalid(Boolean(file) && !checkFloorplanFile({ type: file!.type, size: file!.size }));
          }}
        />
      </label>
      <Button type="submit" variant="primary" disabled={invalid}>
        {t("spaces.floorplan.upload")}
      </Button>
      {(invalid || failed) && (
        <p role="alert" className="w-full text-[12px] text-bad">
          {t("errors.FLOORPLAN_IMAGE_INVALID")}
        </p>
      )}
    </Form>
  );
}

export function FloorplanPanel({ view, devices, canEdit, result }: { view: FloorplanView | null; devices: { id: string; name: string }[]; canEdit: boolean; result?: FormResult }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [markers, setMarkers] = useState<FloorplanMarker[]>(view?.markers ?? []);
  const [picked, setPicked] = useState<string | null>(null);
  const image = useRef<HTMLDivElement>(null);
  if (!view?.imageUrl) {
    return (
      <EmptyState title={t("spaces.floorplan.empty")} action={canEdit ? <FloorplanUpload result={result} /> : undefined}>
        {!canEdit && <p className="text-[12px] text-muted">{t("spaces.floorplan.askAdmin")}</p>}
      </EmptyState>
    );
  }
  const placed = new Set(markers.map((m) => m.deviceId));
  const unplaced = devices.filter((d) => !placed.has(d.id));
  const place = (event: MouseEvent<HTMLDivElement>) => {
    if (!editing || !picked || !image.current) return;
    const { x, y } = ratioFromClick(event.clientX, event.clientY, image.current.getBoundingClientRect());
    const name = devices.find((d) => d.id === picked)?.name;
    setMarkers((current) => [...current.filter((m) => m.deviceId !== picked), { deviceId: picked, deviceName: name, x, y }]);
    setPicked(null);
  };
  return (
    <Card
      title={t("spaces.tab.floorplan")}
      actions={
        canEdit && (
          <Button onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
            {editing ? t("spaces.floorplan.viewMode") : t("spaces.floorplan.editMode")}
          </Button>
        )
      }
    >
      <div className="flex gap-3">
        {editing && (
          <aside className="w-44 shrink-0">
            <h3 className="mb-1 text-[12px] font-semibold text-muted">{t("spaces.floorplan.unplaced")}</h3>
            <ul className="flex flex-col gap-1">
              {unplaced.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => setPicked(d.id)} aria-pressed={picked === d.id} className={cx("w-full rounded border px-2 py-1 text-left text-[12.5px]", picked === d.id ? "border-accent bg-accent-soft" : "border-line")}>
                    {d.name}
                  </button>
                </li>
              ))}
              {unplaced.length === 0 && <li className="text-[12px] text-muted">{t("spaces.floorplan.allPlaced")}</li>}
            </ul>
            {picked && <p className="mt-2 text-[12px] text-accent">{t("spaces.floorplan.clickToPlace")}</p>}
          </aside>
        )}
        <div ref={image} role="presentation" onClick={place} data-testid="floorplan-image" className={cx("relative flex-1 overflow-hidden rounded border border-line", editing && picked && "cursor-crosshair")}>
          <img src={browserImageUrl(view.imageUrl) ?? undefined} alt={t("spaces.floorplan.alt")} className="block w-full" />
          {markers.map((m) => (
            <span key={m.deviceId} className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-panel/90 px-1.5 py-0.5 text-[11.5px] shadow" style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}>
              {m.deviceName ?? m.deviceId}
              {m.metrics?.[0] && <span className="ml-1 font-mono">{`${m.metrics[0].value ?? "–"}${m.metrics[0].unit ?? ""}`}</span>}
              {editing && (
                <button type="button" className="ml-1 text-bad" aria-label={t("spaces.floorplan.removeMarker", { name: m.deviceName ?? m.deviceId })} onClick={(e) => { e.stopPropagation(); setMarkers((c) => c.filter((x) => x.deviceId !== m.deviceId)); }}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      </div>
      {editing && (
        <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
          <FloorplanUpload result={result} />
          <Form method="post">
            <CsrfField />
            <input type="hidden" name="intent" value="markers" />
            <input type="hidden" name="markers" value={JSON.stringify(markers.map((m) => ({ deviceId: m.deviceId, x: m.x, y: m.y })))} />
            <Button type="submit" variant="primary">
              {t("common.save")}
            </Button>
          </Form>
        </div>
      )}
      {(result?.intent === "markers" || result?.intent === "floorplan") && result.ok && <p role="status" className="mt-2 text-[12.5px] text-good">{t("common.saved")}</p>}
      {!editing && (result?.intent === "markers" || result?.intent === "floorplan") && result.error && (
        <p role="alert" className="mt-2 text-[12.5px] text-bad">
          {t(`errors.${result.error.code}`, { defaultValue: t("errors.UNKNOWN") })}
        </p>
      )}
    </Card>
  );
}
