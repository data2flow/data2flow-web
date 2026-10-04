/**
 * UI-RUL-09 당직 일정 부품(RUL-05.03): 주간 달력(시간대 × 요일), 근무표 편집기(행 추가·삭제 → 숨은 입력 `shifts` JSON).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Table } from "~/components/ui";
import { DAYS, shiftGrid } from "../model/oncall";
import type { OnCallShift } from "../model/types";

const nameOf = (shift: OnCallShift | undefined, users: { id: string; name: string }[]) => (shift ? shift.userName || users.find((u) => u.id === shift.userId)?.name || shift.userId : "–");

export function WeekGrid({ shifts, users }: { shifts: OnCallShift[]; users: { id: string; name: string }[] }) {
  const { t } = useTranslation();
  const grid = shiftGrid(shifts);
  if (grid.bands.length === 0) return <p className="text-[13px] text-muted">{t("notify.onCall.emptyWeek")}</p>;
  return (
    <Table>
      <thead>
        <tr>
          <th>{t("notify.onCall.band")}</th>
          {DAYS.map((d) => (
            <th key={d}>{t(`notify.days.${d}`)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.bands.map((band) => (
          <tr key={`${band.from}-${band.to}`}>
            <td className="font-mono">{`${band.from}–${band.to}`}</td>
            {DAYS.map((d) => (
              <td key={d}>{nameOf(band.cells[d], users)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

const inputClass = "rounded-md border border-line bg-panel px-2 py-1 text-[13px] text-text";

export function ShiftEditor({ initial, users, usersAvailable }: { initial: OnCallShift[]; users: { id: string; name: string }[]; usersAvailable: boolean }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<OnCallShift[]>(initial);
  const update = (index: number, patch: Partial<OnCallShift>) => setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="shifts" value={JSON.stringify(rows.map(({ dayOfWeek, from, to, userId }) => ({ dayOfWeek, from, to, userId })))} />
      <Table>
        <thead>
          <tr>
            <th>{t("notify.onCall.day")}</th>
            <th>{t("notify.onCall.from")}</th>
            <th>{t("notify.onCall.to")}</th>
            <th>{t("notify.onCall.user")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td>
                <select aria-label={t("notify.onCall.day")} className={inputClass} value={row.dayOfWeek} onChange={(e) => update(index, { dayOfWeek: Number(e.target.value) })}>
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {t(`notify.days.${d}`)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input aria-label={t("notify.onCall.from")} type="time" className={inputClass} value={row.from} onChange={(e) => update(index, { from: e.target.value })} />
              </td>
              <td>
                <input aria-label={t("notify.onCall.to")} type="time" className={inputClass} value={row.to} onChange={(e) => update(index, { to: e.target.value })} />
              </td>
              <td>
                {usersAvailable ? (
                  <select aria-label={t("notify.onCall.user")} className={inputClass} value={row.userId} onChange={(e) => update(index, { userId: e.target.value, userName: null })}>
                    <option value="" />
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input aria-label={t("notify.onCall.user")} className={inputClass} value={row.userId} placeholder={t("notify.policy.userIdPlaceholder")} onChange={(e) => update(index, { userId: e.target.value, userName: null })} />
                )}
                {row.userName && <span className="ml-2 text-[12px] text-muted">{row.userName}</span>}
              </td>
              <td>
                <Button variant="ghost" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
                  {t("notify.onCall.removeShift")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div>
        <Button onClick={() => setRows([...rows, { dayOfWeek: 1, from: "09:00", to: "18:00", userId: "" }])}>{t("notify.onCall.addShift")}</Button>
      </div>
    </div>
  );
}
