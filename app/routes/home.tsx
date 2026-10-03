import { useTranslation } from "react-i18next";
import { Link, useRouteLoaderData } from "react-router";
import { Card, PageHeader } from "~/components/ui";
import { visibleMenu } from "~/lib/permissions";
import type { RootData } from "~/root";

export function meta() {
  return [{ title: "data2flow" }];
}

export default function Home() {
  const { t } = useTranslation();
  const root = useRouteLoaderData("root") as RootData | undefined;
  const items = visibleMenu(root?.me?.permissions).filter((item) => item.key !== "home");
  return (
    <>
      <PageHeader title={t("home.welcome", { name: root?.me?.name || root?.me?.loginId || "" })} />
      <Card title={t("app.tagline")}>
        <p className="text-muted">{t("app.preparing")}</p>
        {items.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-3">
            {items.map((item) => (
              <li key={item.key}>
                <Link to={item.path} className="text-accent hover:underline">
                  {t(`nav.${item.key}`)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
