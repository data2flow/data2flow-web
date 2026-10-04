/**
 * UI-TSD-03 데이터 가져오기 마법사(`/imports/new`, TSD-04.02). 미리 실행(API-TSD-30 dryRun)을 만들면 작업 상세로 간다. TS_IMPORT.
 */
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useRouteLoaderData } from "react-router";
import { PageHeader } from "~/components/ui";
import { ImportWizard } from "~/features/data/components/import-wizard";
import type { RootData } from "~/root";

export function meta() {
  return [{ title: "data2flow" }];
}

export default function ImportsNew() {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        crumb={
          <Link to="/imports" className="hover:underline">
            {t("data.imports.title")}
          </Link>
        }
        title={t("data.imports.new")}
      />
      <ImportWizard timezone={root?.timezone ?? "Asia/Seoul"} onCreated={(job) => navigate(`/imports/${encodeURIComponent(job.id)}`)} />
    </>
  );
}
