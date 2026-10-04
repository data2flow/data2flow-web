/**
 * UI-DEV-09 측정 항목 > 표시 단위: 조직 기본 온도 단위(℃/℉, DEV-04.04, API-DEV-57). 바꾸는 것은 ADMIN(OPS_MANAGE)만.
 * 저장값은 ℃ 그대로이고 화면·내보내기 표시만 바뀐다(22.0℃ → 71.6℉). 사용자별 단위는 내 정보 > 프로필.
 */
import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Button, Card, CsrfField, SelectField } from "~/components/ui";
import { toDisplay } from "~/lib/units";

export interface UnitSettings {
  temperatureUnit: string;
  version: number;
}

export function UnitSettingsCard({ settings, canEdit }: { settings: UnitSettings; canEdit: boolean }) {
  const { t } = useTranslation();
  const unit = settings.temperatureUnit === "F" ? "F" : "C";
  return (
    <Card className="mb-4" title={t("devmodel.units.title")}>
      <p className="mb-2 text-[13px] text-muted">{t("devmodel.units.example", { c: 22, f: toDisplay(22, "℃", "F") })}</p>
      {canEdit ? (
        <Form method="post" className="flex flex-wrap items-end gap-3">
          <CsrfField />
          <input type="hidden" name="intent" value="units" />
          <input type="hidden" name="baseVersion" value={settings.version} />
          <SelectField label={t("devmodel.units.orgDefault")} name="temperatureUnit" defaultValue={unit}>
            <option value="C">{t("devmodel.units.C")}</option>
            <option value="F">{t("devmodel.units.F")}</option>
          </SelectField>
          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
        </Form>
      ) : (
        <p className="text-[13px]">
          {t("devmodel.units.orgDefault")}: {t(`devmodel.units.${unit}`)}
        </p>
      )}
    </Card>
  );
}
