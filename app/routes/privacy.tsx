/**
 * 개인정보 처리 안내(NFR-12.01). 수집 항목·목적·보관·삭제(익명화, IAM-01.10)를 고지한다.
 */
import { useTranslation } from "react-i18next";
import { checkLangParam } from "~/bff/routing.server";
import { PublicShell } from "~/components/public-shell";
import type { Route } from "./+types/privacy";

export function loader({ request, params }: Route.LoaderArgs) {
  checkLangParam(params.lang, request);
  return null;
}

export function meta() {
  return [{ title: "data2flow" }];
}

const ITEMS = ["name", "email", "phone", "loginId", "access"] as const;

export default function Privacy() {
  const { t } = useTranslation();
  return (
    <PublicShell title={t("privacy.title")}>
      <p className="mb-3 text-muted">{t("privacy.intro")}</p>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1">{t("privacy.item")}</th>
            <th className="py-1">{t("privacy.purpose")}</th>
          </tr>
        </thead>
        <tbody>
          {ITEMS.map((item) => (
            <tr key={item} className="border-t border-line">
              <td className="py-1.5 pr-2">{t(`privacy.items.${item}.name`)}</td>
              <td className="py-1.5">{t(`privacy.items.${item}.purpose`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mt-4 font-semibold">{t("privacy.retentionTitle")}</h2>
      <p className="text-muted">{t("privacy.retention")}</p>
      <h2 className="mt-4 font-semibold">{t("privacy.deletionTitle")}</h2>
      <p className="text-muted">{t("privacy.deletion")}</p>
    </PublicShell>
  );
}
