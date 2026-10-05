/**
 * 왼쪽 공간 트리(UI-DEV-01·UI-DSH-02): 타입, 기기 수, 오프라인 배지, 이름·코드 검색, 트리 편집 도구(DEV_ADMIN).
 * 편집은 같은 화면 action으로 보낸다(intent=create|rename|move|delete, API-DEV-02~05).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";
import { Button, CsrfField, Dialog, SelectField, TextField, cx } from "~/components/ui";
import { COMMON_TIMEZONES } from "~/lib/format";
import { VirtualBadge } from "~/features/sim/components/common";
import { allowedChildTypes, flattenSpaces, moveTargets, type FlatSpace, type SpaceNode } from "~/lib/spaces";

export interface TreeActionResult {
  intent?: string;
  parentId?: string;
  error?: { code: string; message?: string };
  fieldErrors?: Record<string, string>;
  blockers?: { children?: number; devices?: number; markers?: number; workOrders?: number } | null;
}

/** "실제만"(SIM-01.01): 가상 공간과 그 아래를 뺀다 */
export function withoutVirtual(flat: FlatSpace[]): FlatSpace[] {
  const hidden = new Set<string>();
  for (const s of flat) if (s.node.virtual || (s.parentId && hidden.has(s.parentId))) hidden.add(s.id);
  return flat.filter((s) => !hidden.has(s.id));
}

/** 검색어와 맞는 공간과 그 조상만 남긴다 */
export function filterTree(flat: FlatSpace[], query: string): FlatSpace[] {
  const q = query.trim().toLowerCase();
  if (!q) return flat;
  const hit = new Set(flat.filter((s) => s.name.toLowerCase().includes(q) || (s.node.code ?? "").toLowerCase().includes(q)).map((s) => s.id));
  const keep = new Set<string>();
  for (const s of flat) {
    if (!hit.has(s.id)) continue;
    keep.add(s.id);
    let parent = s.parentId;
    while (parent) {
      keep.add(parent);
      parent = flat.find((p) => p.id === parent)?.parentId ?? null;
    }
  }
  return flat.filter((s) => keep.has(s.id));
}

export function SpaceTree({ spaces, selectedId, canEdit, result }: { spaces: SpaceNode[]; selectedId?: string; canEdit: boolean; result?: TreeActionResult }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [realOnly, setRealOnly] = useState(false);
  const flat = flattenSpaces(spaces);
  const hasVirtual = flat.some((s) => s.node.virtual);
  const visible = filterTree(realOnly ? withoutVirtual(flat) : flat, query);
  const selected = flat.find((s) => s.id === selectedId);
  return (
    <nav aria-label={t("spaces.tree.label")} className="flex flex-col gap-2">
      <TextField label={t("spaces.tree.search")} value={query} onChange={(e) => setQuery(e.target.value)} type="search" />
      {hasVirtual && (
        <label className="flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={realOnly} onChange={(e) => setRealOnly(e.target.checked)} />
          {t("spaces.tree.realOnly")}
        </label>
      )}
      {canEdit && <TreeTools spaces={spaces} selected={selected} result={result} />}
      <ul className="flex flex-col">
        {visible.map((s) => (
          <li key={s.id} style={{ paddingLeft: (s.depth - 1) * 14 }}>
            <Link
              to={`/spaces/${s.id}`}
              aria-current={s.id === selectedId ? "page" : undefined}
              className={cx("flex items-center gap-2 rounded px-2 py-1 text-[13px]", s.id === selectedId ? "bg-accent-soft font-semibold text-accent" : "hover:bg-bg")}
            >
              <span className="text-[10.5px] uppercase text-muted">{t(`spaceType.${s.type}`, { defaultValue: s.type })}</span>
              <span className="flex-1">{s.name}</span>
              {s.node.virtual && <VirtualBadge />}
              {s.node.counts?.devices ? <span className="font-mono text-[11px] text-muted">{s.node.counts.devices}</span> : null}
              {s.node.counts?.offline ? <span className="rounded bg-fair-soft px-1 text-[11px] text-fair-ink">{t("spaces.tree.offline", { n: s.node.counts.offline })}</span> : null}
            </Link>
          </li>
        ))}
        {visible.length === 0 && flat.length > 0 && <li className="px-2 text-[12px] text-muted">{t("spaces.tree.noMatch")}</li>}
      </ul>
    </nav>
  );
}

type DialogKind = "site" | "child" | "rename" | "move" | "delete" | null;

export function TreeTools({ spaces, selected, result }: { spaces: SpaceNode[]; selected?: FlatSpace; result?: TreeActionResult }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<DialogKind>(() => (result?.error || result?.fieldErrors ? ((result.intent === "create" ? (result.parentId ? "child" : "site") : result.intent) as DialogKind) : null));
  const close = () => setOpen(null);
  return (
    <div className="flex flex-wrap gap-1">
      <Button onClick={() => setOpen("site")}>{t("spaces.tree.addSite")}</Button>
      <Button onClick={() => setOpen("child")} disabled={!selected || allowedChildTypes(selected).length === 0}>
        {t("spaces.tree.addChild")}
      </Button>
      <Button onClick={() => setOpen("rename")} disabled={!selected}>
        {t("spaces.tree.rename")}
      </Button>
      <Button onClick={() => setOpen("move")} disabled={!selected || selected.type === "SITE"}>
        {t("spaces.tree.move")}
      </Button>
      <Button variant="danger" onClick={() => setOpen("delete")} disabled={!selected}>
        {t("common.delete")}
      </Button>
      {(open === "site" || open === "child") && <AddSpaceDialog parent={open === "child" ? selected : undefined} result={result} onClose={close} />}
      {open === "rename" && selected && <RenameDialog space={selected} result={result} onClose={close} />}
      {open === "move" && selected && <MoveDialog spaces={spaces} space={selected} result={result} onClose={close} />}
      {open === "delete" && selected && <DeleteDialog space={selected} result={result} onClose={close} />}
    </div>
  );
}

