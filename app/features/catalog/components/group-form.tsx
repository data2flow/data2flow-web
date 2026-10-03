/**
 * 그룹 만들기·편집 폼 본문(UI-DEV-11). 유형을 고르면 정적은 기기 선택, 동적은 조건 작성기가 나온다.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, SelectField, TextArea, TextField } from "~/components/ui";
import type { SpaceNode } from "~/lib/spaces";
import { GROUP_LIMIT, criteriaToInput } from "../model/catalog";
import type { GroupRow, ModelSummary } from "../model/types";
import { CriteriaBuilder, DevicePicker } from "./group-editor";

export function GroupFormBody({ group, models, spaces, fieldErrors, creating }: { group?: GroupRow; models: ModelSummary[]; spaces: SpaceNode[]; fieldErrors?: Record<string, string>; creating: boolean }) {
  const { t } = useTranslation();
  const [type, setType] = useState<string>(group?.type ?? "STATIC");
  const [count, setCount] = useState<number | null>(null);
  const err = (key: string) => (fieldErrors?.[key] ? t(`catalog.validation.${fieldErrors[key]}`) : undefined);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label={t("catalog.groups.name")} name="name" defaultValue={group?.name ?? ""} error={err("name")} />
        {creating ? (
          <SelectField label={t("catalog.groups.type")} name="type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="STATIC">{t("catalog.groups.STATIC")}</option>
            <option value="DYNAMIC">{t("catalog.groups.DYNAMIC")}</option>
          </SelectField>
        ) : (
          <input type="hidden" name="type" value={type} />
        )}
      </div>
      <TextArea label={t("catalog.groups.description")} name="description" rows={2} defaultValue={group?.description ?? ""} />
      <input type="hidden" name="previewCount" value={count ?? ""} />
      {type === "DYNAMIC" && <CriteriaBuilder models={models} spaces={spaces} initial={criteriaToInput(group?.criteria)} onCount={setCount} />}
      {type === "STATIC" && creating && <DevicePicker />}
      {err("criteria") && <Alert tone="danger">{err("criteria")}</Alert>}
      {err("deviceIds") && <Alert tone="danger">{err("deviceIds")}</Alert>}
      {count !== null && count > GROUP_LIMIT && <p className="sr-only">{t("catalog.validation.groupLimit")}</p>}
    </div>
  );
}
