/**
 * 설치 현황판(UI-DEV-22, DEV-13.06, API-DEV-138): 사이트 선택, 층별 표(예정·완료·첫 수신 확인·문제), 진행률 막대,
 * 칸을 누르면 그 상태의 기기 목록과 체크리스트(AT-DEV-28.3). 실시간: `space:{사이트}` 토픽의 `commissioning` 이벤트(AT-DEV-28.2)를 받으면 숫자를 다시 읽는다.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { LiveDot, useLiveStream, type UseLiveStreamOptions } from "~/components/live";
import { Alert, Card, EmptyState, SelectField, StatusDot, Table } from "~/components/ui";
import { liveUrl } from "~/lib/event-stream";
import { formatDateTime } from "~/lib/format";
import { fieldApi, type FieldApi } from "../api";
import { CHECKLIST_KEYS, boardTotals, checkLabelSelection, commissionTone, floorProgress, type BoardDevice, type BoardFloor } from "../model/commissioning";

export const BOARD_REFRESH_DEBOUNCE_MS = 500;

export interface InstallationBoardProps {
  sites: { id: string; name: string }[];
  siteId: string | null;
  initial: BoardFloor[];
  failed?: boolean;
  timezone: string;
  api?: FieldApi;
  live?: UseLiveStreamOptions;
  /** 라벨 PDF 인쇄 권한(DEV_PLACE) */
  canPrint?: boolean;
  save?: (blob: Blob, fileName: string) => void;
}

type Cell = { floor: BoardFloor; status: "PLANNED" | "INSTALLED" | "VERIFIED" | "PROBLEM" };

export function InstallationBoard({ sites, siteId, initial, failed = false, timezone, api = fieldApi, live, canPrint = false, save }: InstallationBoardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [floors, setFloors] = useState(initial);
  const [cell, setCell] = useState<Cell | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shown, setShown] = useState(initial);
  if (shown !== initial) {
    setShown(initial);
    setFloors(initial);
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const refresh = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void api.board(siteId).then((result) => {
        if (result.ok) setFloors(result.data.floors ?? []);
      });
    }, BOARD_REFRESH_DEBOUNCE_MS);
  };
  const status = useLiveStream(siteId ? liveUrl([`space:${siteId}`]) : null, ["commissioning"], refresh, live);
  const totals = boardTotals(floors);
  const cellButton = (floor: BoardFloor, key: Cell["status"], value: number) => (
    <button type="button" className="min-h-9 min-w-9 font-mono text-accent hover:underline disabled:text-muted disabled:no-underline" disabled={value === 0} aria-label={t("field.board.cellLabel", { floor: floor.name, status: t(`field.commission.status.${key}`), count: value })} onClick={() => setCell({ floor, status: key })}>
      {value}
    </button>
  );
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SelectField label={t("field.board.site")} value={siteId ?? ""} onChange={(e) => navigate(`?siteId=${encodeURIComponent(e.target.value)}`)}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <LiveDot status={status} />
        </div>
      </Card>
      {failed && <Alert tone="warning">{t("field.loadFailed")}</Alert>}
      <Card title={t("field.board.title")}>
        {floors.length === 0 ? (
          <EmptyState title={t("field.board.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{t("field.board.floor")}</th>
                <th>{t("field.board.planned")}</th>
                <th>{t("field.board.installed")}</th>
                <th>{t("field.board.verified")}</th>
                <th>{t("field.board.problem")}</th>
                <th>{t("field.board.progress")}</th>
              </tr>
            </thead>
            <tbody>
              {floors.map((f) => (
                <tr key={f.spaceId} data-testid={`floor-${f.spaceId}`}>
                  <td>{f.name}</td>
                  <td>{cellButton(f, "PLANNED", f.planned)}</td>
                  <td>{cellButton(f, "INSTALLED", f.installed)}</td>
                  <td>{cellButton(f, "VERIFIED", f.verified)}</td>
                  <td>{cellButton(f, "PROBLEM", f.problem)}</td>
                  <td>
                    <progress max={100} value={floorProgress(f)} aria-label={t("field.board.progressOf", { floor: f.name })} /> <span className="font-mono text-[12px]">{`${floorProgress(f)}%`}</span>
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td>{t("field.board.total")}</td>
                <td className="font-mono">{totals.planned}</td>
                <td className="font-mono">{totals.installed}</td>
                <td className="font-mono">{totals.verified}</td>
                <td className="font-mono">{totals.problem}</td>
                <td />
              </tr>
            </tbody>
          </Table>
        )}
      </Card>
      {cell && <BoardDrawer cell={cell} api={api} timezone={timezone} canPrint={canPrint} save={save} onClose={() => setCell(null)} />}
    </div>
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function BoardDrawer({ cell, api, timezone, canPrint, save = downloadBlob, onClose }: { cell: Cell; api: FieldApi; timezone: string; canPrint: boolean; save?: (blob: Blob, fileName: string) => void; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [devices, setDevices] = useState<BoardDevice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const print = async () => {
    const ids = (devices ?? []).map((d) => d.deviceId);
    const invalid = checkLabelSelection(ids);
    if (invalid) return setPrintError(t(`field.qr.labels.${invalid}`));
    const result = await api.qrLabels(ids, "A4_3x8");
    if (result.ok) {
      setPrintError(null);
      save(result.blob, result.fileName);
    } else setPrintError(t(`errors.${result.code}`, { defaultValue: t("errors.UNKNOWN") }));
  };
  useEffect(() => {
    let alive = true;
    setDevices(null);
    void api.boardDevices(cell.floor.spaceId, cell.status).then((result) => {
      if (!alive) return;
      if (result.ok) setDevices(result.data.responses ?? []);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [api, cell]);
  return (
    <aside aria-label={t("field.board.drawer", { floor: cell.floor.name, status: t(`field.commission.status.${cell.status}`) })} className="rounded-lg border border-line bg-panel p-4">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-[14px] font-semibold">{t("field.board.drawer", { floor: cell.floor.name, status: t(`field.commission.status.${cell.status}`) })}</h2>
        <div className="flex gap-3">
          {canPrint && devices && devices.length > 0 && (
            <button type="button" className="text-[13px] text-accent hover:underline" onClick={() => void print()}>
              {t("field.qr.printList", { count: devices.length })}
            </button>
          )}
          <button type="button" className="text-[13px] text-muted" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </header>
      {printError && <Alert tone="danger">{printError}</Alert>}
      {failed && <Alert tone="warning">{t("field.loadFailed")}</Alert>}
      {devices === null && !failed && <p className="text-[13px] text-muted">{t("common.loading")}</p>}
      {devices && devices.length === 0 && <p className="text-[13px] text-muted">{t("field.board.noDevices")}</p>}
      {devices && devices.length > 0 && (
        <ul className="flex flex-col gap-3">
          {devices.map((d) => (
            <li key={d.deviceId} className="border-b border-line pb-2 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/devices/${encodeURIComponent(d.deviceId)}`} className="font-semibold text-accent hover:underline">
                  {d.name}
                </Link>
                <StatusDot tone={commissionTone(d.status)} label={t(`field.commission.status.${d.status}`, { defaultValue: d.status })} />
                {d.installedAt && <span className="text-[12px] text-muted">{formatDateTime(d.installedAt, timezone, i18n.language)}</span>}
              </div>
              {d.checklist && (
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
                  {CHECKLIST_KEYS.filter((k) => k in (d.checklist ?? {})).map((k) => (
                    <li key={k}>{`${d.checklist?.[k] ? "✓" : "✗"} ${t(`field.commission.check.${k}`)}`}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