function ErrorLine({ result }: { result?: TreeActionResult }) {
  const { t } = useTranslation();
  if (!result?.error) return null;
  return (
    <p role="alert" className="text-[12.5px] text-bad-ink">
      {t(`errors.${result.error.code}`, { defaultValue: result.error.message || t("errors.UNKNOWN") })}
    </p>
  );
}

export function AddSpaceDialog({ parent, result, onClose }: { parent?: FlatSpace; result?: TreeActionResult; onClose: () => void }) {
  const { t } = useTranslation();
  const types = allowedChildTypes(parent ?? null);
  const [type, setType] = useState<string>(types[0] ?? "SITE");
  const fe = result?.intent === "create" ? (result.fieldErrors ?? {}) : {};
  return (
    <Dialog title={parent ? t("spaces.tree.addChildTitle", { name: parent.name }) : t("spaces.tree.addSite")} open onClose={onClose}>
      <Form method="post" className="flex flex-col gap-3">
        <CsrfField />
        <input type="hidden" name="intent" value="create" />
        {parent && <input type="hidden" name="parentId" value={parent.id} />}
        <TextField label={t("spaces.field.name")} name="name" required maxLength={100} error={fe.name ? t(`spaces.validation.${fe.name}`) : undefined} />
        <SelectField label={t("spaces.field.type")} name="type" value={type} onChange={(e) => setType(e.target.value)}>
          {types.map((ty) => (
            <option key={ty} value={ty}>
              {t(`spaceType.${ty}`)}
            </option>
          ))}
        </SelectField>
        <TextField label={t("spaces.field.code")} name="code" maxLength={50} error={fe.code ? t(`spaces.validation.${fe.code}`) : undefined} />
        {type === "SITE" && (
          <>
            <SelectField label={t("spaces.field.timezone")} name="timezone" defaultValue="Asia/Seoul" error={fe.timezone ? t(`spaces.validation.${fe.timezone}`) : undefined}>
              <option value="">–</option>
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </SelectField>
            <TextField label={t("spaces.field.address")} name="address" />
            <div className="grid grid-cols-2 gap-2">
              <TextField label={t("spaces.field.latitude")} name="latitude" inputMode="decimal" error={fe.latitude ? t(`spaces.validation.${fe.latitude}`) : undefined} />
              <TextField label={t("spaces.field.longitude")} name="longitude" inputMode="decimal" error={fe.longitude ? t(`spaces.validation.${fe.longitude}`) : undefined} />
            </div>
          </>
        )}
        <ErrorLine result={result?.intent === "create" ? result : undefined} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

function RenameDialog({ space, result, onClose }: { space: FlatSpace; result?: TreeActionResult; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog title={t("spaces.tree.rename")} open onClose={onClose}>
      <Form method="post" className="flex flex-col gap-3">
        <CsrfField />
        <input type="hidden" name="intent" value="rename" />
        <input type="hidden" name="id" value={space.id} />
        <TextField label={t("spaces.field.name")} name="name" defaultValue={space.name} required maxLength={100} />
        <ErrorLine result={result?.intent === "rename" ? result : undefined} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

function MoveDialog({ spaces, space, result, onClose }: { spaces: SpaceNode[]; space: FlatSpace; result?: TreeActionResult; onClose: () => void }) {
  const { t } = useTranslation();
  const targets = moveTargets(spaces, space.id).filter((s) => s.id !== space.parentId);
  return (
    <Dialog title={t("spaces.tree.moveTitle", { name: space.name })} open onClose={onClose}>
      <Form method="post" className="flex flex-col gap-3">
        <CsrfField />
        <input type="hidden" name="intent" value="move" />
        <input type="hidden" name="id" value={space.id} />
        <SelectField label={t("spaces.tree.newParent")} name="newParentId" required>
          <option value="">–</option>
          {targets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.path.join(" › ")}
            </option>
          ))}
        </SelectField>
        {targets.length === 0 && <p className="text-[12px] text-muted">{t("spaces.tree.noMoveTarget")}</p>}
        <ErrorLine result={result?.intent === "move" ? result : undefined} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={targets.length === 0}>
            {t("spaces.tree.move")}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

export function DeleteDialog({ space, result, onClose }: { space: FlatSpace; result?: TreeActionResult; onClose: () => void }) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const blockers = result?.intent === "delete" ? result.blockers : null;
  return (
    <Dialog title={t("spaces.tree.deleteTitle", { name: space.name })} open onClose={onClose}>
      <Form method="post" className="flex flex-col gap-3">
        <CsrfField />
        <input type="hidden" name="intent" value="delete" />
        <input type="hidden" name="id" value={space.id} />
        <p className="text-[13px]">{t("spaces.tree.deleteBody")}</p>
        <TextField label={t("spaces.tree.typeName", { name: space.name })} value={typed} onChange={(e) => setTyped(e.target.value)} />
        <ErrorLine result={result?.intent === "delete" ? result : undefined} />
        {blockers && (
          <div role="alert" className="text-[12.5px] text-bad-ink">
            <p>{t("spaces.tree.blockers", { children: blockers.children ?? 0, devices: blockers.devices ?? 0, markers: blockers.markers ?? 0, workOrders: blockers.workOrders ?? 0 })}</p>
            <Link className="text-accent underline" to={`/devices?spaceId=${space.id}`}>
              {t("spaces.tree.viewDevices")}
            </Link>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="danger" disabled={typed !== space.name}>
            {t("common.delete")}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}
