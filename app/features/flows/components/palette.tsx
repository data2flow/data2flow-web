/**
 * 왼쪽 팔레트(UI-FLW-02): 노드 카탈로그(API-FLW-30)를 분류별로 접어 보여 주고 검색한다. 설명은 툴팁(title).
 * 클릭·Enter로 캔버스에 추가하고(키보드 추가), 끌어서 캔버스에 놓을 수도 있다. 제어 배포 권한이 없으면 제어·장면 노드는 잠근다(TC-FLW-118).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "~/components/ui";
import { isControlNode, type Catalog } from "../model/flow-graph";
import type { NodeType } from "../model/types";

export const CATEGORY_ORDER = ["trigger", "condition", "transform", "flow", "action", "sink", "debug", "enrich", "ai"];
export const DRAG_TYPE = "application/x-data2flow-node";

export function Palette({ types, catalog, canDeployControl, onAdd }: { types: NodeType[]; catalog: Catalog; canDeployControl: boolean; onAdd: (type: string) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = types.filter((nt) => !q || [nt.name, nt.type, nt.description ?? ""].some((s) => s.toLowerCase().includes(q)));
    const categories = [...new Set([...CATEGORY_ORDER, ...matched.map((m) => m.category)])];
    return categories.map((c) => ({ category: c, items: matched.filter((m) => m.category === c) })).filter((g) => g.items.length > 0);
  }, [types, query]);
  return (
    <aside aria-label={t("flows.palette.label")} className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto border-r border-line p-2">
      <input type="search" aria-label={t("flows.palette.search")} placeholder={t("flows.palette.search")} value={query} onChange={(e) => setQuery(e.target.value)} className="rounded-md border border-line bg-panel px-2 py-1.5 text-[13px]" />
      {groups.length === 0 && <p className="text-[12px] text-muted">{t("flows.palette.noMatch")}</p>}
      {groups.map((group) => (
        <details key={group.category} open>
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-muted">{t(`flows.category.${group.category}`, { defaultValue: group.category })}</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {group.items.map((nt) => {
              const locked = !canDeployControl && isControlNode(nt.type, catalog);
              return (
                <li key={nt.type}>
                  <button
                    type="button"
                    disabled={locked}
                    draggable={!locked}
                    onDragStart={(e) => e.dataTransfer?.setData(DRAG_TYPE, nt.type)}
                    onClick={() => onAdd(nt.type)}
                    title={locked ? t("flows.palette.locked") : (nt.description ?? nt.name)}
                    aria-label={locked ? `${nt.name} (${t("flows.palette.lockedShort")})` : t("flows.palette.add", { name: nt.name })}
                    className="flex w-full items-center justify-between gap-1 rounded-md border border-line bg-panel px-2 py-1.5 text-left text-[12.5px] hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span>{nt.name}</span>
                    {locked && <Badge tone="neutral">{t("flows.palette.lockedShort")}</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
      {!canDeployControl && types.some((nt) => isControlNode(nt.type, catalog)) && <p className="text-[11.5px] text-muted">{t("flows.palette.locked")}</p>}
    </aside>
  );
}
