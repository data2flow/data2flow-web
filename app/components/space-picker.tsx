/**
 * 공간 선택(트리 순서로 들여 쓴 선택 상자, 여러 개 고르는 체크 트리). 기기 승인(UI-DEV-05)·기기 추가(UI-DEV-07)·
 * 소스 기본 공간(UI-DSC-02)·회원 공간 범위(UI-IAM-07·08)에서 함께 쓴다.
 */
import { useState, type SelectHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { flattenSpaces, type SpaceNode } from "~/lib/spaces";
import { SelectField, TextField } from "./ui";

export function SpaceSelect({
  spaces,
  label,
  emptyLabel,
  error,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { spaces: SpaceNode[]; label: string; emptyLabel?: string; error?: string }) {
  const { t } = useTranslation();
  const flat = flattenSpaces(spaces);
  return (
    <SelectField label={label} error={error} {...props}>
      <option value="">{emptyLabel ?? t("spacePicker.choose")}</option>
      {flat.map((s) => (
        <option key={s.id} value={s.id} disabled={s.node.accessible === false}>
          {`${"  ".repeat(Math.max(0, s.depth - 1))}${s.name}`}
        </option>
      ))}
    </SelectField>
  );
}

/** 여러 공간 고르기(하위 포함 의미). 상위를 고르면 하위는 자동으로 포함되므로 따로 고를 필요가 없다(BR-IAM-16) */
export function SpaceScopePicker({ spaces, name, defaultValue = [], label, hint }: { spaces: SpaceNode[]; name: string; defaultValue?: string[]; label: string; hint?: string }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>(defaultValue.map(String));
  const flat = flattenSpaces(spaces);
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-[12.5px] font-medium text-muted">{label}</legend>
      {selected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      {flat.length === 0 && <p className="text-[12px] text-muted">{t("spacePicker.noSpaces")}</p>}
      <div className="max-h-48 overflow-y-auto rounded-md border border-line p-2">
        {flat.map((s) => (
          <label key={s.id} className="flex items-center gap-2 py-0.5 text-[13px]" style={{ paddingLeft: (s.depth - 1) * 14 }}>
            <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} aria-label={s.path.join(" › ")} />
            {s.name}
            <span className="text-[11px] text-muted">{t(`spaceType.${s.type}`, { defaultValue: s.type })}</span>
          </label>
        ))}
      </div>
      <p className="text-[12px] text-muted">{selected.length === 0 ? t("spacePicker.allScope") : (hint ?? t("spacePicker.selected", { n: selected.length }))}</p>
    </fieldset>
  );
}

/**
 * 회원 공간 범위 입력(IAM-01.07, IAM-04.02): 공간 트리를 불러왔으면 트리 선택, 못 불러왔으면 공간 ID 쉼표 입력으로 대신한다.
 */
export function ScopeField({ spaces, name = "spaceScope", label, hint, defaultValue = [] }: { spaces: SpaceNode[] | null | undefined; name?: string; label: string; hint?: string; defaultValue?: string[] }) {
  // 트리 선택은 고른 개수를 안내하고, 공간 ID 입력 안내(hint)는 대체 입력에만 쓴다
  if (spaces) return <SpaceScopePicker spaces={spaces} name={name} label={label} defaultValue={defaultValue} />;
  return <TextField label={label} name={name} hint={hint} defaultValue={defaultValue.join(", ")} />;
}
